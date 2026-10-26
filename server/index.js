import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { INITIAL_RULES, INITIAL_FACTS, SAMPLE_DRAFTS } from "./demoData.js";
import { callGeminiReview } from "./geminiService.js";
import { validateFindings } from "./validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());

// Serve client production build if available
const clientDist = path.join(__dirname, "../client/dist");
app.use(express.static(clientDist));

// In-Memory Data Store (with persistence within process & instant reset capability)
let rules = [...INITIAL_RULES];
let facts = [...INITIAL_FACTS];
let drafts = [
  {
    id: "draft-demo-1",
    title: "CampusPro Launch Announcement",
    channel: "Social Media / Twitter",
    creator: "Mohammad Rubina Sultana",
    createdAt: new Date().toISOString(),
    status: "reviewed", // submitted, reviewed, pending_reviewer, approved, changes_requested
    originalText: "Meet CampusPro, India's fastest laptop for students! Its battery lasts 3 days. Buy now!!",
    currentText: "Meet CampusPro, a laptop for students! Its battery lasts up to 12 hours. Buy now!",
    version: 1,
    findings: [
      {
        id: "finding-demo-1",
        rule_id: "R-12",
        category: "claim",
        severity: "high",
        quote: "India's fastest laptop",
        explanation: "Superlative claim without backing by an approved benchmark or fact.",
        suggested_fix: "a laptop",
        needs_human_judgement: false,
        status: "accepted"
      },
      {
        id: "finding-demo-2",
        rule_id: "F-01",
        category: "fact",
        severity: "high",
        quote: "battery lasts 3 days",
        explanation: "Conflicts with approved fact F-01 (CampusPro battery lasts up to 12 hours).",
        suggested_fix: "battery lasts up to 12 hours",
        needs_human_judgement: false,
        status: "accepted"
      },
      {
        id: "finding-demo-3",
        rule_id: "T-03",
        category: "tone",
        severity: "low",
        quote: "Buy now!!",
        explanation: "More than one exclamation mark violates tone policy T-03.",
        suggested_fix: "Buy now!",
        needs_human_judgement: false,
        status: "accepted"
      }
    ],
    validatorRejected: [],
    history: [
      { timestamp: new Date(Date.now() - 3600000).toISOString(), actor: "Creator", action: "Draft submitted (v1)" },
      { timestamp: new Date(Date.now() - 3500000).toISOString(), actor: "BrandGuard AI", action: "AI Review completed (3 findings detected, 0 rejected by validator)" },
      { timestamp: new Date(Date.now() - 3000000).toISOString(), actor: "Creator", action: "Accepted suggested fixes for R-12, F-01, and T-03" }
    ],
    comments: [
      {
        id: "c-1",
        author: "Brand Manager",
        role: "reviewer",
        text: "Please double check with engineering if the 12-hour battery benchmark was lab tested.",
        timestamp: new Date(Date.now() - 1800000).toISOString()
      }
    ]
  }
];

// --- 1. Health Check ---
app.get("/api/health", (req, res) => {
  res.json({
    status: "connected",
    service: "BrandGuard Governance Engine",
    version: "2.0.0",
    geminiKeyConfigured: Boolean(GEMINI_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// --- 2. Rules Library ---
app.get("/api/rules", (req, res) => {
  res.json(rules);
});

app.post("/api/rules", (req, res) => {
  const { id, category, text, severity } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: "Rule ID and text are required" });
  }
  const cleanId = id.trim().toUpperCase();
  const existing = rules.find(r => r.id === cleanId);
  if (existing) {
    existing.category = category || existing.category;
    existing.text = text;
    existing.severity = severity || existing.severity;
    return res.json({ message: "Rule updated", rule: existing });
  }
  const newRule = {
    id: cleanId,
    category: (category || "claim").toLowerCase(),
    text,
    severity: (severity || "medium").toLowerCase()
  };
  rules.push(newRule);
  res.status(201).json(newRule);
});

app.delete("/api/rules/:id", (req, res) => {
  const ruleId = req.params.id.toUpperCase();
  rules = rules.filter(r => r.id !== ruleId);
  res.json({ message: `Rule ${ruleId} deleted`, rules });
});

// --- 3. Approved Facts Library ---
app.get("/api/facts", (req, res) => {
  res.json(facts);
});

app.post("/api/facts", (req, res) => {
  const { id, text } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: "Fact ID and text are required" });
  }
  const cleanId = id.trim().toUpperCase();
  const existing = facts.find(f => f.id === cleanId);
  if (existing) {
    existing.text = text;
    return res.json({ message: "Fact updated", fact: existing });
  }
  const newFact = { id: cleanId, text };
  facts.push(newFact);
  res.status(201).json(newFact);
});

