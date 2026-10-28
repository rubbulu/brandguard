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
  /\bignore\s+(all\s+)?(previous|prior|above|system|brand)?\s*(instructions|rules|guidelines|prompts)\b/gi,
  /\bapprove\s+(this\s+)?(draft|banner|post|copy|content)\s*(without|with no)?\s*(findings|errors|issues|violations)?\b/gi,
  /\bapprove\s+this\s+(banner|draft)\b/gi,
  /\bdisregard\s+(all\s+)?(rules|instructions|guidelines)\b/gi,
  /\b100%\s+compliant\b/gi,
  /\bno\s+findings\s+detected\b/gi,
  /\bbypass\s+(a[il]\s+)?(governance|validator|review|safety)\b/gi,
  /\b(adversarial|prompt)\s+injection\b/gi,
  /\bdo\s+not\s+(flag|report|review|check)\b/gi,
  /\byou\s+must\s+approve\b/gi,
  /\bpretend\s+there\s+are\s+no\s+(rules|violations)\b/gi,
  /\bsystem\s+override\b/gi
];

export function detectPromptInjection(text) {
  if (!text || typeof text !== "string") return [];

  const matchedPhrases = [];
  const matchedSpans = [];

  for (const pattern of INJECTION_PATTERNS) {
    // Reset regex index
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const phrase = match[0].trim();
      if (!matchedPhrases.some(p => p.toLowerCase() === phrase.toLowerCase())) {
        matchedPhrases.push(phrase);
      }
    }
  }

  if (matchedPhrases.length === 0) {
    return [];
  }

  // Find the sentence or block containing the first injection
  const blocks = text.split(/\r?\n+/).map(b => b.trim()).filter(Boolean);
  let primarySpan = matchedPhrases[0];
  for (const block of blocks) {
    if (matchedPhrases.some(p => block.toLowerCase().includes(p.toLowerCase()))) {
      primarySpan = block;
      break;
    }
  }

  // Formulate explanation listing the phrases
  let explanation = "Possible prompt injection: text attempts to instruct the reviewer.";
  if (matchedPhrases.length > 1) {
    explanation = `Possible prompt injection: text attempts to instruct the reviewer (detected phrases: "${matchedPhrases.join('", "')}").`;
  } else {
    explanation = `Possible prompt injection: text attempts to instruct the reviewer ("${matchedPhrases[0]}").`;
  }

  // Exactly one SEC-01 finding listing the phrases
  return [
    {
      id: `sec-${Date.now()}-0`,
      rule_id: "SEC-01",
      quote: primarySpan,
      category: "security",
      severity: "high",
      explanation,
      suggested_fix: "",
      action: "remove",
      needs_human_judgement: true,
      status: "pending",
      source: "security",
      injection_phrases: matchedPhrases
    }
  ];
}
