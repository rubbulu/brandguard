/**
 * BrandGuard AI Finding Validator
 * Enforces strict governance:
 * 1. Checks that the cited rule_id exists in the approved rules, facts, or visual/security rules.
 * 2. Checks that the quoted text appears word-for-word in the draft text.
 * 3. Drops any finding where suggested_fix equals the flagged text.
 * 4. Drops any finding where the explanation contains reasoning words ("wait", "let me check", "however, the draft") or says text is compliant.
 * 5. Cleans explanations so they are one concise, single sentence.
 * 6. Merges overlapping or nested findings of the SAME rule_id into one finding (keeping the longest span), max one SEC-01 per text block.
 * 7. De-duplicates findings of different rules on the exact same text, keeping highest severity.
 * 8. Records stats reporting kept, dropped, and merged separately.
 */

const REASONING_OR_COMPLIANCE_PATTERNS = [
  /\bwait\b/i,
  /\blet me check\b/i,
  /\blet's check\b/i,
  /\bhowever,\s*the draft\b/i,
  /\bhowever\b.*?\bdraft\b/i,
  /\b(is|already|remains)\s+compliant\b/i,
  /\bcomplies with\b/i,
  /\bno violation\b/i,
  /\bnot a violation\b/i,
  /\balready\s+(uses|follows|says|adheres)\b/i,
  /\bdoes not violate\b/i,
  /\bno issue detected\b/i,
  /\bthis is compliant\b/i,
  /\bis acceptable\b/i
];

