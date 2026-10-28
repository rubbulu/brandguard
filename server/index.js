import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { INITIAL_RULES, INITIAL_FACTS, SAMPLE_DRAFTS, INITIAL_VISUAL_SETTINGS } from "./demoData.js";
import { callGeminiReview, ACTIVE_MODEL } from "./geminiService.js";
import { validateFindings } from "./validator.js";
import { loadWorkspace, saveWorkspace, resetWorkspace } from "./workspaceStore.js";
import { runVisualAudit, clearVisualAuditCache } from "./visualAuditor.js";
import { detectPromptInjection } from "./securityScanner.js";
import {
  createComplianceCertificate,
  getCertificateById,
  verifyCertificateIntegrity,
  tamperWithCertificate,
  restoreCertificate
} from "./certificateService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

// Clear visual audit cache on startup to purge any stale/corrupted entries for sample banners
clearVisualAuditCache();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Serve client production build if available
const clientDist = path.join(__dirname, "../client/dist");
app.use(express.static(clientDist));
const clientPublic = path.join(__dirname, "../client/public");
app.use(express.static(clientPublic));

// Serve workspace compressed images
const workspaceImagesDir = path.join(__dirname, "data", "workspaces", "images");
app.use("/api/workspaces/images", express.static(workspaceImagesDir));

// --- Rate Limiting per Workspace (10 reviews per minute) ---
const reviewRateLimits = new Map(); // workspaceId -> array of timestamps

function checkRateLimit(workspaceId) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;

  const timestamps = (reviewRateLimits.get(workspaceId) || []).filter(ts => now - ts < windowMs);
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  reviewRateLimits.set(workspaceId, timestamps);
  return true;
}

// --- Workspace Middleware ---
const workspaceMiddleware = (req, res, next) => {
  const workspaceId = req.headers["x-workspace-id"] || req.query.workspaceId || "default";
  req.workspaceId = typeof workspaceId === "string" ? workspaceId : "default";
  req.workspace = loadWorkspace(req.workspaceId);
  req.saveWs = () => saveWorkspace(req.workspaceId, req.workspace);
  next();
};

app.use("/api", workspaceMiddleware);
app.use("/visual-review", workspaceMiddleware);
app.use("/visual-settings", workspaceMiddleware);

// --- 1. Health Check & Config ---
app.get(["/api/health", "/health"], (req, res) => {
  res.json({
    status: "connected",
    service: "BrandGuard Governance Engine",
    version: "2.1.0",
    geminiKeyConfigured: Boolean(GEMINI_API_KEY),
    modelName: ACTIVE_MODEL,
    workspaceId: req.workspaceId,
    timestamp: new Date().toISOString()
  });
});

// --- 2. Rules Library ---
app.get("/api/rules", (req, res) => {
  res.json(req.workspace.rules);
});

app.post("/api/rules", (req, res) => {
  const { id, category, text, severity } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: "Rule ID and policy text are required." });
  }

  const cleanId = id.trim().toUpperCase();
  // Validate ID format: must start with R- or T- (e.g. R-12, T-03)
  if (!/^[RT]-\d+$/.test(cleanId)) {
    return res.status(400).json({
      error: `Invalid Rule ID format "${cleanId}". Rule IDs must start with 'R-' (for rules) or 'T-' (for tone), followed by digits (e.g. R-25, T-04).`
    });
  }

  // Check for duplicate ID
  const existing = req.workspace.rules.find(r => r.id === cleanId);
  if (existing) {
    return res.status(400).json({
      error: `Rule ID "${cleanId}" already exists. Please choose a unique ID or use Edit.`
    });
  }

  const newRule = {
    id: cleanId,
    category: (category || "claim").toLowerCase(),
    text: text.trim(),
    severity: ["high", "medium", "low"].includes((severity || "").toLowerCase())
      ? severity.toLowerCase()
      : "medium"
  };

  req.workspace.rules.push(newRule);
  req.saveWs();
  res.status(201).json(newRule);
});

