/**
 * BrandGuard AI Finding Validator
 * Enforces strict governance:
 * 1. Checks that the cited rule_id exists in the approved rules or facts library.
 * 2. Checks that the quoted text appears word-for-word in the draft text.
 * 3. Flags findings without a clear suggested fix as requiring human judgment.
 * 4. Records all rejected findings with reasons for transparency and audit.
 */

export function validateFindings(draftText, rawFindings, rules = [], facts = []) {
  const validRuleIds = new Set([
    ...rules.map(r => r.id.trim().toUpperCase()),
    ...facts.map(f => f.id.trim().toUpperCase())
  ]);

  const accepted = [];
  const rejected = [];

  if (!Array.isArray(rawFindings)) {
    return {
      accepted: [],
      rejected: [{ reason: "AI response was not a valid list of findings", raw: rawFindings }],
      stats: { total: 0, accepted: 0, rejected: 1 }
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
    const quote = finding.quote || "";

    // 2. Rule ID verification
    if (!ruleId) {
      rejectionReasons.push("Missing rule_id");
    } else if (!validRuleIds.has(ruleId)) {
      rejectionReasons.push(`Rule ID "${ruleId}" does not exist in brand rules or approved facts`);
    }

    // 3. Verbatim quote verification
    if (!quote || quote.trim() === "") {
      rejectionReasons.push("Missing quote text");
    } else if (!draftText.includes(quote)) {
      rejectionReasons.push(`Quoted phrase "${quote}" was not found word-for-word in the draft text`);
    }

    // 4. Suggested fix check
    let suggestedFix = finding.suggested_fix || "";
    let needsHumanJudgement = Boolean(finding.needs_human_judgement);

    if (!suggestedFix || suggestedFix.trim() === "") {
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
        category: (finding.category || "claim").toLowerCase(),
        severity: ["high", "medium", "low"].includes((finding.severity || "").toLowerCase())
          ? finding.severity.toLowerCase()
          : "medium",
        explanation: finding.explanation || "Conflicts with brand policy.",
        suggested_fix: suggestedFix,
        needs_human_judgement: needsHumanJudgement,
        status: "pending" // 'pending' | 'accepted' | 'edited' | 'rejected'
      });
    }
  }

  return {
    accepted,
    rejected,
    stats: {
      total_from_ai: rawFindings.length,
      accepted_count: accepted.length,
      rejected_count: rejected.length
    }
  };
}
