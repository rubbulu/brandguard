import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { ACTIVE_MODEL } from "./geminiService.js";
import { writeFileSyncAtomic } from "./workspaceStore.js";
import { ExpiringLRUCache } from "./lruCache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERTIFICATES_DIR = path.join(__dirname, "data", "certificates");
if (!fs.existsSync(CERTIFICATES_DIR)) {
  fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
}

// In-memory tampered certificates cache (bounded with LRU eviction, never written to disk)
export const inMemoryTamperedCerts = new ExpiringLRUCache({ maxSize: 50, ttlMs: 15 * 60 * 1000 });

const DEV_CERT_SECRET_FALLBACK = "DEV_ONLY_UNSECURE_SECRET_CHANGE_IN_PRODUCTION";

export function getCertSecret() {
  const secret = process.env.CERT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret || !secret.trim()) {
    if (isProd) {
      console.error("[CRITICAL SECURITY] CERT_SECRET environment variable is missing in production. Certificate issuance is disabled.");
      return null;
    }
    // Development only fallback
    return DEV_CERT_SECRET_FALLBACK;
  }

  return secret.trim();
}

/**
 * Deterministically sorts object keys for canonical JSON serialization
 */
export function canonicalizeJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(item => canonicalizeJson(item)).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  const keyVals = keys.map(k => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return "{" + keyVals.join(",") + "}";
}

/**
 * Tidies spacing and punctuation after phrase removals:
 * - Collapses multiple spaces to single space
 * - Removes space before punctuation (.,!?:;)
 * - Cleans orphaned punctuation before sentence ends (e.g. ",.")
 * - Collapses multiple consecutive commas
 * - Trims line starts and ends
 * - Capitalizes the sentence start if needed
 */
export function tidySpacingAndPunctuation(text) {
  if (typeof text !== "string") return "";
  let s = text;

  // 1. Remove space before punctuation (.,!?:;)
  s = s.replace(/[ \t]+([,.:;!?])/g, "$1");

  // 2. Remove orphaned commas/colons/semicolons before end punctuation
  s = s.replace(/[,;:]\s*([.!?])/g, "$1");

  // 3. Collapse multiple consecutive commas e.g. ", ," -> ","
  s = s.replace(/,([ \t]*,)+/g, ",");

  // 4. Collapse multiple spaces and tabs to single space
  s = s.replace(/[ \t]{2,}/g, " ");

  // 5. Remove space at line starts/ends
  s = s.replace(/^[ \t]+/gm, "").replace(/[ \t]+$/gm, "");

  // 6. Clean empty lines with only punctuation or whitespace
  s = s.replace(/^\s*[\r\n]/gm, "");

  // 7. Capitalize first letter of entire text if it's a lower case letter
  s = s.replace(/^([a-z])/, (match, p1) => p1.toUpperCase());

  // 8. Capitalize sentence start after [.!?]\s+ or \n+\s*
  s = s.replace(/([.!?]\s+)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());
  s = s.replace(/(\n+[ \t]*)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());

  return s.trim();
}

/**
 * Checks if a rule ID is a copy rule (R-, F-, T-) or security line removal (SEC-01).
 * Design fixes (V-01, V-02, etc.) are instructions for a designer and never tag text changes.
 */
export function isCopyRule(ruleId) {
  if (!ruleId || typeof ruleId !== "string") return false;
  const upper = ruleId.trim().toUpperCase();
  return upper.startsWith("R-") || upper.startsWith("F-") || upper.startsWith("T-") || upper === "SEC-01";
}

/**
 * Recomputes draft text from originalText and active accepted/edited findings.
 * Replaces each accepted fix at its own position (using stored start/end offsets when available)
 * instead of the first text.replace match, so repeated phrases change only where accepted.
 * Removes phrases cleanly and tidies spacing/punctuation if removals took place.
 */