app.put("/api/rules/:id", (req, res) => {
  const ruleId = req.params.id.toUpperCase();
  const { category, text, severity } = req.body;

  const rule = req.workspace.rules.find(r => r.id === ruleId);
  if (!rule) {
    return res.status(404).json({ error: `Rule "${ruleId}" not found.` });
  }

  if (category) rule.category = category.toLowerCase();
  if (text) rule.text = text.trim();
  if (severity && ["high", "medium", "low"].includes(severity.toLowerCase())) {
    rule.severity = severity.toLowerCase();
  }

  req.saveWs();
  res.json({ message: "Rule updated successfully", rule });
});

app.delete("/api/rules/:id", (req, res) => {
  const ruleId = req.params.id.toUpperCase();
  req.workspace.rules = req.workspace.rules.filter(r => r.id !== ruleId);
  req.saveWs();
  res.json({ message: `Rule ${ruleId} deleted`, rules: req.workspace.rules });
});

// --- 3. Approved Facts Library ---
app.get("/api/facts", (req, res) => {
  res.json(req.workspace.facts);
});

app.post("/api/facts", (req, res) => {
  const { id, text } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: "Fact ID and specification text are required." });
  }

  const cleanId = id.trim().toUpperCase();
  // Validate ID format: must start with F- (e.g. F-05)
  if (!/^F-\d+$/.test(cleanId)) {
    return res.status(400).json({
      error: `Invalid Fact ID format "${cleanId}". Fact IDs must start with 'F-' followed by digits (e.g. F-05).`
    });
  }

  const existing = req.workspace.facts.find(f => f.id === cleanId);
  if (existing) {
    return res.status(400).json({
      error: `Fact ID "${cleanId}" already exists. Please choose a unique ID or use Edit.`
    });
  }

  const newFact = { id: cleanId, text: text.trim() };
  req.workspace.facts.push(newFact);
  req.saveWs();
  res.status(201).json(newFact);
});

app.put("/api/facts/:id", (req, res) => {
  const factId = req.params.id.toUpperCase();
  const { text } = req.body;

  const fact = req.workspace.facts.find(f => f.id === factId);
  if (!fact) {
    return res.status(404).json({ error: `Fact "${factId}" not found.` });
  }

  if (text) fact.text = text.trim();
  req.saveWs();
  res.json({ message: "Fact updated successfully", fact });
});

app.delete("/api/facts/:id", (req, res) => {
  const factId = req.params.id.toUpperCase();
  req.workspace.facts = req.workspace.facts.filter(f => f.id !== factId);
  req.saveWs();
  res.json({ message: `Fact ${factId} deleted`, facts: req.workspace.facts });
});

// --- 3b. Visual Settings & Brand Palette ---
app.get(["/api/visual-settings", "/visual-settings"], (req, res) => {
  res.json(req.workspace.visualSettings || INITIAL_VISUAL_SETTINGS);
});

app.put(["/api/visual-settings", "/visual-settings"], (req, res) => {
  const { palette, minContrastRatio, disclaimerPhrase, rules } = req.body;
  if (!req.workspace.visualSettings) {
    req.workspace.visualSettings = JSON.parse(JSON.stringify(INITIAL_VISUAL_SETTINGS));
  }
  if (Array.isArray(palette)) {
    req.workspace.visualSettings.palette = palette.map(c => c.trim().toUpperCase());
  }
  if (typeof minContrastRatio === "number" || !isNaN(Number(minContrastRatio))) {
    req.workspace.visualSettings.minContrastRatio = Math.max(1, Math.min(21, Number(minContrastRatio)));
  }
  if (typeof disclaimerPhrase === "string") {
    req.workspace.visualSettings.disclaimerPhrase = disclaimerPhrase.trim();
  }
  if (Array.isArray(rules)) {
    req.workspace.visualSettings.rules = rules;
  }
  req.saveWs();
  res.json({
    message: "Visual settings updated successfully",
    visualSettings: req.workspace.visualSettings
  });
});