export function cleanSingleSentence(text) {
  if (!text || typeof text !== "string") return "Conflicts with brand policy.";
  let cleaned = text.trim();
  // Strip markdown formatting characters (asterisks, backticks, hashes, bullets)
  cleaned = cleaned.replace(/[*_`#]+/g, "").trim();
  // Extract the first complete sentence ending in ., !, or ?
  const match = cleaned.match(/^[^.!?]+[.!?]/);
  let first = match ? match[0].trim() : cleaned;
  if (!/[.!?]$/.test(first)) {
    first += ".";
  }
  return first;
}

/**
 * Merge overlapping or nested findings of the same rule_id into one finding (keeping longest span).
 * Enforces max one SEC-01 per text block.
 */
export function mergeFindings(findings, draftText = "") {
  if (!Array.isArray(findings) || findings.length <= 1) {
    return { mergedFindings: findings || [], mergedCount: 0, mergedList: [] };
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  let mergedCount = 0;
  const mergedList = [];

  // Group findings by rule_id
  const ruleGroups = new Map();
  for (const f of findings) {
    const rId = (f.rule_id || "").toUpperCase();
    if (!ruleGroups.has(rId)) {
      ruleGroups.set(rId, []);
    }
    ruleGroups.get(rId).push({ ...f });
  }

  const result = [];

  for (const [rId, list] of ruleGroups.entries()) {
    if (list.length === 1) {
      if (rId === "SEC-01") {
        list[0].action = "remove";
        list[0].suggested_fix = "";
        list[0].needs_human_judgement = true;
      }
      result.push(list[0]);
      continue;
    }

    // Sort by quote length descending (longest span first)
    list.sort((a, b) => (b.quote || "").length - (a.quote || "").length);

    const keptInGroup = [];

    for (let i = 0; i < list.length; i++) {
      const current = list[i];
      let isMerged = false;

      for (let k = 0; k < keptInGroup.length; k++) {
        const existing = keptInGroup[k];
        const exQuote = (existing.quote || "").trim().toLowerCase();
        const curQuote = (current.quote || "").trim().toLowerCase();

        // Check if nested
        const isNested = exQuote.includes(curQuote) || curQuote.includes(exQuote);

        // Check if overlapping spans in draftText
        let isOverlapping = false;
        let isSameBlock = false;
        if (draftText) {
          const lowerText = draftText.toLowerCase();
          const posEx = lowerText.indexOf(exQuote);
          const posCur = lowerText.indexOf(curQuote);
          if (posEx !== -1 && posCur !== -1) {
            const endEx = posEx + exQuote.length;
            const endCur = posCur + curQuote.length;
            isOverlapping = (posEx < endCur && posCur < endEx);

            // For SEC-01: max one per text block/line
            if (rId === "SEC-01") {
              const lineStartEx = lowerText.lastIndexOf("\n", posEx);
              const lineEndEx = lowerText.indexOf("\n", endEx);
              const lineStartCur = lowerText.lastIndexOf("\n", posCur);
              const lineEndCur = lowerText.indexOf("\n", endCur);
              if (lineStartEx === lineStartCur && lineEndEx === lineEndCur) {
                isSameBlock = true;
              }
            }
          }
        }

        if (isNested || isOverlapping || isSameBlock) {
          // Merge current into existing
          isMerged = true;
          mergedCount++;
          mergedList.push({
            keptId: existing.id,
            mergedId: current.id,
            rule_id: rId,
            mergedQuote: current.quote,
            keptQuote: existing.quote
          });

          // Elevate severity if current was higher
          if ((severityRank[current.severity] || 1) > (severityRank[existing.severity] || 1)) {
            existing.severity = current.severity;
          }
          if (current.needs_human_judgement) {
            existing.needs_human_judgement = true;
          }
          if (rId === "SEC-01") {
            existing.action = "remove";
            existing.suggested_fix = "";
          }
          break;
        }
      }

      if (!isMerged) {
        if (rId === "SEC-01") {
          current.action = "remove";
          current.suggested_fix = "";
          current.needs_human_judgement = true;
        }
        keptInGroup.push(current);
      }
    }

    result.push(...keptInGroup);
  }

  return { mergedFindings: result, mergedCount, mergedList };
}

export function validateFindings(draftText, rawFindings, rules = [], facts = []) {
  const validRuleIds = new Set([
    ...rules.map(r => r.id.trim().toUpperCase()),
    ...facts.map(f => f.id.trim().toUpperCase()),
    "SEC-01", "V-01", "V-02", "V-03", "V-04"
  ]);

  const accepted = [];
  const rejected = [];

  if (!Array.isArray(rawFindings)) {
    return {
      accepted: [],
      rejected: [{ reason: "AI response was not a valid list of findings", raw: rawFindings }],
      merged: [],
      stats: { total: 0, kept: 0, dropped: 1, merged: 0, accepted_count: 0, rejected_count: 1, merged_count: 0 }
    };
  }

  for (let i = 0; i < rawFindings.length; i++) {
    const finding = rawFindings[i];
    const rejectionReasons = [];

    // 1. Verify finding is an object
    if (!finding || typeof finding !== "object") {
      rejected.push({ index: i, finding, reasons: ["Finding is not a valid object"] });
      continue;
    }

    const ruleId = (finding.rule_id || "").trim().toUpperCase();
    const quote = (finding.quote || "").trim();
    let suggestedFix = (finding.suggested_fix || "").trim();
    const rawExplanation = (finding.explanation || "").trim();

    // 2. Rule ID verification
    if (!ruleId) {
      rejectionReasons.push("Missing rule_id");
    } else if (!validRuleIds.has(ruleId)) {
      rejectionReasons.push(`Rule ID "${ruleId}" does not exist in brand rules or approved facts`);
    }

    // 3. Verbatim quote verification
    if (!quote) {
      rejectionReasons.push("Missing quote text");
    } else if (!draftText.includes(quote)) {
      rejectionReasons.push(`Quoted phrase "${quote}" was not found word-for-word in the draft text`);
    }

    // 4. (a) Drop if suggested_fix equals the flagged text
    if (suggestedFix && quote && suggestedFix.toLowerCase() === quote.toLowerCase()) {
      rejectionReasons.push(`Suggested fix is identical to the flagged text ("${quote}")`);
    }

    // 5. (b) Drop if explanation contains reasoning words or states text is compliant
    for (const pattern of REASONING_OR_COMPLIANCE_PATTERNS) {
      if (pattern.test(rawExplanation)) {
        rejectionReasons.push(`Explanation contains reasoning words or claims text is compliant: "${rawExplanation.slice(0, 80)}"`);
        break;
      }
    }

    // 6. Security & fix handling
    let needsHumanJudgement = Boolean(finding.needs_human_judgement);
    let action = finding.action || "replace";
    if (ruleId === "SEC-01") {
      suggestedFix = "";
      action = "remove";
      needsHumanJudgement = true;
    } else if (!suggestedFix) {
      needsHumanJudgement = true;
    }

    if (rejectionReasons.length > 0) {
      rejected.push({
        index: i,
        finding,
        reasons: rejectionReasons
      });
    } else {
      accepted.push({
        id: `finding-${Date.now()}-${i}`,
        quote: quote,
        rule_id: ruleId,
        category: ruleId === "SEC-01" ? "security" : (finding.category || "claim").toLowerCase(),
        severity: ["high", "medium", "low"].includes((finding.severity || "").toLowerCase())
          ? finding.severity.toLowerCase()
          : "medium",
        explanation: cleanSingleSentence(rawExplanation),
        suggested_fix: suggestedFix,
        action: action,
        needs_human_judgement: needsHumanJudgement,
        status: "pending",
        rawIndex: i
      });
    }
  }

  // 7. Merge overlapping or nested findings of the SAME rule_id (keep longest span)
  const { mergedFindings, mergedCount, mergedList } = mergeFindings(accepted, draftText);

  // 8. De-duplicate findings of DIFFERENT rules on the exact same quote, keeping highest severity
  const severityRank = { high: 3, medium: 2, low: 1 };
  const deduplicated = [];
  const quoteMap = new Map();

  for (const f of mergedFindings) {
    const key = f.quote.toLowerCase();
    if (!quoteMap.has(key)) {
      quoteMap.set(key, []);
    }
    quoteMap.get(key).push(f);
  }

  for (const [key, group] of quoteMap.entries()) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
    } else {
      group.sort((a, b) => {
        const diff = (severityRank[b.severity] || 1) - (severityRank[a.severity] || 1);
        if (diff !== 0) return diff;
        const aIsFact = a.rule_id.startsWith("F-") ? 1 : 0;
        const bIsFact = b.rule_id.startsWith("F-") ? 1 : 0;
        if (bIsFact !== aIsFact) return bIsFact - aIsFact;
        return (b.suggested_fix ? 1 : 0) - (a.suggested_fix ? 1 : 0);
      });

      const winner = group[0];
      deduplicated.push(winner);

      for (let j = 1; j < group.length; j++) {
        const dropped = group[j];
        rejected.push({
          index: dropped.rawIndex,
          finding: dropped,
          reasons: [`Duplicate finding on text "${dropped.quote}" dropped in favor of higher-priority [${winner.rule_id}] (${winner.severity})`]
        });
      }
    }
  }

  return {
    accepted: deduplicated,
    rejected,
    merged: mergedList,
    stats: {
      total_from_ai: rawFindings.length,
      kept: deduplicated.length,
      dropped: rejected.length,
      merged: mergedCount,
      accepted_count: deduplicated.length,
      rejected_count: rejected.length,
      merged_count: mergedCount
    }
  };
}
