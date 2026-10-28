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
 * Detects obvious ungrammatical patterns resulting from applying a suggested fix to draft text.
 * Examples:
 * - Leftover comparative immediately following an adjective (e.g. "Great better grades", "Good faster")
 * - Double comparatives (e.g. "more better", "less worse")
 * - Leftover dangling comparative following the substitution point
 */
export function validateFixGrammar(draftText, quote, suggestedFix) {
  if (!suggestedFix || typeof suggestedFix !== "string" || !quote || typeof quote !== "string") {
    return { isGrammatical: true };
  }

  const fixTrimmed = suggestedFix.trim();
  const quoteTrimmed = quote.trim();

  if (!fixTrimmed || fixTrimmed.toLowerCase() === "needs manual edit") {
    return { isGrammatical: false, reason: "Needs manual edit" };
  }

  if (!draftText || !draftText.includes(quoteTrimmed)) {
    return { isGrammatical: true };
  }

  // 1. Simulate replacement
  const simulatedText = draftText.replace(quoteTrimmed, fixTrimmed);

  // 2. Pattern: Adjective immediately followed by a comparative adjective
  // e.g. "Great better", "Good faster", "Awesome more"
  const adjComparativePattern = /\b(great|good|fine|nice|awesome|huge|real|true|solid|grand|top|cool|big|smart|superb|excellent|wonderful|fantastic|amazing|outstanding|exceptional|strong|clear)\s+(better|worse|faster|slower|more|less|harder|easier|higher|lower|stronger|weaker|smarter|longer|shorter|cheaper|richer|cleaner|greater)\b/i;
  const matchAdjComp = simulatedText.match(adjComparativePattern);
  if (matchAdjComp) {
    return {
      isGrammatical: false,
      reason: `Leftover comparative following adjective ("${matchAdjComp[0]}"). Full claim phrase must be replaced.`
    };
  }

  // 3. Pattern: Double comparatives (e.g. "more better", "less worse", "better faster")
  const doubleComparativePattern = /\b(more|less|better|worse)\s+(better|worse|faster|slower|harder|easier|higher|lower|stronger|weaker|smarter|longer|shorter|cheaper)\b/i;
  const matchDoubleComp = simulatedText.match(doubleComparativePattern);
  if (matchDoubleComp) {
    return {
      isGrammatical: false,
      reason: `Double comparative detected ("${matchDoubleComp[0]}").`
    };
  }

  // 4. Boundary check at replacement junction:
  // If the draft word immediately following quote is a comparative,
  // and the fix ends with an adjective, it leaves an ungrammatical comparative leftover.
  const quoteIndex = draftText.indexOf(quoteTrimmed);
  if (quoteIndex !== -1) {
    const textAfter = draftText.slice(quoteIndex + quoteTrimmed.length).trimStart();
    const nextWordMatch = textAfter.match(/^[a-zA-Z]+/);
    if (nextWordMatch) {
      const nextWord = nextWordMatch[0].toLowerCase();
      const comparatives = new Set([
        "better", "worse", "faster", "slower", "more", "less", "harder", "easier",
        "higher", "lower", "stronger", "weaker", "smarter", "longer", "shorter",
        "cheaper", "richer", "cleaner", "greater"
      ]);
      if (comparatives.has(nextWord)) {
        const fixWords = fixTrimmed.split(/\s+/);
        const lastWordOfFix = fixWords[fixWords.length - 1].replace(/[^a-zA-Z]/g, "").toLowerCase();
        const nonPrecedingWords = new Set([
          "great", "good", "fine", "nice", "awesome", "huge", "real", "true", "solid",
          "grand", "top", "cool", "big", "smart", "superb", "excellent", "wonderful",
          "fantastic", "amazing", "outstanding", "exceptional", "strong", "clear",
          "new", "modern", "high", "low"
        ]);
        if (nonPrecedingWords.has(lastWordOfFix)) {
          return {
            isGrammatical: false,
            reason: `Leftover comparative "${nextWord}" directly following "${lastWordOfFix}". Full phrase should be replaced.`
          };
        }
      }
    }
  }

  return { isGrammatical: true };
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
            keptQuote: existing.quote,
            originalQuote: current.quote,
            quote: current.quote,
            mergedIntoQuote: existing.quote,
            reason: `Merged duplicate/overlapping [${rId}] finding on "${current.quote}" into "${existing.quote}".`
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

/**
 * Check if two findings cover overlapping or nested text in draftText.
 */
export function areFindingsOverlapping(f1, f2, draftText) {
  const q1 = (f1.quote || "").trim().toLowerCase();
  const q2 = (f2.quote || "").trim().toLowerCase();
  if (!q1 || !q2) return false;

  if (q1.includes(q2) || q2.includes(q1)) return true;

  if (draftText) {
    const lower = draftText.toLowerCase();
    const p1 = lower.indexOf(q1);
    const p2 = lower.indexOf(q2);
    if (p1 !== -1 && p2 !== -1) {
      const e1 = p1 + q1.length;
      const e2 = p2 + q2.length;
      return (p1 < e2 && p2 < e1);
    }
  }
  return false;
}

/**
 * Check if two suggested fixes are equivalent (ignoring trailing punctuation).
 */
export function areFixesEquivalent(fix1, fix2) {
  if (!fix1 || !fix2) return false;
  const c1 = fix1.trim().replace(/[.!?]+$/, "").toLowerCase();
  const c2 = fix2.trim().replace(/[.!?]+$/, "").toLowerCase();
  return c1 === c2;
}

/**
 * Merge findings of DIFFERENT rules that cover overlapping text AND suggest the same replacement.
 * E.g., merges R-15 and R-12 into one card citing "R-15 + R-12" so the creator doesn't accept twice.
 */
export function mergeCrossRuleEquivalentFindings(findings, draftText = "") {
  if (!Array.isArray(findings) || findings.length <= 1) {
    return { findings: findings || [], mergedCount: 0, mergedList: [] };
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  const mergedList = [];
  let mergedCount = 0;
  const result = [];
  const mergedIndices = new Set();

  for (let i = 0; i < findings.length; i++) {
    if (mergedIndices.has(i)) continue;
    let current = { ...findings[i] };

    for (let j = i + 1; j < findings.length; j++) {
      if (mergedIndices.has(j)) continue;
      const other = findings[j];

      // Check if overlapping text AND suggesting the same replacement text
      const isOverlap = areFindingsOverlapping(current, other, draftText);
      const isSameFix = areFixesEquivalent(current.suggested_fix, other.suggested_fix);

      if (isOverlap && isSameFix) {
        mergedIndices.add(j);
        mergedCount++;

        // Combine rule IDs uniquely: e.g. "R-15 + R-12"
        const r1List = current.rule_id.split("+").map(s => s.trim());
        const r2List = other.rule_id.split("+").map(s => s.trim());
        const combinedRules = Array.from(new Set([...r1List, ...r2List])).join(" + ");

        mergedList.push({
          keptId: current.id,
          mergedId: other.id,
          rule_id: combinedRules,
          mergedQuote: other.quote,
          keptQuote: current.quote,
          reason: `Merged [${other.rule_id}] into [${combinedRules}] because they cover overlapping text and suggest the same replacement.`
        });

        current.rule_id = combinedRules;

        if ((severityRank[other.severity] || 1) > (severityRank[current.severity] || 1)) {
          current.severity = other.severity;
        }

        if (other.explanation && !current.explanation.toLowerCase().includes(other.rule_id.toLowerCase())) {
          current.explanation = cleanSingleSentence(`${current.explanation} Also violates ${other.rule_id}.`);
        }
      }
    }

    result.push(current);
  }

  return { findings: result, mergedCount, mergedList };
}

/**
 * Convert string to normal sentence case while preserving brand names (e.g. CampusPro).
 */
export function convertToSentenceCase(text, brandNames = ["CampusPro"]) {
  if (!text || typeof text !== "string") return text;

  let working = text;
  const brandPlaceholders = [];
  brandNames.forEach((bName, idx) => {
    const regex = new RegExp(`\\b${bName}\\b`, "gi");
    working = working.replace(regex, () => {
      const ph = `__BRAND_${idx}__`;
      brandPlaceholders.push({ placeholder: ph, value: bName });
      return ph;
    });
  });

  // Lowercase all-caps words of 2+ letters
  working = working.replace(/\b[A-Z]{2,}\b/g, (match) => {
    return match.toLowerCase();
  });

  // Capitalize the first letter of each sentence/clause
  working = working.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, prefix, letter) => {
    return prefix + letter.toUpperCase();
  });

  // Restore brand names
  brandPlaceholders.forEach(({ placeholder, value }) => {
    working = working.split(placeholder).join(value);
  });

  return working;
}