// --- 4. Workspace Reset & Sample Drafts ---
app.post("/api/reset-workspace", (req, res) => {
  const fresh = resetWorkspace(req.workspaceId);
  res.json({
    message: "Workspace successfully reset to clean initial state.",
    workspace: fresh,
    sampleDrafts: SAMPLE_DRAFTS
  });
});

app.get("/api/sample-drafts", (req, res) => {
  res.json(SAMPLE_DRAFTS);
});

// --- 5. Drafts Management ---
app.get("/api/drafts", (req, res) => {
  res.json(req.workspace.drafts);
});

app.get("/api/drafts/:id", (req, res) => {
  const draft = req.workspace.drafts.find(d => d.id === req.params.id);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  res.json(draft);
});

app.post("/api/drafts", (req, res) => {
  const { title, channel, content, creator } = req.body;
  if (!content || content.trim() === "") {
    return res.status(400).json({ error: "Content is required." });
  }

  const newDraft = {
    id: `draft-${Date.now()}`,
    title: title?.trim() || "Untitled Draft",
    channel: channel || "Web / Campaign",
    creator: creator || "Creator",
    createdAt: new Date().toISOString(),
    status: "submitted",
    originalText: content,
    currentText: content,
    version: 1,
    findings: [],
    validatorRejected: [],
    history: [
      {
        id: `h-${Date.now()}-1`,
        timestamp: new Date().toISOString(),
        actor: creator || "Creator",
        action: "Draft submitted (v1)"
      }
    ],
    comments: []
  };

  req.workspace.drafts.unshift(newDraft);
  req.saveWs();
  res.status(201).json(newDraft);
});

