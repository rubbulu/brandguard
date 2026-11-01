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

import { INITIAL_TONE_PROFILES } from "./demoData.js";

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
 * Helper to identify all-caps words in text:
 * - Minimum 2 letters
 * - Fully uppercase (/^[A-Z]+$/)
 * - Ignores single letters like "A" or "I"
 * - Ignores brand terms and acronyms that appear in brandTerms
 */
export function getAllCapsWords(text, brandTerms = ["CampusPro"]) {
  if (!text || typeof text !== "string") return [];
  const words = text.match(/\b[A-Za-z0-9'-]+\b/g) || [];
  const brandSet = new Set((brandTerms || ["CampusPro"]).map(b => (b || "").trim().toUpperCase()));

  return words.filter(w => {
    if (w.length < 2) return false;
    if (!/^[A-Z]+$/.test(w)) return false;
    if (brandSet.has(w.toUpperCase())) return false;
    return true;
  });
}

/**
 * Normalizes and resolves channel tone profile
 */
export function resolveChannelProfile(channel, toneProfiles = INITIAL_TONE_PROFILES) {
  const profiles = toneProfiles && typeof toneProfiles === "object" ? toneProfiles : INITIAL_TONE_PROFILES;
  const clean = (channel || "Social Media / Twitter").trim();

  if (profiles[clean]) {
    return { channelName: clean, profile: profiles[clean] };
  }

  const lower = clean.toLowerCase();
  for (const ch of Object.keys(profiles)) {
    if (ch.toLowerCase() === lower) {
      return { channelName: ch, profile: profiles[ch] };
    }
  }

  if (lower.includes("twitter") || lower.includes("tweet") || lower.includes("social")) {
    const key = Object.keys(profiles).find(k => k.toLowerCase().includes("twitter")) || "Social Media / Twitter";
    return { channelName: key, profile: profiles[key] };
  }
  if (lower.includes("email") || lower.includes("newsletter")) {
    const key = Object.keys(profiles).find(k => k.toLowerCase().includes("email")) || "Marketing Email";
    return { channelName: key, profile: profiles[key] };
  }
  if (lower.includes("landing") || lower.includes("page") || lower.includes("web")) {
    const key = Object.keys(profiles).find(k => k.toLowerCase().includes("landing")) || "Product Landing Page";
    return { channelName: key, profile: profiles[key] };
  }
  if (lower.includes("banner") || lower.includes("ad") || lower.includes("display")) {
    const key = Object.keys(profiles).find(k => k.toLowerCase().includes("banner")) || "Ad Copy / Banner";
    return { channelName: key, profile: profiles[key] };
  }

  return {
    channelName: "Social Media / Twitter",
    profile: profiles["Social Media / Twitter"] || INITIAL_TONE_PROFILES["Social Media / Twitter"]
  };
}

/**
 * Deterministic tone checks that run on every text draft, independent of Gemini:
 * - T-05: Flags any word of 2+ letters that is fully uppercase above the channel limit,
 *         exempting brandTerms.
 * - T-03: Flags exclamation marks above the channel's maxExclamationMarks.
 * - T-06: Flags text longer than the channel's maxCharacters limit.
 */
export function runDeterministicToneChecks(
  draftText,
  rules = [],
  brandTerms = ["CampusPro"],
  channel = "Social Media / Twitter",
  toneProfile = null
) {
  const findings = [];
  if (!draftText || typeof draftText !== "string" || !draftText.trim()) return findings;

  const ruleIds = new Set(rules.map(r => (r.id || "").toUpperCase()));
  const hasT05 = rules.length === 0 || ruleIds.has("T-05");
  const hasT03 = rules.length === 0 || ruleIds.has("T-03");
  const hasT06 = rules.length === 0 || ruleIds.has("T-06");

  const { channelName, profile } = toneProfile
    ? { channelName: channel || "Social Media / Twitter", profile: toneProfile }
    : resolveChannelProfile(channel, INITIAL_TONE_PROFILES);

  // --- T-05: Channel max all-caps words limit ---
  if (hasT05) {
    const maxCaps = typeof profile.maxAllCapsWords === "number" ? profile.maxAllCapsWords : 0;
    const allCapsWords = getAllCapsWords(draftText, brandTerms);
    if (allCapsWords.length > maxCaps) {
      const explanation = `${channelName} allows at most ${maxCaps} all-caps word${maxCaps === 1 ? "" : "s"}; found ${allCapsWords.length}.`;
      const sentenceRegex = /[^.!?\n]+(?:[.!?\n]+|$)/g;
      let m;
      while ((m = sentenceRegex.exec(draftText)) !== null) {
        const rawSentence = m[0];
        const trimmed = rawSentence.trim();
        if (!trimmed) continue;

        const sentenceCaps = getAllCapsWords(trimmed, brandTerms);
        if (sentenceCaps.length > 0) {
          const fix = convertToSentenceCase(trimmed, brandTerms);
          if (fix !== trimmed) {
            findings.push({
              quote: trimmed,
              rule_id: "T-05",
              category: "tone",
              severity: "low",
              explanation,
              suggested_fix: fix,
              action: "replace",
              needs_human_judgement: false
            });
          }
        }
      }
    }
  }

  // --- T-03: Friendly tone. Channel max exclamation marks ---
  if (hasT03) {
    const maxEx = typeof profile.maxExclamationMarks === "number" ? profile.maxExclamationMarks : 1;
    const totalExMarks = (draftText.match(/!/g) || []).length;
    if (totalExMarks > maxEx) {
      const explanation = `${channelName} allows at most ${maxEx} exclamation mark${maxEx === 1 ? "" : "s"}; found ${totalExMarks}.`;
      const runMatches = draftText.match(/!{2,}/g);
      if (runMatches && runMatches.length > 0) {
        // Highlight the exact extra occurrence (e.g. for "Buy now!!" highlight the "!!")
        const uniqueRuns = Array.from(new Set(runMatches));
        for (const run of uniqueRuns) {
          findings.push({
            quote: run,
            rule_id: "T-03",
            category: "tone",
            severity: "low",
            explanation,
            suggested_fix: maxEx === 0 ? "." : "!",
            action: "replace",
            needs_human_judgement: false
          });
        }
      } else {
        // Scattered exclamation marks across sentences
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
          seenExMarks += s.exCount;
          if (seenExMarks > maxEx) {
            const fix = s.trimmed.replace(/!+/g, ".");
            findings.push({
              quote: s.trimmed,
              rule_id: "T-03",
              category: "tone",
              severity: "low",
              explanation,
              suggested_fix: fix,
              action: "replace",
              needs_human_judgement: false
            });
          }
        }
      }
    }
  }

  // --- T-06: Channel max character limit ---
  if (hasT06 && typeof profile.maxCharacters === "number" && profile.maxCharacters > 0) {
    const maxChars = profile.maxCharacters;
    const charCount = draftText.length;
    if (charCount > maxChars) {
      const explanation = `${channelName} allows at most ${maxChars} characters; found ${charCount}.`;
      const excess = draftText.slice(maxChars);
      const quote = excess.trim() || excess;
      findings.push({
        quote,
        rule_id: "T-06",
        category: "tone",
        severity: "medium",
        explanation,
        suggested_fix: "",
        action: "remove",
        needs_human_judgement: true
      });
    }
  }

  return findings;
}

/**
 * Compare code-based tone checks across all 4 channels instantly without AI calls
 */
export function compareChannelTones(
  draftText,
  rules = [],
  brandTerms = ["CampusPro"],
  toneProfiles = INITIAL_TONE_PROFILES
) {
  const channels = [
    "Social Media / Twitter",
    "Marketing Email",
    "Product Landing Page",
    "Ad Copy / Banner"
  ];

  return channels.map(channel => {
    const prof = (toneProfiles && toneProfiles[channel]) || INITIAL_TONE_PROFILES[channel];
    const findings = runDeterministicToneChecks(draftText, rules, brandTerms, channel, prof);
    return {
      channel,
      profile: prof,
      findings
    };
  });
}

export function validateFindings(
  draftText,
  rawFindings,
  rules = [],
  facts = [],
  brandTerms = ["CampusPro"],
  channel = "Social Media / Twitter",
  toneProfile = null
) {
  const validRuleIds = new Set([
    ...rules.map(r => r.id.trim().toUpperCase()),
    ...facts.map(f => f.id.trim().toUpperCase()),
    "SEC-01", "V-01", "V-02", "V-03", "V-04", "T-06"
  ]);

  const { channelName, profile } = toneProfile
    ? { channelName: channel || "Social Media / Twitter", profile: toneProfile }
    : resolveChannelProfile(channel, INITIAL_TONE_PROFILES);

  // Run deterministic checks that run on every text draft, independent of Gemini
  const deterministicToneFindings = runDeterministicToneChecks(
    draftText,
    rules,
    brandTerms,
    channel,
    profile
  );

  const rawList = Array.isArray(rawFindings)
    ? rawFindings
    : (rawFindings && Array.isArray(rawFindings.findings) ? rawFindings.findings : []);
  const combinedRawFindings = [...rawList, ...deterministicToneFindings];

  const accepted = [];
  const rejected = [];
  const usedQuoteIndices = new Map();

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

    // T-05 check: only fire when all-caps words exceed channel limit
    if (ruleId === "T-05") {
      const allCapsWords = getAllCapsWords(draftText, brandTerms);
      const maxCaps = typeof profile.maxAllCapsWords === "number" ? profile.maxAllCapsWords : 0;
      if (allCapsWords.length <= maxCaps) {
        rejectionReasons.push(`Draft text has ${allCapsWords.length} all-caps words, which does not exceed the limit of ${maxCaps} for ${channelName}.`);
      } else {
        const quoteCaps = getAllCapsWords(quote, brandTerms);
        if (quoteCaps.length === 0) {
          rejectionReasons.push("No all-caps words found in flagged text (T-05 only applies to all-caps words)");
        }
      }
    }

    // T-03 check: Rule T-03 (exclamation marks) decided by code, not model.
    // Flag T-03 only if exclamation marks exceed channel maxExclamationMarks.
    const maxEx = typeof profile.maxExclamationMarks === "number" ? profile.maxExclamationMarks : 1;
    const totalExMarks = (draftText.match(/!/g) || []).length;
    const hasRunOfExMarks = Boolean(draftText.match(/!{2,}/));

    if (ruleId === "T-03") {
      if (totalExMarks <= maxEx) {
        rejectionReasons.push(`Draft text has ${totalExMarks} exclamation mark${totalExMarks === 1 ? "" : "s"}, which does not exceed the limit of ${maxEx} for ${channelName}.`);
      } else if (hasRunOfExMarks) {
        // Highlight exactly the run of exclamation marks
        const runMatch = quote.match(/!{2,}/) || draftText.match(/!{2,}/);
        quote = runMatch ? runMatch[0] : quote;
        suggestedFix = maxEx === 0 ? "." : "!";
        finding.action = "replace";
        finding.needs_human_judgement = false;
      } else {
        // For scattered exclamation marks, ensure quote highlights the sentence with excess '!'
        const excessFinding = deterministicToneFindings.find(df => df.rule_id === "T-03");
        if (excessFinding) {
          quote = excessFinding.quote;
          suggestedFix = excessFinding.suggested_fix;
          finding.action = "replace";
          finding.needs_human_judgement = false;
        }
      }
    }

    // T-06 check: text length limit
    if (ruleId === "T-06") {
      if (typeof profile.maxCharacters !== "number" || profile.maxCharacters === 0 || draftText.length <= profile.maxCharacters) {
        rejectionReasons.push(`Draft text length (${draftText.length} characters) does not exceed the limit of ${profile.maxCharacters || "no limit"} for ${channelName}.`);
      }
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
      // If a fact fix contains an unverified claim (such as "reliable") not supported by the fact,
      // build a compliant fix directly from the fact text in the approved library (never a hard-coded literal string).
      if (ruleId.startsWith("F-") && /\breliable\b/i.test(suggestedFix)) {
        const matchedFact = facts.find(f => f.id.trim().toUpperCase() === ruleId.trim().toUpperCase());
        if (matchedFact && matchedFact.text) {
          const cleanText = matchedFact.text.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "").trim();
          const tokens = cleanText.split(/\s+/);
          const startsWithBrand = brandTerms.some(b => b.toLowerCase() === tokens[0]?.toLowerCase());
          const clause = startsWithBrand ? tokens.slice(1).join(" ") : tokens.join(" ");
          suggestedFix = clause.charAt(0).toUpperCase() + clause.slice(1) + ".";
        }
      }
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
      // Resolve start and end character offsets in draftText
      let startOffset = typeof finding.startIndex === "number" ? finding.startIndex : (typeof finding.start === "number" ? finding.start : -1);
      let endOffset = typeof finding.endIndex === "number" ? finding.endIndex : (typeof finding.end === "number" ? finding.end : -1);

      if (startOffset < 0 && draftText && quote) {
        const fromIdx = (usedQuoteIndices.get(quote) !== undefined ? usedQuoteIndices.get(quote) + 1 : 0);
        const nextIdx = draftText.indexOf(quote, fromIdx);
        if (nextIdx !== -1) {
          startOffset = nextIdx;
          endOffset = nextIdx + quote.length;
          usedQuoteIndices.set(quote, nextIdx);
        } else {
          const firstIdx = draftText.indexOf(quote);
          if (firstIdx !== -1) {
            startOffset = firstIdx;
            endOffset = firstIdx + quote.length;
          }
        }
      }

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
        rawIndex: i,
        start: startOffset >= 0 ? startOffset : undefined,
        end: endOffset >= 0 ? endOffset : undefined,
        startIndex: startOffset >= 0 ? startOffset : undefined,
        endIndex: endOffset >= 0 ? endOffset : undefined
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