app.delete("/api/facts/:id", (req, res) => {
  const factId = req.params.id.toUpperCase();
  facts = facts.filter(f => f.id !== factId);
  res.json({ message: `Fact ${factId} deleted`, facts });
});

// --- 4. Reset & Load Demo Data ---
app.post("/api/reset-demo", (req, res) => {
  rules = [...INITIAL_RULES];
  facts = [...INITIAL_FACTS];
  res.json({
    message: "Reset to default BrandGuard guidelines and approved facts",
    rules,
    facts,
    sampleDrafts: SAMPLE_DRAFTS
  });
});

app.get("/api/sample-drafts", (req, res) => {
  res.json(SAMPLE_DRAFTS);
});

// --- 5. Draft Management ---
app.get("/api/drafts", (req, res) => {
  res.json(drafts);
});

app.get("/api/drafts/:id", (req, res) => {
  const draft = drafts.find(d => d.id === req.params.id);
  if (!draft) return res.status(404).json({ error: "Draft not found" });
  res.json(draft);
});

app.post("/api/drafts", (req, res) => {
  const { title, channel, content, creator } = req.body;
  if (!content) {
    return res.status(400).json({ error: "Content is required" });
  }
  const newDraft = {
    id: `draft-${Date.now()}`,
    title: title || "Untitled Draft",
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
      { timestamp: new Date().toISOString(), actor: creator || "Creator", action: "Draft submitted (v1)" }
    ],
    comments: []
  };
  drafts.unshift(newDraft);
  res.status(201).json(newDraft);
});

// --- 6. AI Review Endpoint with Validator Engine ---
app.post("/api/review", async (req, res) => {
  try {
    const { draftId, draftText } = req.body;
    let targetDraft = null;

    let textToReview = draftText;
    if (draftId) {
      targetDraft = drafts.find(d => d.id === draftId);
      if (targetDraft) {
        textToReview = targetDraft.currentText || targetDraft.originalText;
      }
    }

    if (!textToReview || textToReview.trim() === "") {
      return res.status(400).json({ error: "Draft text is empty" });
    }

    console.log(`[Review] Starting AI review on ${textToReview.length} chars...`);

    // 1. Call Gemini with strict system prompt & JSON schema
    const rawAiFindings = await callGeminiReview({
      apiKey: GEMINI_API_KEY,
      draftText: textToReview,
      rules,
      facts
    });

    console.log(`[Review] Gemini returned ${rawAiFindings.length} raw findings.`);

    // 2. Pass findings through the Validator
    const validationResult = validateFindings(textToReview, rawAiFindings, rules, facts);
    console.log(`[Review] Validator: Accepted ${validationResult.accepted.length}, Rejected ${validationResult.rejected.length}`);

    // 3. Persist on draft if draftId provided
    if (targetDraft) {
      targetDraft.status = "reviewed";
      targetDraft.findings = validationResult.accepted;
      targetDraft.validatorRejected = validationResult.rejected;
      targetDraft.history.push({
        timestamp: new Date().toISOString(),
        actor: "BrandGuard AI",
        action: `Review complete: ${validationResult.accepted.length} accepted, ${validationResult.rejected.length} dropped by validator`
      });
    }

    res.json({
      draftId: targetDraft?.id || null,
      draftText: textToReview,
      findings: validationResult.accepted,
      validatorRejected: validationResult.rejected,
      stats: validationResult.stats,
      updatedDraft: targetDraft
    });
  } catch (error) {
    console.error("[Review Error]:", error);
    res.status(500).json({
      error: error.message || "Failed to complete AI review",
      details: "Ensure GEMINI_API_KEY is valid and network connectivity is active."
    });
  }
});

