import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { EventEmitter } from "events";
import {
  createComplianceCertificate,
  verifyCertificateIntegrity,
  tamperWithCertificate,
  restoreCertificate,
  getCertSecret,
  inMemoryTamperedCerts
} from "../certificateService.js";
import {
  loadWorkspace,
  saveWorkspace,
  updateWorkspace,
  sanitizeWorkspaceId,
  workspaceCache
} from "../workspaceStore.js";
import { ExpiringLRUCache } from "../lruCache.js";
import { app } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CERTIFICATES_DIR = path.join(__dirname, "..", "data", "certificates");
const WORKSPACES_DIR = path.join(__dirname, "..", "data", "workspaces");

function invokeApp(options) {
  const { method = "GET", url = "/", headers = {}, body = null } = options;
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    if (payload && !req.headers["content-type"]) {
      req.headers["content-type"] = "application/json";
    }
    if (payload) {
      req.headers["content-length"] = Buffer.byteLength(payload).toString();
    }

    const chunks = [];
    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.removeHeader = (k) => { delete res._headers[k.toLowerCase()]; };
    res.write = (c) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return true;
    };
    res.end = (c) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode,
        statusCode: res.statusCode,
        headers: res._headers,
        text: async () => text,
        json: async () => (text ? JSON.parse(text) : null)
      });
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
      else {
        resolve({
          status: 404,
          statusCode: 404,
          headers: res._headers,
          text: async () => "Not Found",
          json: async () => ({ error: "Not Found" })
        });
      }
    });
  });
}