export function recomputeDraftText(originalText, findings = []) {
  if (!originalText || typeof originalText !== "string") return "";
  if (!Array.isArray(findings) || findings.length === 0) return originalText;

  // Active findings are accepted or edited copy fixes (including SEC-01)
  const activeFindings = findings.filter(
    f => (f.status === "accepted" || f.status === "edited") && isCopyRule(f.rule_id)
  );
  if (activeFindings.length === 0) return originalText;

  // Track assigned start positions to handle multiple occurrences of the same quote
  const usedOffsets = new Set();
  const replacements = [];

  for (const f of activeFindings) {
    if (!f.quote) continue;

    let start = typeof f.startIndex === "number" ? f.startIndex : (typeof f.start === "number" ? f.start : (typeof f.offset === "number" ? f.offset : -1));
    let end = typeof f.endIndex === "number" ? f.endIndex : (typeof f.end === "number" ? f.end : -1);

    // If offset is missing or invalid, locate position in originalText avoiding already used offsets
    if (start < 0) {
      let searchIdx = 0;
      let foundIdx = -1;
      while ((foundIdx = originalText.indexOf(f.quote, searchIdx)) !== -1) {
        if (!usedOffsets.has(foundIdx)) {
          break;
        }
        searchIdx = foundIdx + 1;
      }
      if (foundIdx !== -1) {
        start = foundIdx;
        end = foundIdx + f.quote.length;
      }
    }

    if (start >= 0) {
      if (end <= start) {
        end = start + f.quote.length;
      }
      usedOffsets.add(start);

      let replacementText = "";
      if (f.action === "remove" || !f.suggested_fix || f.suggested_fix.trim() === "" || f.suggested_fix === "Remove this phrase" || f.rule_id === "SEC-01") {
        replacementText = "";
      } else if (f.suggested_fix && f.suggested_fix !== "Needs manual edit") {
        replacementText = f.suggested_fix;
      } else {
        continue;
      }

      replacements.push({
        start,
        end,
        quote: f.quote,
        replacementText
      });
    }
  }

  // Sort replacements descending by start position (from right to left)
  // This guarantees earlier character indices remain unchanged!
  replacements.sort((a, b) => b.start - a.start);

  let result = originalText;
  let hasRemoval = false;
  for (const rep of replacements) {
    if (rep.replacementText === "") {
      hasRemoval = true;
    }
    result = result.slice(0, rep.start) + rep.replacementText + result.slice(rep.end);
  }

  if (hasRemoval) {
    result = tidySpacingAndPunctuation(result);
  }

  return result;
}

/**
 * Builds canonical compliance certificate for an approved draft
 */
