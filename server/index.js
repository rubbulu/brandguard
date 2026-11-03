import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  INITIAL_RULES,
  INITIAL_FACTS,
  SAMPLE_DRAFTS,
  INITIAL_VISUAL_SETTINGS,
  INITIAL_TONE_PROFILES,
  INITIAL_BRAND_TERMS
} from "./demoData.js";
import { callGeminiReview, ACTIVE_MODEL } from "./geminiService.js";
import { validateFindings, compareChannelTones, resolveChannelProfile } from "./validator.js";
import { loadWorkspace, saveWorkspace, resetWorkspace } from "./workspaceStore.js";
import { runVisualAudit, clearVisualAuditCache } from "./visualAuditor.js";
import { detectPromptInjection } from "./securityScanner.js";
import {
  tidySpacingAndPunctuation,
  isCopyRule,
  recomputeDraftText,
  createComplianceCertificate,
  getCertificateById,
  saveCertificate,
  verifyCertificateIntegrity,
  tamperWithCertificate,
  restoreCertificate
} from "./certificateService.js";
import { ExpiringLRUCache } from "./lruCache.js";

export { tidySpacingAndPunctuation, isCopyRule, recomputeDraftText };
import {
  extractDocumentText,
  scanDocumentSecurity,
  validateProposals,
  getNextId,
  callGeminiGuidelineExtraction,
  validateProposalEditText
} from "./guidelineService.js";
import {
  detectUnclearRules,
  callGeminiClarification,
  validateClarificationOutput,
  buildFallbackClarification,
  validateClarificationEditText,
  applyClarificationWording,
  dismissClarificationRequest,
  recheckDraftsForClarification,
  seedClarificationDemo,
  syncClarificationStats,
  normalizeAiFailureReason,
  reopenClarificationRequest,
  retryClarificationAi
} from "./clarificationService.js";

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

// --- Rate Limiting per Workspace (bounded LRU cache, 200 entries, 5m TTL) ---
const reviewRateLimits = new ExpiringLRUCache({ maxSize: 200, ttlMs: 5 * 60 * 1000 });

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
  if (req.workspace._wasReset) {
    res.setHeader("X-Workspace-Reset", "1");
  } else {
    res.setHeader("X-Workspace-Reset", "0");
  }
  next();
};

app.use("/api", workspaceMiddleware);
app.use("/visual-review", workspaceMiddleware);
app.use("/visual-settings", workspaceMiddleware);

app.get("/api/workspace/status", (req, res) => {
  res.json({
    workspaceId: req.workspaceId,
    wasReset: Boolean(req.workspace._wasReset),
    wasMissing: Boolean(req.workspace._wasMissing),
    createdAt: req.workspace.createdAt
  });
});

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

  if (Array.isArray(req.body.bannedTerms)) {
    newRule.bannedTerms = req.body.bannedTerms.map(t => String(t).trim()).filter(Boolean);
  }

  req.workspace.rules.push(newRule);
  req.saveWs();
  res.status(201).json(newRule);
});