// --- 6. AI Review Endpoint with Validator Engine & Rate Limiting ---
app.post(["/api/review", "/review"], async (req, res) => {
  const isStream = req.query.stream === "true" || req.headers["x-stream"] === "true";

  if (isStream) {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  const sendStage = (stage, label, duration) => {
    if (isStream && !res.writableEnded) {
      res.write(JSON.stringify({ type: "stage", stage, label, duration }) + "\n");
    }
  };

  try {
    const { draftId, draftText } = req.body;

    // Enforce rate limit per workspace
    if (!checkRateLimit(req.workspaceId)) {
      if (isStream) {
        res.write(JSON.stringify({ type: "error", error: "Rate limit reached (10 checks per minute). Please wait a moment." }) + "\n");
        return res.end();
      }
      return res.status(429).json({
        error: "Rate limit reached (10 checks per minute). Please wait a moment before running another check."
      });
    }

    let targetDraft = null;
    let textToReview = draftText;

    if (draftId) {
      targetDraft = req.workspace.drafts.find(d => d.id === draftId);
      if (targetDraft) {
        textToReview = targetDraft.currentText || targetDraft.originalText;
      }
    }

    if (!textToReview || textToReview.trim() === "") {
      if (isStream) {
        res.write(JSON.stringify({ type: "error", error: "Draft text is empty." }) + "\n");
        return res.end();
      }
      return res.status(400).json({ error: "Draft text is empty." });
    }

    sendStage("init", "Draft validation & ingest");
    sendStage("security", "Prompt injection security scan");

    // 1. Detect instruction-like text / prompt injection before AI review
    const injectionFindings = detectPromptInjection(textToReview);

    sendStage("gemini_review", "Gemini AI policy review");

    // 2. Call Gemini with cascading fallback
    let rawAiFindings = [];
    let modelUsed = ACTIVE_MODEL;
    try {
      const reviewResult = await callGeminiReview({
        apiKey: GEMINI_API_KEY,
        draftText: textToReview,
        rules: req.workspace.rules,
        facts: req.workspace.facts
      });
      if (Array.isArray(reviewResult)) {
        rawAiFindings = reviewResult;
      } else {
        rawAiFindings = reviewResult.findings || [];
        modelUsed = reviewResult.model || ACTIVE_MODEL;
      }
    } catch (aiErr) {
      console.warn("[Review AI Warning]: Gemini review unavailable, continuing with deterministic checks:", aiErr.message);
      rawAiFindings = [];
    }

    sendStage("deterministic", "Deterministic tone checks");

    // 3. Run the deterministic Validator
    sendStage("validator", "Validator governance & deduplication");
    const validationResult = validateFindings(
      textToReview,
      rawAiFindings,
      req.workspace.rules,
      req.workspace.facts
    );

    // 4. Prepend prompt injection findings (they can never be suppressed by AI verdicts)
    for (const inj of injectionFindings) {
      if (!validationResult.accepted.some(f => f.quote.toLowerCase() === inj.quote.toLowerCase())) {
        validationResult.accepted.unshift(inj);
      }
    }

    // Persist on draft if applicable
    if (targetDraft) {
      targetDraft.status = "reviewed";
      targetDraft.findings = validationResult.accepted;
      targetDraft.validatorRejected = validationResult.rejected;
      targetDraft.validatorMerged = validationResult.merged;
      targetDraft.stats = validationResult.stats;
      targetDraft.modelUsed = modelUsed || ACTIVE_MODEL;
      targetDraft.history.push({
        id: `h-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: "BrandGuard AI",
        action: `AI Review completed (${validationResult.accepted.length} valid findings kept, ${validationResult.rejected.length} dropped by validator)`
      });
      req.saveWs();
    }

    const payload = {
      draftId: targetDraft?.id || null,
      draftText: textToReview,
      findings: validationResult.accepted,
      validatorRejected: validationResult.rejected,
      validatorMerged: validationResult.merged,
      stats: validationResult.stats,
      modelUsed: modelUsed || ACTIVE_MODEL,
      updatedDraft: targetDraft
    };

    if (isStream) {
      res.write(JSON.stringify({ type: "complete", data: payload }) + "\n");
      return res.end();
    }

    res.json(payload);
  } catch (error) {
    console.error("[Review Fatal Error]:", error);
    if (isStream && !res.writableEnded) {
      res.write(JSON.stringify({ type: "error", error: "An unexpected error occurred during review. Please try again." }) + "\n");
      return res.end();
    }
    res.status(500).json({
      error: "An unexpected error occurred during review. Please try again."
    });
  }
});

// --- 6b. Visual Review Endpoint (Banner / Image Review) ---
app.post(["/api/visual-review", "/visual-review"], async (req, res) => {
  const isStream = req.query.stream === "true" || req.headers["x-stream"] === "true";

  if (isStream) {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  const sendStage = (stage, label, duration) => {
    if (isStream && !res.writableEnded) {
      res.write(JSON.stringify({ type: "stage", stage, label, duration }) + "\n");
    }
  };

  try {
    // 1. Enforce rate limit per workspace (same limiter as /review)
    if (!checkRateLimit(req.workspaceId)) {
      if (isStream) {
        res.write(JSON.stringify({ type: "error", error: "Rate limit reached (10 checks per minute). Please wait a moment." }) + "\n");
        return res.end();
      }
      return res.status(429).json({
        error: "Rate limit reached (10 checks per minute). Please wait a moment before running another check."
      });
    }

    const { image, channel, draftTitle } = req.body;
    if (!image) {
      if (isStream) {
        res.write(JSON.stringify({ type: "error", error: "Image data is required (base64 PNG, JPG, or WebP)." }) + "\n");
        return res.end();
      }
      return res.status(400).json({ error: "Image data is required (base64 PNG, JPG, or WebP)." });
    }

    // Extract binary buffer from base64
    let buffer;
    try {
      const base64Data = image.includes("base64,") ? image.split("base64,")[1] : image;
      buffer = Buffer.from(base64Data, "base64");
    } catch (parseErr) {
      if (isStream) {
        res.write(JSON.stringify({ type: "error", error: "Invalid base64 image data." }) + "\n");
        return res.end();
      }
      return res.status(400).json({ error: "Invalid base64 image data." });
    }

    // Validate size (max 4 MB)
    if (buffer.length > 4 * 1024 * 1024) {
      if (isStream) {
        res.write(JSON.stringify({ type: "error", error: "Image file exceeds maximum allowed size of 4 MB." }) + "\n");
        return res.end();
      }
      return res.status(400).json({ error: "Image file exceeds maximum allowed size of 4 MB." });
    }

    // Run Visual Audit pipeline with onStage callback
    const auditResult = await runVisualAudit({
      imageBuffer: buffer,
      visualSettings: req.workspace.visualSettings,
      rules: req.workspace.rules,
      facts: req.workspace.facts,
      apiKey: GEMINI_API_KEY,
      workspaceId: req.workspaceId,
      onStage: sendStage
    });

    // Create persistent visual draft in workspace
    const newDraft = {
      id: `visual-${Date.now()}`,
      title: draftTitle?.trim() || "Marketing Banner Visual Audit",
      channel: channel || "Social / Banner",
      creator: "Visual Designer",
      createdAt: new Date().toISOString(),
      status: "reviewed",
      isVisual: true,
      imageUrl: auditResult.imageUrl,
      originalText: auditResult.extracted_text,
      currentText: auditResult.extracted_text,
      altText: auditResult.alt_text,
      hasLogo: auditResult.has_logo,
      ocrFailed: Boolean(auditResult.ocr_failed),
      hasZeroLines: Boolean(auditResult.has_zero_lines),
      version: 1,
      findings: auditResult.findings,
      validatorRejected: auditResult.validatorRejected || [],
      validatorMerged: auditResult.validatorMerged || [],
      stats: auditResult.stats,
      contrastResults: auditResult.contrast_results,
      paletteSummary: auditResult.palette_summary,
      regions: auditResult.regions,
      timings_ms: auditResult.timings_ms,
      modelUsed: ACTIVE_MODEL,
      history: [
        {
          id: `h-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: "BrandGuard Visual Auditor",
          action: `Visual audit completed in ${auditResult.timings_ms?.total || 0}ms (${auditResult.findings.length} findings kept, ${auditResult.stats.dropped_by_validator} dropped)`
        }
      ],
      comments: []
    };

    req.workspace.drafts.unshift(newDraft);
    req.saveWs();

    const responsePayload = {
      draftId: newDraft.id,
      draft: newDraft,
      timings_ms: auditResult.timings_ms,
      ...auditResult
    };

    if (isStream) {
      res.write(JSON.stringify({ type: "complete", data: responsePayload }) + "\n");
      return res.end();
    }

    res.json(responsePayload);
  } catch (err) {
    console.error("[Visual Review Fatal Error]:", err);
    const isClientErr = err.message.includes("format") || err.message.includes("size") || err.message.includes("Unreadable");
    if (isStream && !res.headersSent) {
      res.status(isClientErr ? 400 : 500).json({ error: err.message || "An unexpected error occurred during visual review." });
    } else if (isStream) {
      res.write(JSON.stringify({ type: "error", error: err.message || "An unexpected error occurred." }) + "\n");
      res.end();
    } else {
      res.status(isClientErr ? 400 : 500).json({
        error: err.message || "An unexpected error occurred during visual review."
      });
    }
  }
});

// Update Alt-Text for Visual Draft
app.patch("/api/drafts/:id/alt-text", (req, res) => {
  const { id } = req.params;
  const { altText } = req.body;
  const draft = req.workspace.drafts.find(d => d.id === id);
  if (!draft) return res.status(404).json({ error: "Draft not found." });

  draft.altText = (altText || "").trim();
  if (!draft.altText) {
    if (!draft.findings.some(f => f.rule_id === "V-03")) {
      draft.findings.push({
        id: `finding-alt-${Date.now()}`,
        rule_id: "V-03",
        quote: "(Missing alt text)",
        category: "accessibility",
        severity: "medium",
        explanation: "Every marketing image needs alt text for accessibility.",
        suggested_fix: "Add descriptive alt text describing the visible banner content.",
        needs_human_judgement: true,
        source: "alt_text",
        status: "pending"
      });
    }
  } else {
    draft.findings = draft.findings.filter(f => f.rule_id !== "V-03");
  }

  draft.history.push({
    id: `h-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: "Creator",
    action: `Updated image alt-text: "${draft.altText || "(cleared)"}"`
  });

  req.saveWs();
  res.json({ draft });
});

// Helper: Recompute currentText from originalText and active accepted/edited findings
function recomputeDraftText(originalText, findings) {
  let text = originalText;
  for (const f of findings) {
    if (f.status === "accepted" || f.status === "edited") {
      if (f.rule_id === "SEC-01" || f.action === "remove") {
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

// --- 7. Applying Finding Actions (Accept, Edit, Reject, Undo) ---
app.patch("/api/drafts/:id/finding", (req, res) => {
  const { id } = req.params;
  const { findingId, action, customFix } = req.body; // action: 'accept' | 'edit' | 'reject' | 'undo'

  const draft = req.workspace.drafts.find(d => d.id === id);
  if (!draft) return res.status(404).json({ error: "Draft not found." });

  const finding = draft.findings.find(f => f.id === findingId);
  if (!finding) return res.status(404).json({ error: "Finding not found." });

  const prevStatus = finding.status || "pending";

  // If draft was already approved, editing increments version and requires new approval
  if (draft.status === "approved") {
    draft.status = "in_progress";
    draft.version = (draft.version || 1) + 1;
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Modified draft after approval. Version bumped to v${draft.version}. Previous certificate (${draft.certificate?.certificateId}) remains valid for v${draft.version - 1}; new approval required for v${draft.version}.`
    });
    draft.certificate = null;
  }

  if (action === "accept") {
    if (finding.suggested_fix === "Needs manual edit") {
      return res.status(400).json({ error: "This finding requires a manual edit before it can be applied." });
    }
    finding.status = "accepted";
    draft.currentText = recomputeDraftText(draft.originalText, draft.findings);
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Accepted suggested fix for ${finding.rule_id}: replaced "${finding.quote}" with "${finding.suggested_fix}"`
    });
  } else if (action === "edit") {
    finding.status = "edited";
    finding.suggested_fix = (customFix || finding.suggested_fix).trim();
    draft.currentText = recomputeDraftText(draft.originalText, draft.findings);
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Edited and applied fix for ${finding.rule_id}: replaced "${finding.quote}" with "${finding.suggested_fix}"`
    });
  } else if (action === "reject") {
    finding.status = "rejected";
    draft.currentText = recomputeDraftText(draft.originalText, draft.findings);
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Rejected finding for ${finding.rule_id} ("${finding.quote}")`
    });
  } else if (action === "undo") {
    finding.status = "pending";
    draft.currentText = recomputeDraftText(draft.originalText, draft.findings);
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Reverted decision on ${finding.rule_id} ("${finding.quote}") back to pending`
    });
  } else {
    return res.status(400).json({ error: `Unknown action "${action}". Allowed: accept, edit, reject, undo.` });
  }

  req.saveWs();
  res.json({ draft, finding });
});

