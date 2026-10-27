/**
 * Prompt Injection & Adversarial Instruction Scanner
 * Runs deterministically before any AI review step.
 * Enforces:
 * - Max one SEC-01 per text block/line
 * - Action "remove" with no replacement text (suggested_fix = "")
 * - needs_human_judgement = true on every SEC-01
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
  // Split into distinct text blocks (lines or paragraphs)
  const blocks = text.split(/\r?\n+/).map(b => b.trim()).filter(Boolean);

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx];
    let matchedPattern = null;
    let matchedQuote = null;

    for (const pattern of INJECTION_PATTERNS) {
      const match = block.match(pattern);
      if (match) {
        matchedPattern = pattern;
        matchedQuote = match[0];
        break; // Max one SEC-01 per text block
      }
    }

    if (matchedQuote) {
      // Use the full sentence or clause in the block for maximum context
      let span = block;
      if (block.length > 120) {
        // If block is very long, extract the sentence containing the match
        const sentences = block.split(/(?<=[.!?])\s+/);
        const containing = sentences.find(s => matchedPattern.test(s));
        if (containing) span = containing.trim();
      }

      findings.push({
        id: `sec-${Date.now()}-${findings.length}`,
        rule_id: "SEC-01",
        quote: span,
        category: "security",
        severity: "high",
        explanation: "Possible prompt injection: text attempts to instruct the reviewer.",
        suggested_fix: "",
        action: "remove",
        needs_human_judgement: true,
        status: "pending",
        source: "security"
      });
    }
  }

  // Fallback: If text had no newlines but contains injection pattern
  if (findings.length === 0) {
    for (const pattern of INJECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        findings.push({
          id: `sec-${Date.now()}-0`,
          rule_id: "SEC-01",
          quote: match[0],
          category: "security",
          severity: "high",
          explanation: "Possible prompt injection: text attempts to instruct the reviewer.",
          suggested_fix: "",
          action: "remove",
          needs_human_judgement: true,
          status: "pending",
          source: "security"
        });
        break;
      }
    }
  }

  return findings;
}