describe("Prompt 6b: Storage and Reliability Hardening", () => {

  // Test 1: Item 6 - Lost workspace detection and clean restart without crashing
  test("Item 6: lost workspace returns friendly status and initializes clean workspace", async () => {
    const nonExistentWsId = `ws_lost_${Date.now()}`;
    const filePath = path.join(WORKSPACES_DIR, `${nonExistentWsId}.json`);

    // Ensure file does not exist
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    workspaceCache.delete(nonExistentWsId);

    // Call workspace status via API
    const res = await invokeApp({
      method: "GET",
      url: "/api/workspace/status",
      headers: { "x-workspace-id": nonExistentWsId }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.workspaceId, nonExistentWsId);
    assert.equal(body.wasReset, true);
    assert.equal(body.wasMissing, true);
    assert.equal(res.headers["x-workspace-reset"], "1");

    // Second call to status must immediately report no reset
    const resSecond = await invokeApp({
      method: "GET",
      url: "/api/workspace/status",
      headers: { "x-workspace-id": nonExistentWsId }
    });
    const bodySecond = await resSecond.json();
    assert.equal(bodySecond.wasReset, false, "Second call must report wasReset: false");
    assert.equal(resSecond.headers["x-workspace-reset"], "0", "Second call must set X-Workspace-Reset to 0");

    // Workspace now exists on disk as a clean seeded workspace
    assert.ok(fs.existsSync(filePath));
    const cleanWs = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.ok(Array.isArray(cleanWs.rules));
    assert.ok(Array.isArray(cleanWs.drafts));
    assert.equal(cleanWs.drafts.length, 0, "Clean workspace must have empty drafts list");

    // Clean up
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    workspaceCache.delete(nonExistentWsId);
  });

  test("workspace reset single reporting and refresh persistence (Round 3 fix)", async () => {
    const wsId = `ws_single_reset_${Date.now()}`;
    const filePath = path.join(WORKSPACES_DIR, `${wsId}.json`);

    // Ensure clean state: missing workspace
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    workspaceCache.delete(wsId);

    // 1. First load with a missing workspace reports reset once
    const res1 = await invokeApp({
      method: "GET",
      url: "/api/rules",
      headers: { "x-workspace-id": wsId }
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.headers["x-workspace-reset"], "1", "First load of missing workspace must report reset once (header=1)");

    // 2. Second load reports no reset
    const res2 = await invokeApp({
      method: "GET",
      url: "/api/rules",
      headers: { "x-workspace-id": wsId }
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.headers["x-workspace-reset"], "0", "Second load must report no reset (header=0)");

    const statusRes = await invokeApp({
      method: "GET",
      url: "/api/workspace/status",
      headers: { "x-workspace-id": wsId }
    });
    const statusBody = await statusRes.json();
    assert.equal(statusBody.wasReset, false, "Subsequent status check must report wasReset: false");
    assert.equal(statusRes.headers["x-workspace-reset"], "0");

    // 3. An existing workspace never reports reset
    const postDraftRes = await invokeApp({
      method: "POST",
      url: "/api/drafts",
      headers: { "x-workspace-id": wsId },
      body: {
        title: "Test Draft Refresh Survival",
        channel: "Social Media / Twitter",
        content: "CampusPro is a modern platform."
      }
    });
    assert.equal(postDraftRes.status, 201);
    const createdDraft = await postDraftRes.json();
    assert.ok(createdDraft.id);
    assert.equal(postDraftRes.headers["x-workspace-reset"], "0", "Existing workspace operation must never report reset");

    // 4. Refresh keeps the workspace and its drafts
    // Invalidate in-memory cache to simulate server restart / fresh reload from disk
    workspaceCache.delete(wsId);

    const refreshDraftsRes = await invokeApp({
      method: "GET",
      url: "/api/drafts",
      headers: { "x-workspace-id": wsId }
    });
    assert.equal(refreshDraftsRes.status, 200);
    assert.equal(refreshDraftsRes.headers["x-workspace-reset"], "0", "Refresh with existing workspace must never report reset");

    const draftsList = await refreshDraftsRes.json();
    assert.ok(Array.isArray(draftsList));
    assert.equal(draftsList.length, 1, "Refresh must keep drafts list");
    assert.equal(draftsList[0].id, createdDraft.id, "Draft ID must match original");
    assert.equal(draftsList[0].originalText, "CampusPro is a modern platform.");

    // Clean up
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    workspaceCache.delete(wsId);
  });

  // Test 2: Item 7 - Certificates survive server restart via self-contained record verification
  test("Item 7: self-contained certificate verifies even if disk record is deleted, friendly 404 if missing", async () => {
    const mockWorkspace = {
      id: "ws-cert-restart-test",
      rules: [{ id: "R-01", text: "Say 'platform', not 'tool'." }],
      facts: []
    };
    const mockDraft = {
      id: "d-restart-test",
      title: "Restart Survival Campaign",
      channel: "Social Media / Twitter",
      originalText: "CampusPro is a great platform for colleges.",
      findings: []
    };

    // 1. Issue certificate
    const cert = createComplianceCertificate({
      draft: mockDraft,
      workspace: mockWorkspace,
      reviewerName: "VP Brand"
    });
    assert.ok(cert.certificateId);
    assert.ok(cert.signature);

    const certPath = path.join(CERTIFICATES_DIR, `${cert.certificateId}.json`);
    assert.ok(fs.existsSync(certPath), "Certificate must be stored on disk initially");

    // 2. Simulate ephemeral disk wipe on restart (delete the certificate JSON from disk)
    fs.unlinkSync(certPath);
    assert.ok(!fs.existsSync(certPath), "Disk record is now wiped");

    // 3. GET /api/verify/:id returns friendly 'not stored' message instead of raw crash
    const getRes = await invokeApp({
      method: "GET",
      url: `/api/verify/${cert.certificateId}`
    });
    assert.equal(getRes.status, 404);
    const getJson = await getRes.json();
    assert.equal(getJson.notFound, true);
    assert.ok(
      getJson.error.includes("This record is no longer stored on this server") ||
      getJson.error.includes("the free demo disk resets"),
      "Must show friendly restart explanation message"
    );

    // 4. Verify self-contained certificate via POST /api/verify with passed payload
    const postRes = await invokeApp({
      method: "POST",
      url: "/api/verify",
      body: { certificate: cert }
    });
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.equal(postJson.verified, true);
    assert.equal(postJson.status, "Compliant");
    assert.equal(postJson.recomputedSignature, cert.signature);

    // The verified certificate is also re-persisted to disk for future GET calls
    assert.ok(fs.existsSync(certPath));

    // Clean up
    if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
  });

  // Test 3: Item 8 - Tamper test and restore leave disk certificate byte-for-byte untouched
  test("Item 8: tamper check and restore leave stored certificate byte-for-byte unchanged", () => {
    const mockWorkspace = {
      id: "ws-tamper-safety-test",
      rules: [{ id: "R-01", text: "Say 'platform'." }],
      facts: []
    };
    const mockDraft = {
      id: "d-tamper-safety",
      title: "Tamper Test Copy",
      channel: "Social Media / Twitter",
      originalText: "CampusPro is a secure platform.",
      findings: []
    };

    const cert = createComplianceCertificate({
      draft: mockDraft,
      workspace: mockWorkspace
    });

    const certPath = path.join(CERTIFICATES_DIR, `${cert.certificateId}.json`);
    assert.ok(fs.existsSync(certPath));

    // Read byte-for-byte exact content of certificate file on disk before tampering
    const bytesBeforeTamper = fs.readFileSync(certPath);

    // 1. Run tamperWithCertificate
    const tampered = tamperWithCertificate(cert.certificateId);
    assert.ok(tampered.isTampered, "Returned object must be flagged as tampered");
    assert.ok(tampered.finalText.includes("[TAMPERED]") || tampered.finalText.endsWith("?"));

    // Verify tamper verification fails
    const tamperedVerification = verifyCertificateIntegrity(tampered);
    assert.equal(tamperedVerification.verified, false);
    assert.equal(tamperedVerification.status, "NOT_VERIFIED");

    // CHECK DISK: The stored certificate file on disk MUST BE BYTE-FOR-BYTE IDENTICAL!
    const bytesAfterTamper = fs.readFileSync(certPath);
    assert.equal(
      Buffer.compare(bytesBeforeTamper, bytesAfterTamper),
      0,
      "Stored certificate file on disk must be byte-for-byte unchanged after tamper"
    );

    // 2. Run restoreCertificate
    const restored = restoreCertificate(cert.certificateId);
    assert.equal(Boolean(restored.isTampered), false);
    assert.equal(restored.finalText, cert.finalText);

    const restoredVerification = verifyCertificateIntegrity(restored);
    assert.equal(restoredVerification.verified, true);
    assert.equal(restoredVerification.status, "Compliant");

    // CHECK DISK AGAIN: The stored certificate file on disk MUST STILL BE BYTE-FOR-BYTE IDENTICAL!
    const bytesAfterRestore = fs.readFileSync(certPath);
    assert.equal(
      Buffer.compare(bytesBeforeTamper, bytesAfterRestore),
      0,
      "Stored certificate file on disk must be byte-for-byte unchanged after restore"
    );

    // Clean up
    if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
    inMemoryTamperedCerts.delete(cert.certificateId);
  });

  // Test 4: Item 9 - CERT_SECRET handling in production vs development
  test("Item 9: CERT_SECRET refuses issuance in production if missing, allows dev fallback in development", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.CERT_SECRET;

    const mockWorkspace = { id: "ws-secret-test", rules: [], facts: [] };
    const mockDraft = { id: "d-secret-test", originalText: "Test copy", findings: [] };

    try {
      // 1. In production with no CERT_SECRET: refuse to issue and return null secret
      process.env.NODE_ENV = "production";
      delete process.env.CERT_SECRET;

      const prodSecret = getCertSecret();
      assert.equal(prodSecret, null, "getCertSecret must return null in production when CERT_SECRET is missing");

      assert.throws(
        () => createComplianceCertificate({ draft: mockDraft, workspace: mockWorkspace }),
        (err) => err.code === "CERT_SECRET_MISSING" || err.message.includes("CERT_SECRET"),
        "Must throw error refusing certificate issuance in production without CERT_SECRET"
      );

      // 2. In development with no CERT_SECRET: allowed dev fallback
      process.env.NODE_ENV = "development";
      delete process.env.CERT_SECRET;

      const devSecret = getCertSecret();
      assert.equal(devSecret, "DEV_ONLY_UNSECURE_SECRET_CHANGE_IN_PRODUCTION");

      const devCert = createComplianceCertificate({ draft: mockDraft, workspace: mockWorkspace });
      assert.ok(devCert.signature);
      const devVerification = verifyCertificateIntegrity(devCert);
      assert.equal(devVerification.verified, true);

      // Clean up dev cert
      const devPath = path.join(CERTIFICATES_DIR, `${devCert.certificateId}.json`);
      if (fs.existsSync(devPath)) fs.unlinkSync(devPath);

      // 3. In production with configured CERT_SECRET: issues normally
      process.env.NODE_ENV = "production";
      process.env.CERT_SECRET = "production_super_secure_secret_key_998877";

      const configuredSecret = getCertSecret();
      assert.equal(configuredSecret, "production_super_secure_secret_key_998877");

      const prodCert = createComplianceCertificate({ draft: mockDraft, workspace: mockWorkspace });
      assert.ok(prodCert.signature);
      const prodVerification = verifyCertificateIntegrity(prodCert);
      assert.equal(prodVerification.verified, true);

      // Clean up prod cert
      const prodPath = path.join(CERTIFICATES_DIR, `${prodCert.certificateId}.json`);
      if (fs.existsSync(prodPath)) fs.unlinkSync(prodPath);

    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret !== undefined) {
        process.env.CERT_SECRET = originalSecret;
      } else {
        delete process.env.CERT_SECRET;
      }
    }
  });

  // Test 5: Item 10 - Sync-write races prevented via per-file serialized lock
  test("Item 10: concurrent writes are serialized without corruption or lost updates", async () => {
    const wsId = `ws_race_test_${Date.now()}`;
    const filePath = path.join(WORKSPACES_DIR, `${wsId}.json`);

    // Initialize workspace
    loadWorkspace(wsId);

    // Fire 10 concurrent updateWorkspace calls modifying the same file
    const updateCount = 10;
    const promises = [];

    for (let i = 1; i <= updateCount; i++) {
      promises.push(
        updateWorkspace(wsId, async (ws) => {
          // Simulate non-trivial async work
          await new Promise(r => setTimeout(r, 10));
          ws.drafts.push({
            id: `concurrent-draft-${i}`,
            title: `Concurrent Draft ${i}`,
            index: i
          });
        })
      );
    }

    await Promise.all(promises);

    // Read the saved workspace directly from disk
    assert.ok(fs.existsSync(filePath));
    const savedContent = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(savedContent);

    // Verify all 10 drafts exist and no data was overwritten or lost
    assert.equal(parsed.drafts.length, updateCount, `All ${updateCount} concurrent writes must be safely recorded`);
    for (let i = 1; i <= updateCount; i++) {
      assert.ok(
        parsed.drafts.some(d => d.id === `concurrent-draft-${i}`),
        `Draft ${i} must exist in saved file`
      );
    }

    // Clean up
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    workspaceCache.delete(wsId);
  });

  // Test 6: Item 11 - ExpiringLRUCache bounds memory, evicts oldest on full, and purges expired
  test("Item 11: ExpiringLRUCache enforces maxSize, evicts oldest when full, and purges on expiry", async () => {
    const cache = new ExpiringLRUCache({ maxSize: 3, ttlMs: 100 });

    // 1. Insert 3 items
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    assert.equal(cache.size, 3);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("b"), 2);
    assert.equal(cache.get("c"), 3);

    // Access "a" so "b" becomes the least recently used
    cache.get("a");

    // 2. Insert 4th item "d": must evict oldest ("b")
    cache.set("d", 4);
    assert.equal(cache.size, 3);
    assert.equal(cache.has("b"), false, "'b' must be evicted as oldest LRU item");
    assert.equal(cache.get("a"), 1, "'a' was accessed and must remain");
    assert.equal(cache.get("c"), 3);
    assert.equal(cache.get("d"), 4);

    // 3. Test TTL expiration
    const shortTtlCache = new ExpiringLRUCache({ maxSize: 10, ttlMs: 30 });
    shortTtlCache.set("temp", "expiring_value");
    assert.equal(shortTtlCache.get("temp"), "expiring_value");

    // Wait 50ms for TTL to expire
    await new Promise(r => setTimeout(r, 50));
    assert.equal(shortTtlCache.get("temp"), undefined, "Expired entry must return undefined");
    assert.equal(shortTtlCache.size, 0, "Expired entry must be purged from cache");
  });

});