// --- 8. Reviewer Decisions & Comments ---
app.post("/api/drafts/:id/decision", (req, res) => {
  const { id } = req.params;
  const { decision, comment, reviewerName } = req.body; // decision: 'approve' | 'request_changes' | 'submit_for_review' | 'save_note'

  const draft = req.workspace.drafts.find(d => d.id === id);
  if (!draft) return res.status(404).json({ error: "Draft not found." });

  const author = reviewerName || "Reviewer";

  // If a note/comment was provided
  if (comment && comment.trim() !== "") {
    const newComment = {
      id: `c-${Date.now()}`,
      author,
      role: "reviewer",
      text: comment.trim(),
      timestamp: new Date().toISOString()
    };
    draft.comments.push(newComment);

    if (decision === "save_note") {
      draft.history.push({
        id: `h-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: author,
        action: `Added reviewer note: "${comment.trim()}"`
      });
      req.saveWs();
      return res.json(draft);
    }
  }

  if (decision === "approve") {
    draft.status = "approved";
    const noteSnippet = comment ? ` with note: "${comment.trim()}"` : "";

    // Generate cryptographic compliance certificate
    const certificate = createComplianceCertificate({
      draft,
      workspace: req.workspace,
      reviewerName: author,
      reviewerNote: comment
    });

    draft.certificate = certificate;
    if (!Array.isArray(draft.certificates)) {
      draft.certificates = [];
    }
    draft.certificates.push(certificate);

    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: author,
      action: `Approved draft for publication${noteSnippet} (Certificate ID: ${certificate.certificateId})`
    });
  } else if (decision === "request_changes") {
    draft.status = "changes_requested";
    const noteSnippet = comment ? ` with note: "${comment.trim()}"` : "";
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: author,
      action: `Requested revisions${noteSnippet}`
    });
  } else if (decision === "submit_for_review") {
    draft.status = "pending_reviewer";
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: "Submitted draft for final reviewer sign-off"
    });
  } else if (decision !== "save_note") {
    return res.status(400).json({ error: `Unknown decision "${decision}".` });
  }

  req.saveWs();
  res.json(draft);
});

// --- 9. Real Governance Insights (Strictly from Stored Data) ---
app.get("/api/insights", (req, res) => {
  const drafts = req.workspace.drafts || [];
  const rules = req.workspace.rules || [];
  const facts = req.workspace.facts || [];

  const ruleMap = new Map();
  rules.forEach(r => ruleMap.set(r.id, r.text));
  facts.forEach(f => ruleMap.set(f.id, f.text));
  if (req.workspace.visualSettings?.rules) {
    req.workspace.visualSettings.rules.forEach(r => ruleMap.set(r.id, r.text));
  }

  const ruleStats = {}; // rule_id -> { totalFlagged, accepted, edited, rejected }
  let totalFindings = 0;
  let visualFindingsCount = 0;
  let textFindingsCount = 0;
  let visualDraftsCount = 0;
  let textDraftsCount = 0;
  let totalAccepted = 0;
  let totalEdited = 0;
  let totalRejected = 0;
  let totalValidatorDropped = 0;

  for (const draft of drafts) {
    if (draft.isVisual) visualDraftsCount++;
    else textDraftsCount++;

    if (Array.isArray(draft.findings)) {
      for (const f of draft.findings) {
        totalFindings++;
        if (f.source && f.source !== "text") {
          visualFindingsCount++;
        } else {
          textFindingsCount++;
        }

        if (!ruleStats[f.rule_id]) {
          ruleStats[f.rule_id] = { totalFlagged: 0, accepted: 0, edited: 0, rejected: 0 };
        }
        ruleStats[f.rule_id].totalFlagged++;

        if (f.status === "accepted") {
          totalAccepted++;
          ruleStats[f.rule_id].accepted++;
        } else if (f.status === "edited") {
          totalEdited++;
          ruleStats[f.rule_id].edited++;
        } else if (f.status === "rejected") {
          totalRejected++;
          ruleStats[f.rule_id].rejected++;
        }
      }
    }
    if (Array.isArray(draft.validatorRejected)) {
      totalValidatorDropped += draft.validatorRejected.length;
    }
  }

  // Top violated rules by count
  const topRules = Object.entries(ruleStats)
    .map(([rule_id, stats]) => ({
      rule_id,
      count: stats.totalFlagged,
      rule_text: ruleMap.get(rule_id) || "Custom Rule or Fact"
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Honest, rule-based Unclear Guideline Detection:
  // Flag ONLY when flagged >= 3 times AND >= 40% of decisions were edited or rejected
  const unclearGuidelines = [];
  for (const [rule_id, stats] of Object.entries(ruleStats)) {
    if (stats.totalFlagged >= 3) {
      const decidedCount = stats.accepted + stats.edited + stats.rejected;
      if (decidedCount >= 1) {
        const disputeCount = stats.edited + stats.rejected;
        const disputeRate = disputeCount / decidedCount;
        if (disputeRate >= 0.4) {
          unclearGuidelines.push({
            rule_id,
            rule_text: ruleMap.get(rule_id) || "Guideline text",
            totalFlagged: stats.totalFlagged,
            decidedCount,
            disputeCount,
            disputePercentage: Math.round(disputeRate * 100),
            reason: `Flagged ${stats.totalFlagged} times with ${Math.round(disputeRate * 100)}% dispute rate (${disputeCount} of ${decidedCount} decisions rejected or edited). Creators frequently encounter ambiguity with this policy.`
          });
        }
      }
    }
  }

  const totalDecisions = totalAccepted + totalEdited + totalRejected;
  const fixAcceptanceRate = totalDecisions > 0
    ? Math.round((totalAccepted / totalDecisions) * 100)
    : null;

  res.json({
    draftsAnalysed: drafts.length,
    textDraftsCount,
    visualDraftsCount,
    findingsFlagged: totalFindings,
    textFindingsCount,
    visualFindingsCount,
    findingsAccepted: totalAccepted,
    findingsEdited: totalEdited,
    findingsRejected: totalRejected,
    totalDecisions,
    fixAcceptanceRate,
    validatorStats: {
      validKept: totalFindings,
      dropped: totalValidatorDropped
    },
    topRules,
    unclearGuidelines
  });
});

// --- 10. Public Compliance Certificate & Integrity Verification Endpoints ---
// Publicly accessible without workspace cookie or session
app.get(["/api/verify/:certificateId", "/verify/:certificateId"], (req, res) => {
  const { certificateId } = req.params;
  const cert = getCertificateById(certificateId);

  // If browser is requesting HTML page, serve SPA
  if (req.headers.accept && req.headers.accept.includes("text/html")) {
    return res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) res.status(500).send("Application load error");
    });
  }

  if (!cert) {
    return res.status(404).json({
      verified: false,
      status: "NOT_FOUND",
      error: `Certificate "${certificateId}" not found in server registry.`
    });
  }

  const verification = verifyCertificateIntegrity(cert);
  res.json(verification);
});

app.get("/api/certificates/:certificateId", (req, res) => {
  const { certificateId } = req.params;
  const cert = getCertificateById(certificateId);
  if (!cert) return res.status(404).json({ error: "Certificate not found." });
  res.json(cert);
});

// Demo Tamper Test endpoints
app.post("/api/certificates/:certificateId/tamper", (req, res) => {
  const { certificateId } = req.params;
  const tampered = tamperWithCertificate(certificateId);
  if (!tampered) return res.status(404).json({ error: "Certificate not found." });
  const verification = verifyCertificateIntegrity(tampered);
  res.json({
    message: "Simulated tamper: 1 character modified in stored record.",
    certificate: tampered,
    verification
  });
});

app.post("/api/certificates/:certificateId/restore", (req, res) => {
  const { certificateId } = req.params;
  const restored = restoreCertificate(certificateId);
  if (!restored) return res.status(404).json({ error: "Certificate not found." });
  const verification = verifyCertificateIntegrity(restored);
  res.json({
    message: "Restored original approved record.",
    certificate: restored,
    verification
  });
});

// Fallback for SPA routing in production
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

export { app };

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`[BrandGuard Server] Running on http://localhost:${PORT}`);
    console.log(`[BrandGuard Server] Gemini API Key configured: ${Boolean(GEMINI_API_KEY)}`);
    console.log(`[BrandGuard Server] Active Model: ${ACTIVE_MODEL}`);
  });
}