app.put("/api/rules/:id", (req, res) => {
  const ruleId = req.params.id.toUpperCase();
  const { category, text, severity, bannedTerms } = req.body;

  const rule = req.workspace.rules.find(r => r.id === ruleId);
  if (!rule) {
    return res.status(404).json({ error: `Rule "${ruleId}" not found.` });
  }

  if (category) rule.category = category.toLowerCase();
  if (text) rule.text = text.trim();
  if (severity && ["high", "medium", "low"].includes(severity.toLowerCase())) {
    rule.severity = severity.toLowerCase();
  }
  if (Array.isArray(bannedTerms)) {
    rule.bannedTerms = bannedTerms.map(t => String(t).trim()).filter(Boolean);
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

// --- 3c. Guideline Document Import & Proposal Review Queue ---
app.get("/api/guidelines/sample", (req, res) => {
  try {
    const samplePath = path.join(__dirname, "../sample-data/sample-brand-guideline.txt");
    if (!fs.existsSync(samplePath)) {
      return res.status(404).json({ error: "Sample brand guideline file not found." });
    }
    const text = fs.readFileSync(samplePath, "utf-8");
    res.json({
      text,
      fileName: "sample-brand-guideline.txt",
      sourceName: "sample-brand-guideline.txt"
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to load sample guideline: ${err.message}` });
  }
});

app.get("/api/guidelines/proposals", (req, res) => {
  res.json({
    proposals: req.workspace.proposals || [],
    lastImport: req.workspace.lastImport || null
  });
});

app.post("/api/guidelines/extract", async (req, res) => {
  try {
    const { text, fileBase64, fileName, sourceName } = req.body;
    let buffer = null;

    if (fileBase64) {
      const cleaned = fileBase64.replace(/^data:[^;]+;base64,/, "");
      buffer = Buffer.from(cleaned, "base64");
    }

    // 1. Ingest text, check magic bytes, enforce 2MB and 15,000 char limits
    const extractResult = await extractDocumentText({
      buffer,
      rawText: text,
      fileName
    });

    const fullDocText = extractResult.text;
    if (!fullDocText || !fullDocText.trim()) {
      return res.status(400).json({ error: "Document text is empty. Please provide text or upload a document." });
    }

    // 2. Scan for prompt injection lines (SEC-01)
    const { safeText, blockedLines } = scanDocumentSecurity(fullDocText);

    // 3. Extract proposals via Gemini
    let rawProposals = [];
    if (safeText.trim().length > 0) {
      try {
        rawProposals = await callGeminiGuidelineExtraction({
          apiKey: GEMINI_API_KEY,
          safeText
        });
      } catch (aiErr) {
        return res.status(502).json({
          error: `AI proposal extraction failed: ${aiErr.message}`,
          canRetry: true
        });
      }
    }

    // 4. Validate proposals in code (verbatim source sentence, injection check, dedupe, library duplicate check)
    const validated = validateProposals({
      rawProposals,
      fullDocumentText: fullDocText,
      existingRules: req.workspace.rules || [],
      existingFacts: req.workspace.facts || []
    });

    let effectiveSourceName = sourceName || fileName || "Pasted text";
    if (sourceName === "Sample guideline" || fileName === "sample-brand-guideline.txt") {
      effectiveSourceName = "Sample guideline";
    } else if (!fileName && (!sourceName || sourceName.includes("Pasted"))) {
      effectiveSourceName = "Pasted text";
    }

    const keptWithMetadata = validated.kept.map(p => ({
      ...p,
      sourceName: effectiveSourceName,
      importedAt: new Date().toISOString()
    }));

    if (!Array.isArray(req.workspace.proposals)) {
      req.workspace.proposals = [];
    }

    // Filter out previously pending if replacing, or merge
    req.workspace.proposals = [...keptWithMetadata, ...req.workspace.proposals.filter(p => p.status !== "pending")];

    req.workspace.lastImport = {
      sourceName: effectiveSourceName,
      stats: {
        kept: keptWithMetadata.length,
        dropped: validated.dropped.length,
        blocked: blockedLines.length,
        sourceName: effectiveSourceName
      },
      blockedLines,
      dropped: validated.dropped,
      truncated: extractResult.truncated,
      originalLength: extractResult.originalLength,
      truncatedLength: extractResult.truncatedLength,
      importedAt: new Date().toISOString()
    };

    req.saveWs();

    res.json({
      proposals: req.workspace.proposals,
      newProposals: keptWithMetadata,
      stats: req.workspace.lastImport.stats,
      blockedLines,
      dropped: validated.dropped,
      truncated: extractResult.truncated,
      originalLength: extractResult.originalLength,
      truncationNotice: extractResult.truncationNotice
    });
  } catch (err) {
    res.status(400).json({ error: err.message, canRetry: true });
  }
});

app.post("/api/guidelines/proposals/:id/decide", (req, res) => {
  const proposalId = req.params.id;
  const { action, editedData } = req.body;

  if (!Array.isArray(req.workspace.proposals)) {
    req.workspace.proposals = [];
  }

  const proposal = req.workspace.proposals.find(p => p.id === proposalId);
  if (!proposal) {
    return res.status(404).json({ error: `Proposal "${proposalId}" not found.` });
  }

  // Prevent double-click duplicates: ignore second decision on already decided proposal
  if (proposal.status === "approved" || proposal.status === "rejected") {
    return res.json({
      message: `Proposal was already decided (${proposal.status}).`,
      proposal,
      rules: req.workspace.rules,
      facts: req.workspace.facts
    });
  }

  if (action === "approve" || action === "edit_and_approve") {
    if (action === "edit_and_approve") {
      const textToValidate = editedData?.text !== undefined ? editedData.text : proposal.text;
      const validation = validateProposalEditText(textToValidate);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      proposal.text = validation.text;
      if (editedData?.title) proposal.title = editedData.title.trim();
      if (editedData?.category) proposal.category = editedData.category.toLowerCase();
      if (editedData?.severity && ["high", "medium", "low"].includes(editedData.severity.toLowerCase())) {
        proposal.severity = editedData.severity.toLowerCase();
      }
    }

    const assignedId = getNextId(proposal.type, req.workspace);
    const sourceLabel = `imported from ${proposal.sourceName || "guideline document"}`;
    const importedAt = new Date().toISOString();

    let createdItem;
    if (proposal.type === "rule") {
      createdItem = {
        id: assignedId,
        category: proposal.category || "claim",
        text: proposal.text.trim(),
        severity: proposal.severity || "medium",
        source: sourceLabel,
        importedAt
      };
      req.workspace.rules.push(createdItem);
    } else {
      createdItem = {
        id: assignedId,
        text: proposal.text.trim(),
        source: sourceLabel,
        importedAt
      };
      req.workspace.facts.push(createdItem);
    }

    proposal.status = "approved";
    proposal.approvedId = assignedId;

    if (!Array.isArray(req.workspace.auditTrail)) {
      req.workspace.auditTrail = [];
    }
    req.workspace.auditTrail.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: importedAt,
      action: action === "edit_and_approve" ? "guideline_proposal_edited_and_approved" : "guideline_proposal_approved",
      user: "Brand Manager",
      proposalId: proposal.id,
      assignedId,
      type: proposal.type,
      title: proposal.title
    });

    req.saveWs();

    res.json({
      success: true,
      proposal,
      createdItem,
      rules: req.workspace.rules,
      facts: req.workspace.facts
    });
  } else if (action === "reject") {
    proposal.status = "rejected";

    if (!Array.isArray(req.workspace.auditTrail)) {
      req.workspace.auditTrail = [];
    }
    req.workspace.auditTrail.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      action: "guideline_proposal_rejected",
      user: "Brand Manager",
      proposalId: proposal.id,
      title: proposal.title
    });

    req.saveWs();

    res.json({
      success: true,
      proposal,
      rules: req.workspace.rules,
      facts: req.workspace.facts
    });
  } else {
    res.status(400).json({ error: `Unknown decision action "${action}". Must be "approve", "edit_and_approve", or "reject".` });
  }
});

app.post("/api/guidelines/proposals/:id/undo", (req, res) => {
  const proposalId = req.params.id;
  if (!Array.isArray(req.workspace.proposals)) {
    return res.status(404).json({ error: "No proposals found." });
  }

  const proposal = req.workspace.proposals.find(p => p.id === proposalId);
  if (!proposal) {
    return res.status(404).json({ error: `Proposal "${proposalId}" not found.` });
  }

  if (proposal.status !== "approved" || !proposal.approvedId) {
    return res.status(400).json({ error: "Only approved proposals can be undone." });
  }

  const targetId = proposal.approvedId;
  if (proposal.type === "rule") {
    req.workspace.rules = (req.workspace.rules || []).filter(r => r.id !== targetId);
  } else {
    req.workspace.facts = (req.workspace.facts || []).filter(f => f.id !== targetId);
  }

  proposal.status = "pending";
  delete proposal.approvedId;

  if (!Array.isArray(req.workspace.auditTrail)) {
    req.workspace.auditTrail = [];
  }
  req.workspace.auditTrail.push({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    action: "guideline_proposal_undone",
    user: "Brand Manager",
    proposalId: proposal.id,
    targetId,
    title: proposal.title
  });

  req.saveWs();

  res.json({
    success: true,
    message: `Undone approval of ${targetId}. Proposal restored to pending.`,
    proposal,
    rules: req.workspace.rules,
    facts: req.workspace.facts
  });
});

app.delete("/api/guidelines/proposals", (req, res) => {
  req.workspace.proposals = [];
  req.workspace.lastImport = null;
  req.saveWs();
  res.json({ message: "Proposals review queue cleared.", proposals: [] });
});

// --- 3a. Self-Healing Guideline Clarification (Round 3, Improvement 2) ---
app.get("/api/clarifications", async (req, res) => {
  try {
    if (!Array.isArray(req.workspace.clarificationRequests)) {
      req.workspace.clarificationRequests = [];
    }

    const detectedUnclear = detectUnclearRules(req.workspace);

    for (const item of detectedUnclear) {
      // Check if an active/pending request already exists for this rule
      const existing = req.workspace.clarificationRequests.find(
        r => r.ruleId === item.ruleId && r.status === "pending"
      );

      if (existing) {
        // Fix stale counts: update stats and regenerate template question if dispute count changed while pending
        const changed = syncClarificationStats(existing, item.stats, item.examples);
        if (changed) {
          req.saveWs();
        }
      } else {
        // Check if there's already a resolved request with the current rule text (no new clarification needed)
        const resolved = req.workspace.clarificationRequests.find(
          r => r.ruleId === item.ruleId && r.status === "resolved" && r.appliedWording === item.ruleText
        );
        if (resolved) continue;

        // Generate clarifying question and wordings via Gemini (with automatic validation & fallback)
        let questionObj = null;
        let aiReason = null;
        try {
          const aiRes = await callGeminiClarification({
            apiKey: GEMINI_API_KEY,
            rule: { id: item.ruleId, text: item.ruleText, category: item.ruleCategory },
            stats: item.stats,
            examples: item.examples
          });
          questionObj = validateClarificationOutput({
            aiResult: aiRes,
            currentText: item.ruleText,
            ruleId: item.ruleId,
            rules: req.workspace.rules,
            stats: item.stats
          });
          if (!questionObj.valid) {
            aiReason = questionObj.aiReason || normalizeAiFailureReason(questionObj.error);
          }
        } catch (aiErr) {
          console.warn(`[Clarification AI Warning]: ${aiErr.message}. Using fallback question.`);
          aiReason = normalizeAiFailureReason(aiErr);
          questionObj = {
            valid: false,
            aiReason,
            ...buildFallbackClarification({ ruleId: item.ruleId, stats: item.stats })
          };
        }

        const newRequest = {
          id: `cr-${item.ruleId}-${Date.now()}`,
          ruleId: item.ruleId,
          ruleText: item.ruleText,
          ruleCategory: item.ruleCategory,
          stats: item.stats,
          examples: item.examples,
          question: questionObj.question,
          suggestedWordings: questionObj.suggestedWordings || [],
          status: "pending",
          aiAvailable: Boolean(questionObj.aiAvailable),
          aiReason: questionObj.aiAvailable ? null : (aiReason || "Gemini model unavailable (check GEMINI_MODEL)"),
          wordingSource: questionObj.aiAvailable ? "ai" : null,
          appliedWording: null,
          resolvedAt: null,
          createdAt: new Date().toISOString()
        };

        req.workspace.clarificationRequests.unshift(newRequest);
        req.saveWs();
      }
    }

    res.json({ requests: req.workspace.clarificationRequests });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch clarifications: ${err.message}` });
  }
});

app.post("/api/clarifications/demo", (req, res) => {
  try {
    const result = seedClarificationDemo(req.workspace);
    req.saveWs();
    res.json({
      success: true,
      message: "Clarification demo loaded (5 flags, 3 disputes for R-07, 1 stored draft).",
      workspace: req.workspace,
      requests: req.workspace.clarificationRequests,
      draft: result.draft,
      request: result.request
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to seed clarification demo: ${err.message}` });
  }
});

app.post("/api/clarifications/:id/retry", async (req, res) => {
  try {
    const result = await retryClarificationAi({
      workspace: req.workspace,
      requestId: req.params.id,
      apiKey: GEMINI_API_KEY
    });
    req.saveWs();
    res.json({
      ...result,
      requests: req.workspace.clarificationRequests
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to retry AI suggestions: ${err.message}` });
  }
});

app.post(["/api/clarifications/:id/reopen", "/api/clarifications/:id/re-open"], (req, res) => {
  try {
    const result = reopenClarificationRequest({
      workspace: req.workspace,
      requestId: req.params.id,
      ruleId: req.body.ruleId
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    req.saveWs();
    res.json({
      ...result,
      requests: req.workspace.clarificationRequests
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to reopen clarification: ${err.message}` });
  }
});

app.post("/api/clarifications/:id/decide", (req, res) => {
  try {
    const { action, wording, ruleId } = req.body;
    const requestId = req.params.id;

    if (action === "apply" || action === "edit_and_apply") {
      const result = applyClarificationWording({
        workspace: req.workspace,
        requestId,
        ruleId,
        newText: wording,
        changedBy: "Brand Manager"
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      req.saveWs();
      return res.json({
        ...result,
        rules: req.workspace.rules,
        requests: req.workspace.clarificationRequests
      });
    }

    if (action === "dismiss") {
      const result = dismissClarificationRequest({
        workspace: req.workspace,
        requestId,
        ruleId
      });

      req.saveWs();
      return res.json({
        ...result,
        requests: req.workspace.clarificationRequests
      });
    }

    if (action === "reopen") {
      const result = reopenClarificationRequest({
        workspace: req.workspace,
        requestId,
        ruleId
      });

      req.saveWs();
      return res.json({
        ...result,
        requests: req.workspace.clarificationRequests
      });
    }

    res.status(400).json({ error: `Unknown decision action "${action}". Allowed: "apply", "edit_and_apply", "dismiss", "reopen".` });
  } catch (err) {
    res.status(500).json({ error: `Failed to decide clarification: ${err.message}` });
  }
});

app.post("/api/clarifications/:id/recheck", (req, res) => {
  try {
    const requestId = req.params.id;
    const reqItem = (req.workspace.clarificationRequests || []).find(r => r.id === requestId);
    const targetRuleId = req.body.ruleId || reqItem?.ruleId || requestId;

    const result = recheckDraftsForClarification({
      workspace: req.workspace,
      ruleId: targetRuleId
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to run clarification re-check: ${err.message}` });
  }
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

// --- 3c. Tone Profiles & Brand Terms ---
app.get("/api/tone-settings", (req, res) => {
  res.json({
    toneProfiles: req.workspace.toneProfiles || INITIAL_TONE_PROFILES,
    brandTerms: req.workspace.brandTerms || INITIAL_BRAND_TERMS
  });
});

app.put("/api/tone-settings", (req, res) => {
  const { toneProfiles, brandTerms } = req.body;

  if (!toneProfiles || typeof toneProfiles !== "object") {
    return res.status(400).json({ error: "toneProfiles object is required." });
  }

  const standardChannels = [
    "Social Media / Twitter",
    "Marketing Email",
    "Product Landing Page",
    "Ad Copy / Banner"
  ];

  const validatedProfiles = {};
  for (const ch of standardChannels) {
    const prof = toneProfiles[ch];
    if (!prof || typeof prof !== "object") {
      return res.status(400).json({ error: `Missing tone profile for channel "${ch}".` });
    }

    const maxEx = Number(prof.maxExclamationMarks);
    const maxCaps = Number(prof.maxAllCapsWords);
    const maxChars = Number(prof.maxCharacters);

    if (isNaN(maxEx) || !Number.isInteger(maxEx) || maxEx < 0 || maxEx > 1000) {
      return res.status(400).json({ error: `Max Exclamation Marks for "${ch}" must be a whole number between 0 and 1000.` });
    }
    if (isNaN(maxCaps) || !Number.isInteger(maxCaps) || maxCaps < 0 || maxCaps > 1000) {
      return res.status(400).json({ error: `Max ALL-CAPS Words for "${ch}" must be a whole number between 0 and 1000.` });
    }
    if (isNaN(maxChars) || !Number.isInteger(maxChars) || maxChars < 0 || maxChars > 1000) {
      return res.status(400).json({ error: `Max Characters for "${ch}" must be a whole number between 0 and 1000 (0 = no limit).` });
    }

    validatedProfiles[ch] = {
      maxExclamationMarks: maxEx,
      maxAllCapsWords: maxCaps,
      maxCharacters: maxChars
    };
  }

  let cleanBrandTerms = req.workspace.brandTerms || [...INITIAL_BRAND_TERMS];
  if (Array.isArray(brandTerms)) {
    cleanBrandTerms = brandTerms
      .map(t => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);
    if (cleanBrandTerms.length === 0) {
      return res.status(400).json({ error: "At least one brand term is required." });
    }
  }

  req.workspace.toneProfiles = validatedProfiles;
  req.workspace.brandTerms = cleanBrandTerms;
  req.saveWs();

  res.json({
    message: "Tone profiles and brand terms updated successfully.",
    toneProfiles: req.workspace.toneProfiles,
    brandTerms: req.workspace.brandTerms
  });
});

app.post("/api/tone-settings/reset", (req, res) => {
  req.workspace.toneProfiles = JSON.parse(JSON.stringify(INITIAL_TONE_PROFILES));
  req.workspace.brandTerms = [...INITIAL_BRAND_TERMS];
  req.saveWs();
  res.json({
    message: "Tone profiles restored to default settings.",
    toneProfiles: req.workspace.toneProfiles,
    brandTerms: req.workspace.brandTerms
  });
});

app.post("/api/compare-channels", (req, res) => {
  const { draftText } = req.body;
  if (!draftText || typeof draftText !== "string" || !draftText.trim()) {
    return res.status(400).json({ error: "Draft text is required to compare channels." });
  }

  const comparison = compareChannelTones(
    draftText.trim(),
    req.workspace.rules || [],
    req.workspace.brandTerms || INITIAL_BRAND_TERMS,
    req.workspace.toneProfiles || INITIAL_TONE_PROFILES
  );

  res.json({
    draftText: draftText.trim(),
    channels: comparison
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

  // Double Submit prevention: ignore rapid repeat requests with identical content & channel
  const cleanTitle = title?.trim() || "Untitled Draft";
  const cleanChannel = channel || "Web / Campaign";
  const recentDuplicate = req.workspace.drafts[0];
  if (
    recentDuplicate &&
    recentDuplicate.originalText === content &&
    recentDuplicate.title === cleanTitle &&
    recentDuplicate.channel === cleanChannel &&
    (Date.now() - new Date(recentDuplicate.createdAt).getTime()) < 4000
  ) {
    return res.status(200).json(recentDuplicate);
  }

  const newDraft = {
    id: `draft-${Date.now()}`,
    title: cleanTitle,
    channel: cleanChannel,
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
    const { draftId, draftText, channel: bodyChannel } = req.body;

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

    const channel = bodyChannel || targetDraft?.channel || "Social Media / Twitter";
    const toneProfiles = req.workspace.toneProfiles || INITIAL_TONE_PROFILES;
    const brandTerms = req.workspace.brandTerms || INITIAL_BRAND_TERMS;
    const { profile: targetProfile } = resolveChannelProfile(channel, toneProfiles);

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
    let aiReviewFailed = false;
    let aiUnavailableReason = null;

    try {
      if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured.");
      }
      const reviewResult = await callGeminiReview({
        apiKey: GEMINI_API_KEY,
        draftText: textToReview,
        rules: req.workspace.rules,
        facts: req.workspace.facts
      });
      if (Array.isArray(reviewResult)) {
        rawAiFindings = reviewResult;
      } else if (reviewResult && Array.isArray(reviewResult.findings)) {
        rawAiFindings = reviewResult.findings;
        modelUsed = reviewResult.model || ACTIVE_MODEL;
      } else {
        throw new Error("failed validation: Invalid response format from Gemini");
      }
    } catch (aiErr) {
      console.warn("[Review AI Warning]: Gemini review unavailable, continuing with deterministic checks:", aiErr.message);
      rawAiFindings = [];
      aiReviewFailed = true;
      aiUnavailableReason = normalizeAiFailureReason(aiErr);
    }

    sendStage("deterministic", "Deterministic code checks");

    // 3. Run the deterministic Validator with workspace tone profile and brand terms
    sendStage("validator", "Validator governance & deduplication");
    const validationResult = validateFindings(
      textToReview,
      rawAiFindings,
      req.workspace.rules,
      req.workspace.facts,
      brandTerms,
      channel,
      targetProfile
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
      targetDraft.modelUsed = aiReviewFailed ? null : (modelUsed || ACTIVE_MODEL);
      targetDraft.aiReviewFailed = aiReviewFailed;
      targetDraft.aiUnavailableReason = aiUnavailableReason;
      targetDraft.history.push({
        id: `h-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: aiReviewFailed ? "BrandGuard (Deterministic Checks Only)" : "BrandGuard AI",
        action: aiReviewFailed
          ? `AI Review unavailable (${aiUnavailableReason}). Code checks completed (${validationResult.accepted.length} findings)`
          : `AI Review completed (${validationResult.accepted.length} valid findings kept, ${validationResult.rejected.length} dropped by validator)`
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
      modelUsed: aiReviewFailed ? null : (modelUsed || ACTIVE_MODEL),
      aiReviewFailed,
      aiUnavailableReason,
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
      brandTerms: req.workspace.brandTerms,
      toneProfiles: req.workspace.toneProfiles,
      channel: channel || "Ad Copy / Banner",
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

// --- 7. Applying Finding Actions (Accept, Edit, Remove, Reject, Undo) ---
app.patch("/api/drafts/:id/finding", (req, res) => {
  const { id } = req.params;
  const { findingId, action, customFix } = req.body; // action: 'accept' | 'edit' | 'remove' | 'reject' | 'undo'

  const draft = req.workspace.drafts.find(d => d.id === id);
  if (!draft) return res.status(404).json({ error: "Draft not found." });

  const finding = draft.findings.find(f => f.id === findingId);
  if (!finding) return res.status(404).json({ error: "Finding not found." });

  const prevStatus = finding.status || "pending";

  // Prevent repeat/double action: return current state if already applied
  if (action === "accept" && finding.status === "accepted" && finding.action !== "remove") {
    return res.json({ draft, finding });
  }
  if (action === "remove" && finding.status === "accepted" && finding.action === "remove") {
    return res.json({ draft, finding });
  }
  if (action === "reject" && finding.status === "rejected") {
    return res.json({ draft, finding });
  }
  if (action === "undo" && (!finding.status || finding.status === "pending")) {
    return res.json({ draft, finding });
  }

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
    const isCopy = isCopyRule(finding.rule_id);
    const isRemoval = !finding.suggested_fix || finding.suggested_fix.trim() === "" || finding.action === "remove" || finding.rule_id === "SEC-01";
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: isCopy
        ? (isRemoval
            ? `Accepted removal of "${finding.quote}" [${finding.rule_id}]`
            : `Accepted suggested fix for ${finding.rule_id}: replaced "${finding.quote}" with "${finding.suggested_fix}"`)
        : `Accepted design note for ${finding.rule_id}: "${finding.suggested_fix}"`
    });
  } else if (action === "remove") {
    finding.status = "accepted";
    finding.action = "remove";
    finding.suggested_fix = "";
    draft.currentText = recomputeDraftText(draft.originalText, draft.findings);
    const isCopy = isCopyRule(finding.rule_id);
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: isCopy
        ? `Accepted removal of "${finding.quote}" [${finding.rule_id}]`
        : `Accepted design note removal for ${finding.rule_id}`
    });
  } else if (action === "edit") {
    if (customFix === undefined || customFix === null || typeof customFix !== "string" || !customFix.trim()) {
      return res.status(400).json({ error: "Replacement can't be empty. Use 'Remove this phrase' to delete it." });
    }
    finding.status = "edited";
    finding.suggested_fix = customFix.trim();
    draft.currentText = recomputeDraftText(draft.originalText, draft.findings);
    const isCopy = isCopyRule(finding.rule_id);
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: isCopy
        ? `Edited and applied fix for ${finding.rule_id}: replaced "${finding.quote}" with "${finding.suggested_fix}"`
        : `Edited design note for ${finding.rule_id}: "${finding.suggested_fix}"`
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
    return res.status(400).json({ error: `Unknown action "${action}". Allowed: accept, edit, remove, reject, undo.` });
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
    // Idempotency: duplicate approve returns existing approved draft and certificate
    if (draft.status === "approved" && draft.certificate) {
      return res.json(draft);
    }

    // Check for pending SEC-01 finding
    const secPending = (draft.findings || []).some(
      f => (f.rule_id === "SEC-01" || f.source === "security") && (f.status === "pending" || !f.status)
    );
    if (secPending) {
      return res.status(400).json({ error: "Resolve the security finding first" });
    }

    draft.status = "approved";
    const noteSnippet = comment ? ` with note: "${comment.trim()}"` : "";

    // Generate cryptographic compliance certificate
    let certificate;
    try {
      certificate = createComplianceCertificate({
        draft,
        workspace: req.workspace,
        reviewerName: author,
        reviewerNote: comment
      });
    } catch (err) {
      if (err.code === "CERT_SECRET_MISSING") {
        return res.status(503).json({
          error: "Certificate issuance is disabled because CERT_SECRET is not configured on this production server. Please configure CERT_SECRET."
        });
      }
      throw err;
    }

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
    if (draft.status === "changes_requested") {
      return res.json(draft);
    }
    draft.status = "changes_requested";
    const noteSnippet = comment ? ` with note: "${comment.trim()}"` : "";
    draft.history.push({
      id: `h-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: author,
      action: `Requested revisions${noteSnippet}`
    });
  } else if (decision === "submit_for_review") {
    if (draft.status === "pending_reviewer") {
      return res.json(draft);
    }
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
      notFound: true,
      error: "This record is no longer stored on this server. Certificates are tamper-evident and signed by the server, but the free demo disk resets. Re-issue or paste the certificate file.",
      message: "This record is no longer stored on this server. Certificates are tamper-evident and signed by the server, but the free demo disk resets. Re-issue or paste the certificate file."
    });
  }

  const verification = verifyCertificateIntegrity(cert);
  res.json(verification);
});

// Self-contained verification: verify uploaded or pasted certificate file
app.post("/api/verify", (req, res) => {
  const { certificate } = req.body;
  if (!certificate || typeof certificate !== "object" || !certificate.certificateId) {
    return res.status(400).json({
      verified: false,
      status: "BAD_REQUEST",
      error: "Valid certificate object is required for verification."
    });
  }

  const verification = verifyCertificateIntegrity(certificate);
  if (verification.verified) {
    // Persist verified certificate record to disk so GET finds it
    saveCertificate(certificate);
  }
  res.json(verification);
});

app.get("/api/certificates/:certificateId", (req, res) => {
  const { certificateId } = req.params;
  const cert = getCertificateById(certificateId);
  if (!cert) return res.status(404).json({
    error: "This record is no longer stored on this server. Certificates are tamper-evident and signed by the server, but the free demo disk resets. Re-issue or paste the certificate file."
  });
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

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (process.env.NODE_ENV !== "test" && isMainModule) {
  app.listen(PORT, () => {
    console.log(`[BrandGuard Server] Running on http://localhost:${PORT}`);
    console.log(`[BrandGuard Server] Gemini API Key configured: ${Boolean(GEMINI_API_KEY)}`);
    console.log(`[BrandGuard Server] Active Model: ${ACTIVE_MODEL}`);
  });
}
