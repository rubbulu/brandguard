/**
 * BrandGuard AI Finding Validator
 * Enforces strict governance:
 * 1. Checks that the cited rule_id exists in the approved rules, facts, or visual/security rules.
 * 2. Checks that the quoted text appears word-for-word in the draft text.
 * 3. Drops any finding where suggested_fix equals the flagged text.
 * 4. Drops any finding where the explanation contains reasoning words ("wait", "let me check", "however, the draft") or says text is compliant.
 * 5. Cleans explanations so they are one concise, single sentence.
 * 6. De-duplicates findings on the exact same text, keeping the highest severity (high > medium > low).
 * 7. Records all rejected findings with reasons and real dropped counts.
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

function cleanSingleSentence(text) {
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

    // 6. Suggested fix requirement check
    let needsHumanJudgement = Boolean(finding.needs_human_judgement);
    if (!suggestedFix) {
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
        explanation: cleanSingleSentence(rawExplanation),
        suggested_fix: suggestedFix,
        needs_human_judgement: needsHumanJudgement,
        status: "pending",
        rawIndex: i
      });
    }
  }

  // 7. De-duplicate findings on the same text, keeping highest severity (high > medium > low)
  const severityRank = { high: 3, medium: 2, low: 1 };
  const deduplicated = [];
  const quoteMap = new Map(); // normalized quote -> array of findings

  for (const f of accepted) {
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
      // Sort: highest severity first; if tied, fact rules (F-) first; if still tied, the one with suggested_fix
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

      // Record dropped duplicates in rejected with reasons
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
    stats: {
      total_from_ai: rawFindings.length,
      accepted_count: deduplicated.length,
      rejected_count: rejected.length
    }
  };
}