export function createComplianceCertificate({
  draft,
  workspace,
  reviewerName = "Reviewer",
  reviewerNote = ""
}) {
  const certificateId = `cert_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const approvedAt = new Date().toISOString();

  // Final text computation: uses recomputeDraftText to ensure all accepted copy & SEC-01 removals are applied
  const hasFindings = Array.isArray(draft.findings) && draft.findings.length > 0;
  const recomputed = hasFindings ? recomputeDraftText(draft.originalText, draft.findings) : null;
  const finalText = (
    typeof recomputed === "string" ? recomputed : (typeof draft.currentText === "string" ? draft.currentText : (draft.originalText || ""))
  ).trim();

  if (!draft.isVisual && (!finalText || !finalText.trim())) {
    const emptyErr = new Error("The copy is empty and cannot be certified.");
    emptyErr.code = "EMPTY_COPY";
    throw emptyErr;
  }

  const finalTextHash = crypto.createHash("sha256").update(finalText).digest("hex");
  const originalText = (draft.originalText || "").trim();
  const originalTextHash = crypto.createHash("sha256").update(originalText).digest("hex");

  // Security finding check
  const findings = draft.findings || [];
  const secFinding = findings.find(f => f.rule_id === "SEC-01" || f.source === "security");
  const isSecOverridden = secFinding && secFinding.status === "rejected";
  const isCodeOnly = Boolean(draft.aiReviewFailed);
  const status = isSecOverridden
    ? "Issued with override"
    : (isCodeOnly ? "Reviewed by code checks only" : "Compliant");
  const securityOverride = isSecOverridden ? "Security finding overridden by creator" : null;

  // Tone profile channel
  const channel = draft.channel || "Web / Campaign";

  // Collect checked rules and facts
  const allWorkspaceRules = [
    ...(workspace.rules || []),
    ...(workspace.visualSettings?.rules || [])
  ];

  const activeRules = allWorkspaceRules.map(r => ({ id: r.id, text: r.text }));
  const activeFacts = (workspace.facts || []).map(f => f.id);

  // Structured findings list (accepted, edited, rejected)
  const findingsList = findings
    .filter(f => f.status === "accepted" || f.status === "edited" || f.status === "rejected")
    .map(f => {
      const isDesign = (f.rule_id || "").toUpperCase().startsWith("V-") || f.source === "contrast" || f.source === "palette" || f.source === "alt_text";
      const isRemoval = f.action === "remove" || !f.suggested_fix || f.suggested_fix.trim() === "" || f.rule_id === "SEC-01";
      const type = isDesign ? "design" : (isRemoval ? "removal" : "text");
      const matchedRule = allWorkspaceRules.find(r => r.id === f.rule_id);
      return {
        rule_id: f.rule_id,
        type,
        status: f.status,
        ruleVersion: matchedRule?.version || 1
      };
    });

  // Design instructions list from accepted/edited design findings
  const designInstructions = findings
    .filter(f =>
      (f.status === "accepted" || f.status === "edited") &&
      ((f.rule_id || "").toUpperCase().startsWith("V-") || f.source === "contrast" || f.source === "palette" || f.source === "alt_text")
    )
    .map(f => f.suggested_fix || f.explanation || `Design instruction for ${f.rule_id}`);

  const findingsSummary = {
    kept: findings.length,
    accepted: findings.filter(f => f.status === "accepted").length,
    edited: findings.filter(f => f.status === "edited").length,
    rejected: findings.filter(f => f.status === "rejected").length,
    dropped_by_validator: draft.validatorRejected?.length || 0
  };

  const canonicalPayload = {
    certificateId,
    workspaceId: workspace.id || "default",
    draftId: draft.id,
    version: draft.version || 1,
    title: draft.title || "Untitled Draft",
    channel,
    status,
    securityOverride,
    finalText,
    finalTextHash,
    originalTextHash,
    designInstructions,
    findingsList,
    rulesChecked: activeRules,
    factsChecked: activeFacts,
    findingsSummary,
    reviewerLabel: `${reviewerName} (demo role)`,
    reviewerNote: reviewerNote || "Approved for publication following pre-publication brand governance check.",
    approvedAt,
    aiModel: draft.modelUsed || ACTIVE_MODEL || "gemini-flash-lite-latest",
    aiToolsDisclosure: `Google Gemini (${draft.modelUsed || ACTIVE_MODEL || "gemini-flash-lite-latest"}) for semantic brand compliance, Sharp for typography WCAG contrast & CIE Lab palette validation, deterministic BrandGuard security scanner for prompt injection defense.`
  };

  const canonicalString = canonicalizeJson(canonicalPayload);
  const contentHash = crypto.createHash("sha256").update(canonicalString).digest("hex");
  const certSecret = getCertSecret();
  if (!certSecret) {
    const err = new Error("Certificate issuance disabled: CERT_SECRET environment variable is missing in production.");
    err.code = "CERT_SECRET_MISSING";
    throw err;
  }
  const signature = crypto.createHmac("sha256", certSecret).update(canonicalString).digest("hex");

  const fullCertificate = {
    ...canonicalPayload,
    contentHash,
    signature,
    footnote: "This certificate proves the stored record has not changed since approval. It does not replace legal review.",
    verificationType: "tamper-evident, signed by the server",
    integrityStatus: isSecOverridden ? "issued-with-override" : "integrity-verified"
  };

  // Persist certificate to disk for public /verify access
  saveCertificate(fullCertificate);

  return fullCertificate;
}

export function saveCertificate(cert) {
  try {
    const safeId = cert.certificateId.replace(/[^a-zA-Z0-9_-]/g, "");
    const certPath = path.join(CERTIFICATES_DIR, `${safeId}.json`);
    writeFileSyncAtomic(certPath, JSON.stringify(cert, null, 2));
  } catch (err) {
    console.error(`[CertificateService] Failed to save certificate ${cert.certificateId}:`, err.message);
  }
}

export function getCertificateById(certificateId, { ignoreMemory = false } = {}) {
  try {
    const safeId = certificateId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!ignoreMemory && inMemoryTamperedCerts.has(safeId)) {
      return inMemoryTamperedCerts.get(safeId);
    }
    const certPath = path.join(CERTIFICATES_DIR, `${safeId}.json`);
    if (fs.existsSync(certPath)) {
      return JSON.parse(fs.readFileSync(certPath, "utf-8"));
    }
  } catch (err) {
    console.warn(`[CertificateService] Error reading certificate ${certificateId}:`, err.message);
  }
  return null;
}

/**
 * Recomputes hash and HMAC signature to verify data integrity
 */
export function verifyCertificateIntegrity(cert) {
  if (!cert || !cert.certificateId || !cert.signature) {
    return {
      verified: false,
      status: "NOT_VERIFIED",
      reason: "Malformed certificate: missing ID or signature."
    };
  }

  const certSecret = getCertSecret();
  if (!certSecret) {
    return {
      verified: false,
      status: "NOT_VERIFIED",
      reason: "Certificate verification disabled: CERT_SECRET is missing in production.",
      certificate: cert
    };
  }

  // Extract the original canonical fields
  const canonicalPayload = {
    certificateId: cert.certificateId,
    workspaceId: cert.workspaceId,
    draftId: cert.draftId,
    version: cert.version,
    title: cert.title,
    channel: cert.channel,
    status: cert.status,
    securityOverride: cert.securityOverride,
    finalText: cert.finalText,
    finalTextHash: cert.finalTextHash,
    originalTextHash: cert.originalTextHash,
    designInstructions: cert.designInstructions || [],
    findingsList: cert.findingsList || [],
    rulesChecked: cert.rulesChecked,
    factsChecked: cert.factsChecked,
    findingsSummary: cert.findingsSummary,
    reviewerLabel: cert.reviewerLabel,
    reviewerNote: cert.reviewerNote,
    approvedAt: cert.approvedAt,
    aiModel: cert.aiModel,
    aiToolsDisclosure: cert.aiToolsDisclosure
  };

  const recomputedCanonical = canonicalizeJson(canonicalPayload);
  const recomputedHash = crypto.createHash("sha256").update(recomputedCanonical).digest("hex");
  const recomputedSignature = crypto.createHmac("sha256", certSecret).update(recomputedCanonical).digest("hex");

  const hashMatches = recomputedHash === cert.contentHash;
  const signatureMatches = recomputedSignature === cert.signature;

  // Verify finalText matches stored finalTextHash
  const computedFinalTextHash = crypto.createHash("sha256").update(cert.finalText || "").digest("hex");
  const finalTextHashMatches = !cert.finalTextHash || computedFinalTextHash === cert.finalTextHash;

  if (hashMatches && signatureMatches && finalTextHashMatches) {
    return {
      verified: true,
      status: cert.status || "Compliant",
      securityOverride: cert.securityOverride || null,
      integrityStatus: cert.status === "Issued with override" ? "issued-with-override" : "integrity-verified",
      message: cert.status === "Issued with override"
        ? "Server signature verified. Note: Issued with override (Security finding overridden by creator)."
        : "Server signature matches stored record. The content, rules, and governance metadata are tamper-evident, signed by the server and unchanged since approval.",
      certificate: cert,
      recomputedHash,
      recomputedSignature
    };
  }

  const reasons = [];
  if (!hashMatches) {
    reasons.push("SHA-256 payload digest mismatch (content was altered after approval).");
  }
  if (!signatureMatches) {
    reasons.push("HMAC-SHA256 signature verification failed against server signing key.");
  }
  if (!finalTextHashMatches) {
    reasons.push("Final copy hash mismatch: finalText does not match stored finalTextHash.");
  }

  return {
    verified: false,
    status: "NOT_VERIFIED",
    integrityStatus: "tamper-detected",
    reason: reasons.join(" ") || "Signature mismatch: Record has been modified.",
    certificate: cert,
    expectedHash: cert.contentHash,
    recomputedHash,
    expectedSignature: cert.signature,
    recomputedSignature
  };
}

/**
 * Tamper test helper: Modifies one character on an in-memory copy only.
 * The stored certificate on disk is NEVER modified!
 */
export function tamperWithCertificate(certificateId) {
  const safeId = certificateId.replace(/[^a-zA-Z0-9_-]/g, "");
  const cert = getCertificateById(safeId, { ignoreMemory: true });
  if (!cert) return null;

  // Create deep clone in-memory
  const copy = JSON.parse(JSON.stringify(cert));

  // Alter exactly one character or append tampered marker in memory
  if (copy.finalText && copy.finalText.endsWith("!")) {
    copy.finalText = copy.finalText.slice(0, -1) + "?";
  } else {
    copy.finalText = (copy.finalText || "") + " [TAMPERED]";
  }
  copy.isTampered = true;

  // Store only in in-memory LRU cache; NEVER write to disk!
  inMemoryTamperedCerts.set(safeId, copy);
  return copy;
}

/**
 * Restores tampered certificate back to original approved record.
 * Simply evicts the in-memory tampered copy; disk record was untouched.
 */
export function restoreCertificate(certificateId) {
  const safeId = certificateId.replace(/[^a-zA-Z0-9_-]/g, "");
  inMemoryTamperedCerts.delete(safeId);
  return getCertificateById(safeId, { ignoreMemory: true });
}