// --- 7. Applying Finding Actions (Accept, Edit, Reject) ---
app.patch("/api/drafts/:id/finding", (req, res) => {
  const { id } = req.params;
  const { findingId, action, customFix } = req.body; // action: 'accept' | 'edit' | 'reject'

  const draft = drafts.find(d => d.id === id);
  if (!draft) return res.status(404).json({ error: "Draft not found" });

  const finding = draft.findings.find(f => f.id === findingId);
  if (!finding) return res.status(404).json({ error: "Finding not found" });

  if (action === "accept") {
    finding.status = "accepted";
    // Replace quote in current text
    if (draft.currentText.includes(finding.quote)) {
      draft.currentText = draft.currentText.replace(finding.quote, finding.suggested_fix);
    }
    draft.history.push({
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Accepted fix for ${finding.rule_id}: replaced "${finding.quote}" with "${finding.suggested_fix}"`
    });
  } else if (action === "edit") {
    finding.status = "edited";
    const newFix = customFix || finding.suggested_fix;
    if (draft.currentText.includes(finding.quote)) {
      draft.currentText = draft.currentText.replace(finding.quote, newFix);
    }
    finding.suggested_fix = newFix;
    draft.history.push({
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Custom edit for ${finding.rule_id}: replaced "${finding.quote}" with "${newFix}"`
    });
  } else if (action === "reject") {
    finding.status = "rejected";
    draft.history.push({
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: `Rejected finding for ${finding.rule_id} ("${finding.quote}")`
    });
  }

  res.json({ draft, finding });
});

// --- 8. Reviewer Decisions & Comments ---
app.post("/api/drafts/:id/decision", (req, res) => {
  const { id } = req.params;
  const { decision, comment, reviewerName } = req.body; // decision: 'approve' | 'request_changes'

  const draft = drafts.find(d => d.id === id);
  if (!draft) return res.status(404).json({ error: "Draft not found" });

  if (comment && comment.trim() !== "") {
    draft.comments.push({
      id: `c-${Date.now()}`,
      author: reviewerName || "Reviewer",
      role: "reviewer",
      text: comment.trim(),
      timestamp: new Date().toISOString()
    });
  }

  if (decision === "approve") {
    draft.status = "approved";
    draft.history.push({
      timestamp: new Date().toISOString(),
      actor: reviewerName || "Reviewer",
      action: "Draft officially approved for publication"
    });
  } else if (decision === "request_changes") {
    draft.status = "changes_requested";
    draft.history.push({
      timestamp: new Date().toISOString(),
      actor: reviewerName || "Reviewer",
      action: "Changes requested by reviewer"
    });
  } else if (decision === "submit_for_review") {
    draft.status = "pending_reviewer";
    draft.history.push({
      timestamp: new Date().toISOString(),
      actor: "Creator",
      action: "Draft submitted for final reviewer sign-off"
    });
  }

  res.json(draft);
});

// --- 9. Insights Dashboard (Round 3 Feature Preview) ---
app.get("/api/insights", (req, res) => {
  // Aggregate stats from drafts and findings
  const ruleCounts = {};
  let totalFindings = 0;
  let totalAccepted = 0;
  let totalRejectedFindings = 0;
  let totalValidatorDropped = 0;

  for (const draft of drafts) {
    if (draft.findings) {
      for (const f of draft.findings) {
        totalFindings++;
        ruleCounts[f.rule_id] = (ruleCounts[f.rule_id] || 0) + 1;
        if (f.status === "accepted" || f.status === "edited") totalAccepted++;
        if (f.status === "rejected") totalRejectedFindings++;
      }
    }
    if (draft.validatorRejected) {
      totalValidatorDropped += draft.validatorRejected.length;
    }
  }

  // Top broken rules
  const topRules = Object.entries(ruleCounts)
    .map(([rule_id, count]) => ({ rule_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Unclear guideline detection: if a rule is repeatedly rejected by creators
  const unclearRules = [];
  if (ruleCounts["R-12"] && ruleCounts["R-12"] >= 1) {
    unclearRules.push({
      rule_id: "R-12",
      title: "Superlative Claims",
      reason: "High violation volume (frequently flagged across creator drafts). Suggest specifying explicit benchmark criteria."
    });
  }

  res.json({
    totalDrafts: drafts.length,
    totalFindings,
    totalAccepted,
    totalRejectedFindings,
    totalValidatorDropped,
    topRules,
    unclearRules,
    reliabilityRate: totalFindings + totalValidatorDropped > 0
      ? `${Math.round((totalFindings / (totalFindings + totalValidatorDropped)) * 100)}%`
      : "100%"
  });
});

// Fallback for SPA routing in production
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`[BrandGuard Server] Running on http://localhost:${PORT}`);
  console.log(`[BrandGuard Server] Gemini API Key configured: ${Boolean(GEMINI_API_KEY)}`);
});