/**
 * Deterministic tone checks that run on every text draft, independent of Gemini:
 * - T-05: Flags any word of 2+ letters that is fully uppercase, except the brand name (CampusPro) as written in the rules.
 *         Suggests the same words in normal sentence case (e.g. "Buy now before it sells out!").
 * - T-03: Flags when a draft has more than one exclamation mark.
 *         Suggests removing excess exclamation marks so at most one remains.
 */
export function runDeterministicToneChecks(draftText, rules = [], brandNames = ["CampusPro"]) {
  const findings = [];
  if (!draftText || typeof draftText !== "string") return findings;

  const ruleIds = new Set(rules.map(r => (r.id || "").toUpperCase()));
  const hasT05 = rules.length === 0 || ruleIds.has("T-05");
  const hasT03 = rules.length === 0 || ruleIds.has("T-03");

  // --- T-05: No all-caps words except the brand name (CampusPro) ---
  if (hasT05) {
    const sentenceRegex = /[^.!?\n]+(?:[.!?\n]+|$)/g;
    let m;
    while ((m = sentenceRegex.exec(draftText)) !== null) {
      const rawSentence = m[0];
      const trimmed = rawSentence.trim();
      if (!trimmed) continue;

      const words = trimmed.match(/\b[A-Za-z0-9'-]+\b/g) || [];
      const allCapsWords = words.filter(w => {
        if (w.length < 2) return false;
        if (!/^[A-Z]+$/.test(w)) return false;
        // If it's already the exact brand name as written in rules, exempt it
        if (brandNames.includes(w)) return false;
        return true;
      });

      if (allCapsWords.length > 0) {
        const fix = convertToSentenceCase(trimmed, brandNames);
        if (fix !== trimmed) {
          findings.push({
            quote: trimmed,
            rule_id: "T-05",
            category: "tone",
            severity: "low",
            explanation: `No all-caps words except the brand name (${brandNames.join(", ")}). Use normal sentence case.`,
            suggested_fix: fix,
            action: "replace",
            needs_human_judgement: false
          });
        }
      }
    }
  }

  // --- T-03: Friendly tone. At most one exclamation mark per post ---
  if (hasT03) {
    const totalExMarks = (draftText.match(/!/g) || []).length;
    if (totalExMarks > 1) {
      const runMatches = draftText.match(/!{2,}/g);
      if (runMatches && runMatches.length > 0) {
        const uniqueRuns = Array.from(new Set(runMatches));
        for (const run of uniqueRuns) {
          findings.push({
            quote: run,
            rule_id: "T-03",
            category: "tone",
            severity: "low",
            explanation: "Friendly tone. At most one exclamation mark per post. Reduce run of exclamation marks to a single '!'.",
            suggested_fix: "!",
            action: "replace",
            needs_human_judgement: false
          });
        }
      } else {
        const sentenceRegex = /[^.!?\n]+(?:[.!?\n]+|$)/g;
        const sentences = [];
        let sm;
        while ((sm = sentenceRegex.exec(draftText)) !== null) {
          if (sm[0].trim()) {
            sentences.push({
              trimmed: sm[0].trim(),
              hasExMark: sm[0].includes("!"),
              exCount: (sm[0].match(/!/g) || []).length
            });
          }
        }

        let seenExMarks = 0;
        for (const s of sentences) {
          if (!s.hasExMark) continue;

          if (seenExMarks === 0) {
            seenExMarks += 1;
            continue;
          } else {
            // Additional sentences with ! exceed the limit of 1
            const fix = s.trimmed.replace(/!+/g, ".");
            findings.push({
              quote: s.trimmed,
              rule_id: "T-03",
              category: "tone",
              severity: "low",
              explanation: "Friendly tone. At most one exclamation mark per post.",
              suggested_fix: fix,
              action: "replace",
              needs_human_judgement: false
            });
            seenExMarks += s.exCount;
          }
        }
      }
    }
  }

  return findings;
}

export function validateFindings(draftText, rawFindings, rules = [], facts = []) {
  const validRuleIds = new Set([
    ...rules.map(r => r.id.trim().toUpperCase()),
    ...facts.map(f => f.id.trim().toUpperCase()),
    "SEC-01", "V-01", "V-02", "V-03", "V-04"
  ]);

  // Run deterministic checks that run on every text draft, independent of Gemini
  const deterministicToneFindings = runDeterministicToneChecks(draftText, rules);

  const rawList = Array.isArray(rawFindings)
    ? rawFindings
    : (rawFindings && Array.isArray(rawFindings.findings) ? rawFindings.findings : []);
  const combinedRawFindings = [...rawList, ...deterministicToneFindings];

  const accepted = [];
  const rejected = [];

  if (rawList.length === 0 && !Array.isArray(rawFindings) && typeof rawFindings !== "object" && deterministicToneFindings.length === 0) {
    return {
      accepted: [],
      rejected: [{ reason: "AI response was not a valid list of findings", raw: rawFindings }],
      merged: [],
      stats: { total: 0, kept: 0, dropped: 1, merged: 0, accepted_count: 0, rejected_count: 1, merged_count: 0 }
    };
  }

  for (let i = 0; i < combinedRawFindings.length; i++) {
    const finding = combinedRawFindings[i];
    const rejectionReasons = [];

    // 1. Verify finding is an object
    if (!finding || typeof finding !== "object") {
      rejected.push({ index: i, finding, reasons: ["Finding is not a valid object"] });
      continue;
    }

    const ruleId = (finding.rule_id || "").trim().toUpperCase();
    let quote = (finding.quote || "").trim();
    let suggestedFix = (finding.suggested_fix || "").trim();
    const rawExplanation = (finding.explanation || "").trim();

    // 2. Rule ID verification
    const isRuleValid = validRuleIds.has(ruleId) || (
      ruleId.includes("+") && ruleId.split("+").every(part => validRuleIds.has(part.trim()))
    );
    if (!ruleId) {
      rejectionReasons.push("Missing rule_id");
    } else if (!isRuleValid) {
      rejectionReasons.push(`Rule ID "${ruleId}" does not exist in brand rules or approved facts`);
    }

    // T-05 check: only fire when a word is fully uppercase
    if (ruleId === "T-05") {
      const words = quote.match(/\b[A-Za-z0-9'-]+\b/g) || [];
      const hasAllCapsWord = words.some(w => {
        if (w.length < 2) return false;
        if (!/^[A-Z]+$/.test(w)) return false;
        if (w === "CampusPro") return false;
        return true;
      });
      if (!hasAllCapsWord) {
        rejectionReasons.push("No fully uppercase words found in flagged text (T-05 only applies to fully uppercase words)");
      }
    }

    // T-03 & claim punctuation normalization when draft has runs of exclamation marks
    const hasRunOfExMarks = Boolean(draftText.match(/!{2,}/));
    if (ruleId === "T-03" && hasRunOfExMarks) {
      const runMatch = draftText.match(/!{2,}/);
      quote = runMatch ? runMatch[0] : quote;
      suggestedFix = "!";
      finding.action = "replace";
      finding.needs_human_judgement = false;
    } else if (hasRunOfExMarks && (ruleId.startsWith("R-") || ruleId.startsWith("F-") || ruleId.includes("+"))) {
      if (/!{2,}$/.test(quote)) {
        quote = quote.replace(/!{2,}$/, "").trim();
        suggestedFix = suggestedFix.replace(/[.!?]+$/, "").trim();
      } else if (!/[.!?]$/.test(quote) && /[.!?]$/.test(suggestedFix)) {
        const qIdx = draftText.indexOf(quote);
        if (qIdx !== -1) {
          const afterQ = draftText.slice(qIdx + quote.length).trimStart();
          if (afterQ.startsWith("!")) {
            suggestedFix = suggestedFix.replace(/[.!?]+$/, "").trim();
          }
        }
      }
    }

    // 3. Verbatim quote verification
    if (!quote) {
      rejectionReasons.push("Missing quote text");
    } else if (!draftText.includes(quote)) {
      rejectionReasons.push(`Quoted phrase "${quote}" was not found word-for-word in the draft text`);
    }

    // 4. (a) Drop if suggested_fix equals the flagged text (for case rule T-05, check exact match since fix changes case)
    const isIdentical = (ruleId === "T-05")
      ? (suggestedFix === quote)
      : (suggestedFix.toLowerCase() === quote.toLowerCase());

    if (suggestedFix && quote && isIdentical) {
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
    let fixRejected = false;
    let fixRejectionReason = null;

    if (ruleId === "SEC-01") {
      suggestedFix = "";
      action = "remove";
      needsHumanJudgement = true;
    } else if (!suggestedFix) {
      needsHumanJudgement = true;
    } else {
      // Reject any suggested fix that leaves the sentence ungrammatical in an obvious way
      const grammarCheck = validateFixGrammar(draftText, quote, suggestedFix);
      if (!grammarCheck.isGrammatical) {
        fixRejected = true;
        fixRejectionReason = grammarCheck.reason;
        suggestedFix = "Needs manual edit";
        needsHumanJudgement = true;
        action = "manual_edit";
      }
    }

    if (rejectionReasons.length > 0) {
      rejected.push({
        index: i,
        finding,
        rule_id: ruleId,
        quote: quote,
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
        fix_rejected: fixRejected,
        fix_rejection_reason: fixRejectionReason,
        action: action,
        needs_human_judgement: needsHumanJudgement,
        status: "pending",
        rawIndex: i
      });
    }
  }

  // 7. Merge overlapping or nested findings of the SAME rule_id (keep longest span)
  const { mergedFindings: sameRuleMerged, mergedCount: sameRuleMergedCount, mergedList: sameRuleMergedList } = mergeFindings(accepted, draftText);

  // 7b. Merge findings of DIFFERENT rules that cover overlapping text AND suggest the same replacement
  // E.g., when R-15 and R-12 cover overlapping text and suggest the same replacement, merge them into one card citing "R-15 + R-12"
  const { findings: crossRuleMerged, mergedCount: crossRuleMergedCount, mergedList: crossRuleMergedList } = mergeCrossRuleEquivalentFindings(sameRuleMerged, draftText);

  const totalMergedCount = sameRuleMergedCount + crossRuleMergedCount;
  const combinedMergedList = [...sameRuleMergedList, ...crossRuleMergedList];

  // 8. Deduplicate only exact identical duplicates (same rule_id, quote, and fix)
  // Findings from different rules are NOT duplicates just because they cover the same text.
  const deduplicated = [];
  const seenExact = new Set();

  for (const f of crossRuleMerged) {
    const key = `${f.rule_id}::${f.quote.toLowerCase()}::${(f.suggested_fix || "").toLowerCase()}`;
    if (seenExact.has(key)) {
      rejected.push({
        index: f.rawIndex,
        finding: f,
        rule_id: f.rule_id,
        quote: f.quote,
        reasons: [`Duplicate finding for [${f.rule_id}] on text "${f.quote}" dropped`]
      });
    } else {
      seenExact.add(key);
      deduplicated.push(f);
    }
  }

  return {
    accepted: deduplicated,
    rejected,
    merged: combinedMergedList,
    stats: {
      total_from_ai: rawList.length,
      total_checked: combinedRawFindings.length,
      kept: deduplicated.length,
      dropped: rejected.length,
      merged: totalMergedCount,
      accepted_count: deduplicated.length,
      rejected_count: rejected.length,
      merged_count: totalMergedCount
    }
  };
}
