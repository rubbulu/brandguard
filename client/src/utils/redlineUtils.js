/**
 * Redline Utility Functions
 *
 * Computes phrase-level redline diff chunks between originalText and finalText:
 * - Shows each replaced phrase as ONE struck-through chunk and ONE inserted chunk,
 *   even if some words are shared between original and fix.
 * - Tags each chunk with the rule/fact ID of the accepted fix that caused it.
 * - Preserves the final copy text without word-by-word fragmentation.
 */

export function isCopyRule(ruleId) {
  if (!ruleId || typeof ruleId !== "string") return false;
  const upper = ruleId.trim().toUpperCase();
  return upper.startsWith("R-") || upper.startsWith("F-") || upper.startsWith("T-") || upper === "SEC-01";
}

export function computeRedlineChunks(originalText, finalText, findings = []) {
  const orig = typeof originalText === "string" ? originalText : String(originalText || "");
  const fin = typeof finalText === "string" ? finalText : String(finalText || "");

  if (!orig && !fin) return [];
  if (orig === fin) return [{ value: orig }];

  const activeFixes = (Array.isArray(findings) ? findings : []).filter(
    f => f && (f.status === "accepted" || f.status === "edited") && isCopyRule(f.rule_id) && f.quote
  );

  // If active copy fixes exist, replace each phrase as ONE struck-through chunk and ONE inserted chunk
  if (activeFixes.length > 0) {
    const usedOffsets = new Set();
    const resolved = [];

    for (const f of activeFixes) {
      let start = typeof f.startIndex === "number" ? f.startIndex : (typeof f.start === "number" ? f.start : -1);
      let end = typeof f.endIndex === "number" ? f.endIndex : (typeof f.end === "number" ? f.end : -1);

      if (start < 0) {
        let sIdx = 0;
        let fIdx = -1;
        while ((fIdx = orig.indexOf(f.quote, sIdx)) !== -1) {
          if (!usedOffsets.has(fIdx)) break;
          sIdx = fIdx + 1;
        }
        if (fIdx !== -1) {
          start = fIdx;
          end = fIdx + f.quote.length;
        }
      }

      if (start >= 0) {
        usedOffsets.add(start);
        if (end <= start) end = start + f.quote.length;
        resolved.push({
          start,
          end,
          quote: f.quote,
          suggested_fix: (f.action === "remove" || f.rule_id === "SEC-01" || !f.suggested_fix) ? "" : (f.suggested_fix !== "Needs manual edit" ? f.suggested_fix : ""),
          action: (f.action === "remove" || f.rule_id === "SEC-01" || !f.suggested_fix || f.suggested_fix.trim() === "") ? "remove" : f.action,
          rule_id: f.rule_id
        });
      }
    }

    if (resolved.length > 0) {
      resolved.sort((a, b) => a.start - b.start);
      const chunks = [];
      let cursor = 0;

      for (const fix of resolved) {
        if (fix.start > cursor) {
          chunks.push({ value: orig.slice(cursor, fix.start) });
        }
        const removedPhrase = orig.slice(fix.start, fix.end) || fix.quote;
        chunks.push({
          removed: true,
          value: removedPhrase,
          ruleId: fix.rule_id
        });

        if (fix.suggested_fix && fix.action !== "remove") {
          chunks.push({
            added: true,
            value: fix.suggested_fix,
            ruleId: fix.rule_id
          });
        }
        cursor = Math.max(cursor, fix.end);
      }

      if (cursor < orig.length) {
        chunks.push({ value: orig.slice(cursor) });
      }

      return chunks;
    }
  }

  // Fallback for manual copy changes without findings
  return [
    { removed: true, value: orig },
    { added: true, value: fin }
  ];
}
