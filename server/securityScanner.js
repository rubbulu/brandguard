/**
 * Prompt Injection & Adversarial Instruction Scanner
 * Runs deterministically before any AI review step.
 */

const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|above|system|brand)?\s*(instructions|rules|guidelines|prompts)\b/i,
  /\bapprove\s+(this\s+)?(draft|banner|post|copy|content)\s*(without|with no)?\s*(findings|errors|issues|violations)?\b/i,
  /\bapprove\s+this\s+banner\b/i,
  /\bapprove\s+this\s+draft\b/i,
  /\bdisregard\s+(all\s+)?(rules|instructions|guidelines)\b/i,
  /\b100%\s+compliant\b/i,
  /\bno\s+findings\s+detected\b/i,
  /\bbypass\s+(ai\s+)?(governance|validator|review|safety)\b/i,
  /\bdo\s+not\s+(flag|report|review|check)\b/i,
  /\byou\s+must\s+approve\b/i,
  /\bpretend\s+there\s+are\s+no\s+(rules|violations)\b/i
];

export function detectPromptInjection(text) {
  if (!text || typeof text !== "string") return [];

  const findings = [];
  for (const pattern of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const quote = match[0];
      // Avoid duplicate quotes
      if (!findings.some(f => f.quote.toLowerCase() === quote.toLowerCase())) {
        findings.push({
          id: `sec-${Date.now()}-${findings.length}`,
          rule_id: "SEC-01",
          quote: quote,
          category: "claim",
          severity: "high",
          explanation: "Possible prompt injection: text attempts to instruct the reviewer.",
          suggested_fix: "Remove instruction-like text attempting to manipulate the review.",
          needs_human_judgement: true,
          status: "pending",
          source: "security"
        });
      }
    }
  }

  return findings;
}
