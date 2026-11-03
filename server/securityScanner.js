/**
 * Prompt Injection & Adversarial Instruction Scanner
 * Runs deterministically before any AI review step.
 * Enforces:
 * - One SEC-01 finding per banner / text block.
 * - If several injection phrases are in the banner, shows ONE finding listing all phrases.
 * - Action "remove" with no replacement text (suggested_fix = "")
 * - needs_human_judgement = true on every SEC-01
 */

const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|above|system|brand|other)?\s*(instructions|rules|guidelines|prompts)\b/gi,
  /\bapprove\s+(this|every|all|any)?\s*(draft|banner|post|copy|content)s?\s*(without|with no)?\s*(findings|errors|issues|violations)?\b/gi,
  /\bapprove\s+(this|every|all|any)\s+(banner|draft)s?\b/gi,
  /\bdisregard\s+(all\s+)?(other\s+)?(rules|instructions|guidelines)\b/gi,
  /\b100%\s+compliant\b/gi,
  /\bno\s+findings\s+detected\b/gi,
  /\bbypass\s+(a[il]\s+)?(governance|validator|review|safety)\b/gi,
  /\b(adversarial|prompt)\s+injection\b/gi,
  /\bdo\s+not\s+(flag|report|review|check)\b/gi,
  /\byou\s+must\s+approve\b/gi,
  /\bpretend\s+there\s+are\s+no\s+(rules|violations)\b/gi,
  /\bsystem\s+override\b/gi
];

export function splitSentences(text) {
  if (!text || typeof text !== "string") return [];
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    const raw = Array.from(segmenter.segment(text));
    const results = [];
    for (const s of raw) {
      // Split on newlines if a sentence segment spans multiple lines
      const subLines = s.segment.split(/\r?\n+/);
      let currIdx = s.index;
      for (const line of subLines) {
        const trimmed = line.trim();
        if (trimmed) {
          const offset = s.segment.indexOf(line, currIdx - s.index);
          const actualStart = s.index + (offset >= 0 ? offset : 0);
          results.push({
            sentence: trimmed,
            start: actualStart,
            end: actualStart + line.length
          });
        }
        currIdx += line.length + 1;
      }
    }
    return results;
  }

  // Fallback if Intl.Segmenter is unavailable
  const rawSentences = text.split(/(?<=[.!?])\s+|\r?\n+/);
  const results = [];
  let curr = 0;
  for (const s of rawSentences) {
    const trimmed = s.trim();
    if (trimmed) {
      const idx = text.indexOf(trimmed, curr);
      results.push({
        sentence: trimmed,
        start: idx >= 0 ? idx : curr,
        end: (idx >= 0 ? idx : curr) + trimmed.length
      });
      curr = (idx >= 0 ? idx : curr) + trimmed.length;
    }
  }
  return results;
}

export function detectPromptInjection(text) {
  if (!text || typeof text !== "string") return [];

  const sentences = splitSentences(text);
  const findings = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const matchedPhrases = [];

    for (const pattern of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(s.sentence)) !== null) {
        const phrase = match[0].trim();
        if (!matchedPhrases.some(p => p.toLowerCase() === phrase.toLowerCase())) {
          matchedPhrases.push(phrase);
        }
      }
    }

    if (matchedPhrases.length > 0) {
      let explanation = "Possible prompt injection: text attempts to instruct the reviewer.";
      if (matchedPhrases.length > 1) {
        explanation = `Possible prompt injection: text attempts to instruct the reviewer (detected phrases: "${matchedPhrases.join('", "')}").`;
      } else {
        explanation = `Possible prompt injection: text attempts to instruct the reviewer ("${matchedPhrases[0]}").`;
      }

      findings.push({
        id: `sec-${Date.now()}-${i}`,
        rule_id: "SEC-01",
        quote: s.sentence,
        start: s.start,
        end: s.end,
        category: "security",
        severity: "high",
        explanation,
        suggested_fix: "",
        action: "remove",
        needs_human_judgement: true,
        status: "pending",
        source: "security",
        injection_phrases: matchedPhrases
      });
    }
  }

  // Fallback: if sentences didn't capture but pattern matches text directly
  if (findings.length === 0) {
    for (const pattern of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(text);
      if (m) {
        findings.push({
          id: `sec-${Date.now()}-0`,
          rule_id: "SEC-01",
          quote: m[0].trim(),
          start: m.index,
          end: m.index + m[0].length,
          category: "security",
          severity: "high",
          explanation: `Possible prompt injection: text attempts to instruct the reviewer ("${m[0].trim()}").`,
          suggested_fix: "",
          action: "remove",
          needs_human_judgement: true,
          status: "pending",
          source: "security",
          injection_phrases: [m[0].trim()]
        });
        break;
      }
    }
  }

  return findings;
}
