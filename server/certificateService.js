import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { ACTIVE_MODEL } from "./geminiService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERTIFICATES_DIR = path.join(__dirname, "data", "certificates");
if (!fs.existsSync(CERTIFICATES_DIR)) {
  fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
}

function getCertSecret() {
  return process.env.CERT_SECRET || "brandguard_default_cert_secret_key_8f9d3b2a";
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

function isCopyRule(ruleId) {
  if (!ruleId || typeof ruleId !== "string") return false;
  const upper = ruleId.trim().toUpperCase();
  return upper.startsWith("R-") || upper.startsWith("F-") || upper.startsWith("T-");
}

function recomputeApprovedCopy(originalText, findings = []) {
  let text = originalText || "";
  for (const f of findings) {
    if ((f.status === "accepted" || f.status === "edited") && isCopyRule(f.rule_id)) {
      if (f.action === "remove") {
        if (text && text.includes(f.quote)) {
          text = text.replace(f.quote, "").trim();
        }
      } else if (f.suggested_fix && f.suggested_fix !== "Needs manual edit") {
        if (text && text.includes(f.quote)) {
          text = text.replace(f.quote, f.suggested_fix);
        }
      }
    }
  }
  return text;
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
  // Only copy fixes (R-, F-, T-) change text; design fixes (V-01, V-02) stay as design notes
  const finalText = (
    recomputeApprovedCopy(draft.originalText, draft.findings || []) ||
    draft.currentText ||
    draft.originalText ||
    ""
  ).trim();
  const originalText = (draft.originalText || "").trim();
  const originalTextHash = crypto.createHash("sha256").update(originalText).digest("hex");

  // Collect checked rules and facts
  const activeRules = [
    ...(workspace.rules || []),
    ...(workspace.visualSettings?.rules || [])
  ].map(r => ({ id: r.id, text: r.text }));

  const activeFacts = (workspace.facts || []).map(f => f.id);

  const findings = draft.findings || [];
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
    channel: draft.channel || "Web / Campaign",
    finalText,
    originalTextHash,
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
  const signature = crypto.createHmac("sha256", getCertSecret()).update(canonicalString).digest("hex");

  const fullCertificate = {
    ...canonicalPayload,
    contentHash,
    signature,
    footnote: "This certificate proves the stored record has not changed since approval. It does not replace legal review.",
    verificationType: "tamper-evident (signed by the server)",
    integrityStatus: "integrity-verified"
  };

  // Persist certificate to disk for public /verify access
  saveCertificate(fullCertificate);

  return fullCertificate;
}

export function saveCertificate(cert) {
  try {
    const certPath = path.join(CERTIFICATES_DIR, `${cert.certificateId}.json`);
    fs.writeFileSync(certPath, JSON.stringify(cert, null, 2), "utf-8");
  } catch (err) {
    console.error(`[CertificateService] Failed to save certificate ${cert.certificateId}:`, err.message);
  }
}

export function getCertificateById(certificateId) {
  try {
    const safeId = certificateId.replace(/[^a-zA-Z0-9_-]/g, "");
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

  // Extract the original canonical fields
  const canonicalPayload = {
    certificateId: cert.certificateId,
    workspaceId: cert.workspaceId,
    draftId: cert.draftId,
    version: cert.version,
    title: cert.title,
    channel: cert.channel,
    finalText: cert.finalText,
    originalTextHash: cert.originalTextHash,
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
  const recomputedSignature = crypto.createHmac("sha256", getCertSecret()).update(recomputedCanonical).digest("hex");

  const hashMatches = recomputedHash === cert.contentHash;
  const signatureMatches = recomputedSignature === cert.signature;

  if (hashMatches && signatureMatches) {
    return {
      verified: true,
      status: "VERIFIED",
      integrityStatus: "integrity-verified",
      message: "Server signature matches stored record. The content, rules, and governance metadata are tamper-evident and unchanged since approval.",
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
 * Tamper test helper: Modifies one character of the stored certificate's finalText
 */
export function tamperWithCertificate(certificateId) {
  const cert = getCertificateById(certificateId);
  if (!cert) return null;

  if (!cert._originalFinalText) {
    cert._originalFinalText = cert.finalText;
  }

  // Alter exactly one character
  if (cert.finalText.endsWith("!")) {
    cert.finalText = cert.finalText.slice(0, -1) + "?";
  } else {
    cert.finalText = cert.finalText + " [TAMPERED]";
  }
  cert.isTampered = true;

  saveCertificate(cert);
  return cert;
}

/**
 * Restores tampered certificate back to its original approved text
 */
export function restoreCertificate(certificateId) {
  const cert = getCertificateById(certificateId);
  if (!cert) return null;

  if (cert._originalFinalText) {
    cert.finalText = cert._originalFinalText;
    delete cert._originalFinalText;
  }
  cert.isTampered = false;

  saveCertificate(cert);
  return cert;
}
