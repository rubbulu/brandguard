import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { loadWorkspace, saveWorkspace } from "./workspaceStore.js";
import {
  createComplianceCertificate,
  getCertificateById,
  verifyCertificateIntegrity,
  tamperWithCertificate,
  restoreCertificate
} from "./certificateService.js";

async function runCertificateTest() {
  console.log("==================================================================");
  console.log("COMPLIANCE CERTIFICATE & INTEGRITY VERIFICATION TEST SUITE");
  console.log("==================================================================");

  // 1. Prepare CampusPro Draft
  const workspaceId = "test-cert-ws";
  const ws = loadWorkspace(workspaceId);

  const campusProDraft = {
    id: `draft-campuspro-${Date.now()}`,
    title: "CampusPro Launch Announcement",
    channel: "Social Media / Twitter",
    creator: "Marketing Creator",
    createdAt: new Date().toISOString(),
    status: "reviewed",
    version: 1,
    originalText: "Meet CampusPro, India's fastest laptop for students! Its battery lasts 3 days. Buy now!!",
    currentText: "Meet CampusPro, a powerful laptop for students. Up to 12 hours tested battery life. Explore CampusPro.",
    findings: [
      {
        id: "f-1",
        rule_id: "R-01",
        quote: "fastest",
        suggested_fix: "powerful",
        status: "accepted",
        severity: "high"
      },
      {
        id: "f-2",
        rule_id: "F-01",
        quote: "lasts 3 days",
        suggested_fix: "Up to 12 hours tested battery life",
        status: "accepted",
        severity: "high"
      },
      {
        id: "f-3",
        rule_id: "T-01",
        quote: "Buy now!!",
        suggested_fix: "Explore CampusPro.",
        status: "accepted",
        severity: "medium"
      }
    ],
    validatorRejected: [
      {
        rule_id: "R-02",
        quote: "for students",
        reasons: ["Compliant text flagged in error"]
      }
    ]
  };

  ws.drafts.unshift(campusProDraft);
  saveWorkspace(workspaceId, ws);
  console.log("✓ Step 1: Seeded CampusPro draft in workspace", workspaceId);

  // 2. Generate Compliance Certificate (Simulating Reviewer Click 'Approve Publication')
  console.log("\n--- STEP 2: Reviewer Approves Publication ---");
  const cert = createComplianceCertificate({
    draft: campusProDraft,
    workspace: ws,
    reviewerName: "Chief Brand Reviewer",
    reviewerNote: "All superlatives replaced with verified specs. Battery life cross-referenced against F-01."
  });

  campusProDraft.status = "approved";
  campusProDraft.certificate = cert;
  campusProDraft.certificates = [cert];
  saveWorkspace(workspaceId, ws);

  console.log("✓ Certificate Created Successfully!");
  console.log("  Certificate ID:", cert.certificateId);
  console.log("  Version:", cert.version);
  console.log("  Approved At:", cert.approvedAt);
  console.log("  Content Hash (SHA-256):", cert.contentHash);
  console.log("  Server Signature (HMAC-SHA256):", cert.signature);
  console.log("  Reviewer Label:", cert.reviewerLabel);
  console.log("  Integrity Status:", cert.integrityStatus);
  console.log("  Footnote:", cert.footnote);

  // 3. Independent Verification Without Workspace Context (Public /verify)
  console.log("\n--- STEP 3: Public /verify Independence Check ---");
  const storedCert = getCertificateById(cert.certificateId);
  if (!storedCert) {
    throw new Error("FAIL: Certificate was not found in disk registry!");
  }
  console.log("✓ Retrieved certificate from global disk registry without workspace cookie/session");

  const initialVerification = verifyCertificateIntegrity(storedCert);
  console.log("Initial Verification Result:");
  console.log("  Verified:", initialVerification.verified);
  console.log("  Status:", initialVerification.status);
  console.log("  Integrity Status:", initialVerification.integrityStatus);
  console.log("  Message:", initialVerification.message);
  console.log("  Hash Match:", initialVerification.recomputedHash === cert.contentHash);
  console.log("  Signature Match:", initialVerification.recomputedSignature === cert.signature);

  if (!initialVerification.verified) {
    throw new Error("FAIL: Initial certificate verification failed!");
  }

  // 4. Tamper Test: Modify 1 Character in Stored Data
  console.log("\n--- STEP 4: Tamper Test (Modify 1 Character) ---");
  const tamperedCert = tamperWithCertificate(cert.certificateId);
  console.log("Tampered stored text:", `"${tamperedCert.finalText}"`);

  const tamperedVerification = verifyCertificateIntegrity(tamperedCert);
  console.log("Tampered Verification Result:");
  console.log("  Verified:", tamperedVerification.verified, "(Expected: false)");
  console.log("  Status:", tamperedVerification.status, "(Expected: NOT_VERIFIED)");
  console.log("  Reason:", tamperedVerification.reason);
  console.log("  Expected Signature:", tamperedVerification.expectedSignature);
  console.log("  Recomputed Signature:", tamperedVerification.recomputedSignature);

  if (tamperedVerification.verified) {
    throw new Error("FAIL: Tampered certificate was falsely verified!");
  }
  console.log("✓ PASS: Tamper detection succeeded! HMAC signature mismatch caught altered character.");

  // 5. Restore Original Record
  console.log("\n--- STEP 5: Restore Original Record ---");
  const restoredCert = restoreCertificate(cert.certificateId);
  const restoredVerification = verifyCertificateIntegrity(restoredCert);
  console.log("Restored Verification Result:");
  console.log("  Verified:", restoredVerification.verified);
  console.log("  Status:", restoredVerification.status);
  console.log("  Integrity Status:", restoredVerification.integrityStatus);

  if (!restoredVerification.verified) {
    throw new Error("FAIL: Restored certificate failed verification!");
  }
  console.log("✓ PASS: Restored record returns to VERIFIED status.");

  // 6. Test Post-Approval Edit Versioning
  console.log("\n--- STEP 6: Post-Approval Edit Versioning ---");
  console.log("Current draft version:", campusProDraft.version);
  console.log("Current draft status:", campusProDraft.status);

  // Simulate an edit after approval
  campusProDraft.version = campusProDraft.version + 1;
  campusProDraft.status = "in_progress";
  campusProDraft.currentText = "Meet CampusPro, an ultra-fast laptop."; // Changed
  const oldCertId = campusProDraft.certificate.certificateId;
  campusProDraft.certificate = null; // New approval needed for v2
  saveWorkspace(workspaceId, ws);

  console.log("After post-approval edit:");
  console.log("  New version:", campusProDraft.version, "(v2)");
  console.log("  Draft status:", campusProDraft.status, "(in_progress, requires new approval)");
  console.log("  Active certificate for v2: null (requires new approval)");

  // Check if old certificate for v1 remains valid
  const v1Cert = getCertificateById(oldCertId);
  const v1Verify = verifyCertificateIntegrity(v1Cert);
  console.log("  Old v1 Certificate still valid at /verify:", v1Verify.verified, `(${v1Cert.certificateId})`);

  if (!v1Verify.verified) {
    throw new Error("FAIL: Previous certificate for v1 was invalidated by v2 edit!");
  }
  console.log("✓ PASS: Versioning rule satisfied. Old certificate stays valid for v1, v2 requires new approval.");

  console.log("\n==================================================================");
  console.log("ALL TESTS COMPLETED SUCCESSFULLY!");
  console.log("==================================================================");
  console.log("\nSample Certificate JSON Payload:\n");
  console.log(JSON.stringify(cert, null, 2));
}

runCertificateTest().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
