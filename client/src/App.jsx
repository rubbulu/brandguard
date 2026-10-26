import React, { useState, useEffect, useRef } from "react";
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  BookOpen,
  UserCheck,
  Send,
  RefreshCw,
  Edit3,
  Check,
  X,
  FileText,
  BarChart3,
  HelpCircle,
  MessageSquare,
  History,
  Info,
  ChevronRight,
  Plus,
  RotateCcw,
  Save,
  ArrowRight
} from "lucide-react";

// Get or initialize persistent Workspace ID for this browser visitor
function getOrCreateWorkspaceId() {
  let id = localStorage.getItem("brandguard_workspace_id");
  if (!id) {
    id = "ws_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("brandguard_workspace_id", id);
  }
  return id;
}

export default function App() {
  const [workspaceId] = useState(getOrCreateWorkspaceId);

  // Role / Hash Routing: '#/manager' | '#/creator' | '#/reviewer' | '#/insights'
  const [activeRole, setActiveRole] = useState(() => {
    const hash = window.location.hash.replace("#/", "");
    return ["manager", "creator", "reviewer", "insights"].includes(hash) ? hash : "creator";
  });

  // Server & Health Status
  const [serverStatus, setServerStatus] = useState("connecting"); // 'connected' | 'waking' | 'offline'
  const [serverInfo, setServerInfo] = useState({ modelName: "Gemini 3.5 Flash", version: "2.1.0" });
  const [globalNotice, setGlobalNotice] = useState(null);

  // Guide Modal State
  const [showGuideModal, setShowGuideModal] = useState(false);

  // Brand Library State
  const [rules, setRules] = useState([]);
  const [facts, setFacts] = useState([]);
  const [sampleDrafts, setSampleDrafts] = useState([]);

  // Creator & Review State
  const [draftTitle, setDraftTitle] = useState("");
  const [draftChannel, setDraftChannel] = useState("Social Media / Twitter");
  const [draftContent, setDraftContent] = useState("");
  const [activeDraft, setActiveDraft] = useState(null);
  const [allDrafts, setAllDrafts] = useState([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [selectedFindingId, setSelectedFindingId] = useState(null);

  // Inline Edit Finding Fix
  const [editingFixId, setEditingFixId] = useState(null);
  const [customFixText, setCustomFixText] = useState("");

  // Reviewer State
  const [reviewerComment, setReviewerComment] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Insights State
  const [insights, setInsights] = useState(null);

  // Manager: Add & Edit State
  const [newRule, setNewRule] = useState({ id: "", category: "claim", text: "", severity: "high" });
  const [editingRule, setEditingRule] = useState(null);
  const [ruleFormError, setRuleFormError] = useState("");

  const [newFact, setNewFact] = useState({ id: "", text: "" });
  const [editingFact, setEditingFact] = useState(null);
  const [factFormError, setFactFormError] = useState("");

  // Helper: Workspace-aware fetch
  const wsFetch = (url, options = {}) => {
    const headers = {
      ...(options.headers || {}),
      "x-workspace-id": workspaceId
    };
    return fetch(url, { ...options, headers });
  };

  // 1. Hash Routing Sync
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#/", "");
      if (["manager", "creator", "reviewer", "insights"].includes(hash)) {
        setActiveRole(hash);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      window.location.hash = "#/creator";
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const changeRole = (role) => {
    setActiveRole(role);
    window.location.hash = `#/${role}`;
  };

  // 2. Initial Setup, Guide Modal, and 30s Health Check Interval
  useEffect(() => {
    // Check if first-time visitor to auto-show guide modal
    const guideShown = localStorage.getItem("brandguard_guide_shown");
    if (!guideShown) {
      setShowGuideModal(true);
      localStorage.setItem("brandguard_guide_shown", "true");
    }

    checkHealth();
    loadWorkspaceData();

    // 30-second polling for real server health
    const healthInterval = setInterval(() => {
      checkHealth();
    }, 30000);

    return () => clearInterval(healthInterval);
  }, []);

  const checkHealth = async () => {
    try {
      const res = await wsFetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setServerStatus("connected");
        setServerInfo({
          modelName: data.modelName || "Gemini 3.5 Flash",
          version: data.version || "2.1.0"
        });
      } else {
        setServerStatus("waking");
      }
    } catch {
      setServerStatus("waking");
    }
  };

  const loadWorkspaceData = async () => {
    try {
      const [rulesRes, factsRes, samplesRes, draftsRes, insightsRes] = await Promise.all([
        wsFetch("/api/rules"),
        wsFetch("/api/facts"),
        wsFetch("/api/sample-drafts"),
        wsFetch("/api/drafts"),
        wsFetch("/api/insights")
      ]);

      if (rulesRes.ok) setRules(await rulesRes.json());
      if (factsRes.ok) setFacts(await factsRes.json());
      if (samplesRes.ok) setSampleDrafts(await samplesRes.json());
      if (draftsRes.ok) {
        const dList = await draftsRes.json();
        setAllDrafts(dList);
        if (dList.length > 0) {
          setActiveDraft(dList[0]);
        } else {
          setActiveDraft(null);
        }
      }
      if (insightsRes.ok) setInsights(await insightsRes.json());
    } catch (e) {
      console.error("Error loading workspace data", e);
    }
  };

  // Reset Workspace (per visitor)
  const handleResetWorkspace = async () => {
    if (!window.confirm("Reset your private workspace? This will reload the default guidelines and clear all your drafts.")) {
      return;
    }
    try {
      const res = await wsFetch("/api/reset-workspace", { method: "POST" });
      if (res.ok) {
        setDraftTitle("");
        setDraftContent("");
        setActiveDraft(null);
        setEditingRule(null);
        setEditingFact(null);
        await loadWorkspaceData();
        showNotice("Workspace reset to clean initial state.");
      }
    } catch {
      alert("Error resetting workspace.");
    }
  };

  const showNotice = (msg) => {
    setGlobalNotice(msg);
    setTimeout(() => setGlobalNotice(null), 4000);
  };

  // Quick Test Draft Selection & Demo Scenario
  const handleLoadDemoScenario = () => {
    const campusPro = sampleDrafts.find((s) => s.id === "sample-1") || {
      title: "CampusPro Launch Announcement",
      content: "Meet CampusPro, India's fastest laptop for students! Its battery lasts 3 days. Buy now!!"
    };
    setDraftTitle(campusPro.title);
    setDraftContent(campusPro.content);
    setReviewError(null);
    changeRole("creator");
  };

  const handleSelectSample = (sample) => {
    setDraftTitle(sample.title);
    setDraftContent(sample.content);
    setReviewError(null);
  };

  // Submit Draft & Run AI Check
  const handleRunAiCheck = async () => {
    if (!draftContent.trim()) {
      alert("Please enter draft text to review.");
      return;
    }
    setIsReviewing(true);
    setReviewError(null);

    try {
      // 1. Create draft
      const draftRes = await wsFetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim() || "Untitled Campaign Draft",
          channel: draftChannel,
          content: draftContent.trim(),
          creator: "Content Creator"
        })
      });
      if (!draftRes.ok) throw new Error("Failed to save draft.");
      const newDraft = await draftRes.json();

      // 2. Call AI Review with Validator
      const reviewRes = await wsFetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: newDraft.id,
          draftText: draftContent.trim()
        })
      });

      if (reviewRes.status === 429) {
        const errData = await reviewRes.json();
        throw new Error(errData.error || "Rate limit reached (10 checks per minute). Please wait a moment.");
      }

      if (!reviewRes.ok) {
        const errData = await reviewRes.json();
        throw new Error(errData.error || "The AI is busy, please try again in a minute.");
      }

      const reviewData = await reviewRes.json();
      setActiveDraft(reviewData.updatedDraft || newDraft);
      await loadWorkspaceData();
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setIsReviewing(false);
    }
  };

  // Finding Decision Actions (Accept, Edit, Reject, Undo)
  const handleFindingAction = async (findingId, action, customFix = null) => {
    if (!activeDraft) return;
    try {
      const res = await wsFetch(`/api/drafts/${activeDraft.id}/finding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, action, customFix })
      });
      if (res.ok) {
        const data = await res.json();
        setActiveDraft(data.draft);
        setEditingFixId(null);
        setCustomFixText("");
        await loadWorkspaceData();
      }
    } catch (e) {
      console.error("Action error", e);
    }
  };

  // Submit to Reviewer Sign-Off
  const handleSubmitToReviewer = async () => {
    if (!activeDraft) return;
    try {
      const res = await wsFetch(`/api/drafts/${activeDraft.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "submit_for_review" })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveDraft(updated);
        await loadWorkspaceData();
        changeRole("reviewer");
        showNotice("Draft submitted to the Reviewer approval board.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Reviewer: Save Note Independently
  const handleSaveReviewerNote = async () => {
    if (!activeDraft || !reviewerComment.trim()) return;
    setIsSavingNote(true);
    try {
      const res = await wsFetch(`/api/drafts/${activeDraft.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "save_note",
          comment: reviewerComment,
          reviewerName: "Brand Reviewer"
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveDraft(updated);
        setReviewerComment("");
        await loadWorkspaceData();
        showNotice("Reviewer note saved to draft history.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingNote(false);
    }
  };

  // Reviewer: Approve or Request Changes
  const handleReviewerDecision = async (decision) => {
    if (!activeDraft) return;
    try {
      const res = await wsFetch(`/api/drafts/${activeDraft.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          comment: reviewerComment,
          reviewerName: "Brand Reviewer"
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveDraft(updated);
        setReviewerComment("");
        await loadWorkspaceData();
        showNotice(
          decision === "approve"
            ? "Draft approved for publication. Audit trail recorded."
            : "Revisions requested. Returned to creator queue."
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Manager: Add / Update Rule with Strict ID Validation
  const handleSaveRule = async (e) => {
    e.preventDefault();
    setRuleFormError("");

    const cleanId = (editingRule ? editingRule.id : newRule.id).trim().toUpperCase();
    if (!/^[RT]-\d+$/.test(cleanId)) {
      setRuleFormError("ID must start with 'R-' (rule) or 'T-' (tone) followed by numbers (e.g. R-22, T-04).");
      return;
    }

    // Check duplicate if creating
    if (!editingRule && rules.some((r) => r.id === cleanId)) {
      setRuleFormError(`Rule ID "${cleanId}" already exists. Edit the existing rule or choose another ID.`);
      return;
    }

    try {
      if (editingRule) {
        // Update existing rule
        const res = await wsFetch(`/api/rules/${editingRule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingRule)
        });
        if (res.ok) {
          setEditingRule(null);
          await loadWorkspaceData();
          showNotice(`Rule ${cleanId} updated.`);
        }
      } else {
        // Create new rule
        const res = await wsFetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newRule, id: cleanId })
        });
        if (res.ok) {
          setNewRule({ id: "", category: "claim", text: "", severity: "high" });
          await loadWorkspaceData();
          showNotice(`Rule ${cleanId} added.`);
        } else {
          const errData = await res.json();
          setRuleFormError(errData.error || "Failed to create rule.");
        }
      }
    } catch (err) {
      setRuleFormError("Network error while saving rule.");
    }
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm(`Delete rule ${id}?`)) return;
    try {
      await wsFetch(`/api/rules/${id}`, { method: "DELETE" });
      await loadWorkspaceData();
      showNotice(`Rule ${id} deleted.`);
    } catch (err) {
      console.error(err);
    }
  };

  // Manager: Add / Update Fact with Strict ID Validation
  const handleSaveFact = async (e) => {
    e.preventDefault();
    setFactFormError("");

    const cleanId = (editingFact ? editingFact.id : newFact.id).trim().toUpperCase();
    if (!/^F-\d+$/.test(cleanId)) {
      setFactFormError("Fact ID must start with 'F-' followed by numbers (e.g. F-05, F-10).");
      return;
    }

    if (!editingFact && facts.some((f) => f.id === cleanId)) {
      setFactFormError(`Fact ID "${cleanId}" already exists. Edit the existing fact or choose another ID.`);
      return;
    }

    try {
      if (editingFact) {
        const res = await wsFetch(`/api/facts/${editingFact.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingFact)
        });
        if (res.ok) {
          setEditingFact(null);
          await loadWorkspaceData();
          showNotice(`Fact ${cleanId} updated.`);
        }
      } else {
        const res = await wsFetch("/api/facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newFact, id: cleanId })
        });
        if (res.ok) {
          setNewFact({ id: "", text: "" });
          await loadWorkspaceData();
          showNotice(`Fact ${cleanId} added.`);
        } else {
          const errData = await res.json();
          setFactFormError(errData.error || "Failed to create fact.");
        }
      }
    } catch (err) {
      setFactFormError("Network error while saving fact.");
    }
  };

  const handleDeleteFact = async (id) => {
    if (!window.confirm(`Delete fact ${id}?`)) return;
    try {
      await wsFetch(`/api/facts/${id}`, { method: "DELETE" });
      await loadWorkspaceData();
      showNotice(`Fact ${id} deleted.`);
    } catch (err) {
      console.error(err);
    }
  };

  // Render Highlighted Draft Text (Left Pane in Creator View)
  const renderHighlightedText = (text, findings = []) => {
    if (!findings || findings.length === 0) {
      return <span className="text-slate-800">{text}</span>;
    }

    const matches = [];
    for (const f of findings) {
      const idx = text.indexOf(f.quote);
      if (idx !== -1) {
        matches.push({ start: idx, end: idx + f.quote.length, finding: f });
      }
    }
    matches.sort((a, b) => a.start - b.start);

    let result = [];
    let currentIndex = 0;

    for (const match of matches) {
      if (match.start > currentIndex) {
        result.push(
          <span key={`txt-${currentIndex}`}>{text.substring(currentIndex, match.start)}</span>
        );
      }

      const f = match.finding;
      const isSelected = selectedFindingId === f.id;

      // Color coding: Red = High, Amber = Medium, Yellow = Low, Violet = Fact
      let highlightClass = "highlight-high";
      if (f.category === "fact" || f.rule_id.startsWith("F-")) highlightClass = "highlight-fact";
      else if (f.severity === "medium") highlightClass = "highlight-medium";
      else if (f.severity === "low") highlightClass = "highlight-low";

      // If already accepted/rejected, visually strike through or tint
      const isDecided = f.status && f.status !== "pending";

      result.push(
        <mark
          key={f.id}
          className={`${highlightClass} ${isSelected ? "ring-2 ring-blue-600 font-bold" : ""} ${
            isDecided ? "opacity-60" : ""
          }`}
          onClick={() => setSelectedFindingId(f.id)}
          title={`Click to inspect [${f.rule_id}]: ${f.explanation}`}
        >
          {match.finding.quote}
          <span className="text-[10px] ml-1 px-1 py-0.2 bg-black/10 rounded font-mono">
            {f.rule_id}
          </span>
        </mark>
      );

      currentIndex = match.end;
    }

    if (currentIndex < text.length) {
      result.push(<span key={`txt-${currentIndex}`}>{text.substring(currentIndex)}</span>);
    }

    return <div className="leading-relaxed text-slate-800 text-sm whitespace-pre-wrap">{result}</div>;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased">
      {/* Server Asleep / Waking Alert for Render Free Tier */}
      {serverStatus === "waking" && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 shadow-xs">
          <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
          <span>Waking up the server, this can take up to a minute… retrying automatically.</span>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight text-slate-900">BrandGuard</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">Explainable Brand-Governance Platform</p>
            </div>
          </div>

          {/* Viewing As Role Navigation (#/manager, #/creator, #/reviewer, #/insights) */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 hidden md:inline">Viewing as:</span>
            <nav className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200" aria-label="Role Switcher">
              <button
                onClick={() => changeRole("manager")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  activeRole === "manager"
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Brand Manager
              </button>
              <button
                onClick={() => changeRole("creator")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  activeRole === "creator"
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Content Creator
              </button>
              <button
                onClick={() => changeRole("reviewer")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  activeRole === "reviewer"
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                Reviewer
              </button>
              <button
                onClick={() => changeRole("insights")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  activeRole === "insights"
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Insights
              </button>
            </nav>
          </div>

          {/* Status, Reset Workspace, & Guide Modal Button */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium">
              <span
                className={`w-2 h-2 rounded-full ${
                  serverStatus === "connected" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                }`}
              />
              <span className="text-slate-600">
                {serverStatus === "connected" ? "Backend Online" : "Waking up..."}
              </span>
            </div>

            <button
              onClick={handleResetWorkspace}
              title="Reset your private workspace to clean state"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Workspace</span>
            </button>

            <button
              onClick={() => setShowGuideModal(true)}
              className="px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 hover:bg-blue-100 flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Guide</span>
            </button>
          </div>
        </div>
      </header>

      {/* Global Toast / Feedback Notice */}
      {globalNotice && (
        <div className="bg-emerald-50 border-b border-emerald-200 py-2 px-4 text-center text-xs font-bold text-emerald-800 flex items-center justify-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {globalNotice}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* ========================================================================= */}
        {/* VIEW 1: BRAND MANAGER (Rule & Fact Library)                               */}
        {/* ========================================================================= */}
        {activeRole === "manager" && (
          <div className="space-y-8 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Brand Guidelines & Fact Library</h1>
                <p className="text-xs text-slate-500">
                  Rules and verified facts enforced by BrandGuard. Every AI finding must cite a valid ID from these libraries.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleLoadDemoScenario}
                  className="px-3.5 py-2 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 text-xs font-bold transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Load Demo Scenario
                </button>
              </div>
            </div>

            {/* Rules Library */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-900 text-base">Active Brand Rules ({rules.length})</h2>
                  <p className="text-xs text-slate-500">Governs claims, tone, terminology, and accessibility</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Rule ID</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Policy Description</th>
                      <th className="py-3 px-4">Severity</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {rules.map((rule) => (
                      <tr key={rule.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-blue-600">{rule.id}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 capitalize">
                            {rule.category}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-800 font-medium">{rule.text}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                              rule.severity === "high"
                                ? "bg-red-50 text-red-700"
                                : rule.severity === "medium"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {rule.severity}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => setEditingRule({ ...rule })}
                            className="text-slate-500 hover:text-blue-600 p-1.5 rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            title="Edit rule"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="text-slate-400 hover:text-red-600 p-1.5 rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                            title="Delete rule"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add / Edit Rule Form */}
              <form onSubmit={handleSaveRule} className="p-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  {editingRule ? <Edit3 className="w-3.5 h-3.5 text-blue-600" /> : <Plus className="w-3.5 h-3.5 text-blue-600" />}
                  {editingRule ? "Edit Rule:" : "Add Rule:"}
                </span>
                <input
                  type="text"
                  placeholder="ID (e.g. R-25)"
                  disabled={Boolean(editingRule)}
                  value={editingRule ? editingRule.id : newRule.id}
                  onChange={(e) => setNewRule({ ...newRule, id: e.target.value })}
                  className="w-24 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                  required
                />
                <select
                  value={editingRule ? editingRule.category : newRule.category}
                  onChange={(e) =>
                    editingRule
                      ? setEditingRule({ ...editingRule, category: e.target.value })
                      : setNewRule({ ...newRule, category: e.target.value })
                  }
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="claim">Claim</option>
                  <option value="tone">Tone</option>
                  <option value="terminology">Terminology</option>
                  <option value="accessibility">Accessibility</option>
                </select>
                <input
                  type="text"
                  placeholder="Policy instruction (e.g. Say 'students', not 'kids')..."
                  value={editingRule ? editingRule.text : newRule.text}
                  onChange={(e) =>
                    editingRule
                      ? setEditingRule({ ...editingRule, text: e.target.value })
                      : setNewRule({ ...newRule, text: e.target.value })
                  }
                  className="flex-1 min-w-[200px] px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <select
                  value={editingRule ? editingRule.severity : newRule.severity}
                  onChange={(e) =>
                    editingRule
                      ? setEditingRule({ ...editingRule, severity: e.target.value })
                      : setNewRule({ ...newRule, severity: e.target.value })
                  }
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {editingRule ? "Update Rule" : "Save Rule"}
                  </button>
                  {editingRule && (
                    <button
                      type="button"
                      onClick={() => setEditingRule(null)}
                      className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              {ruleFormError && (
                <div className="p-3 bg-red-50 border-t border-red-100 text-xs text-red-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{ruleFormError}</span>
                </div>
              )}
            </div>

            {/* Approved Facts Library */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-900 text-base">Approved Facts Library ({facts.length})</h2>
                  <p className="text-xs text-slate-500">Verified benchmark figures that marketing drafts cannot contradict</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Fact ID</th>
                      <th className="py-3 px-4">Verified Specification</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {facts.map((fact) => (
                      <tr key={fact.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-purple-600">{fact.id}</td>
                        <td className="py-3 px-4 text-slate-800 font-medium">{fact.text}</td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => setEditingFact({ ...fact })}
                            className="text-slate-500 hover:text-purple-600 p-1.5 rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            title="Edit fact"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteFact(fact.id)}
                            className="text-slate-400 hover:text-red-600 p-1.5 rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                            title="Delete fact"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add / Edit Fact Form */}
              <form onSubmit={handleSaveFact} className="p-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  {editingFact ? <Edit3 className="w-3.5 h-3.5 text-purple-600" /> : <Plus className="w-3.5 h-3.5 text-purple-600" />}
                  {editingFact ? "Edit Fact:" : "Add Fact:"}
                </span>
                <input
                  type="text"
                  placeholder="ID (e.g. F-05)"
                  disabled={Boolean(editingFact)}
                  value={editingFact ? editingFact.id : newFact.id}
                  onChange={(e) => setNewFact({ ...newFact, id: e.target.value })}
                  className="w-24 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono uppercase focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-slate-100"
                  required
                />
                <input
                  type="text"
                  placeholder="Verified benchmark specification text..."
                  value={editingFact ? editingFact.text : newFact.text}
                  onChange={(e) =>
                    editingFact
                      ? setEditingFact({ ...editingFact, text: e.target.value })
                      : setNewFact({ ...newFact, text: e.target.value })
                  }
                  className="flex-1 min-w-[200px] px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {editingFact ? "Update Fact" : "Save Fact"}
                  </button>
                  {editingFact && (
                    <button
                      type="button"
                      onClick={() => setEditingFact(null)}
                      className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              {factFormError && (
                <div className="p-3 bg-red-50 border-t border-red-100 text-xs text-red-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{factFormError}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: CONTENT CREATOR (The Core Loop Mockup)                            */}
        {/* ========================================================================= */}
        {activeRole === "creator" && (
          <div className="space-y-6 animate-fade-in">
            {/* Draft Submission Box */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Draft Pre-Publication Check</h2>
                  <p className="text-xs text-slate-500">
                    Submit marketing copy to review against brand rules and verified facts.
                  </p>
                </div>

                {/* Quick Test Draft Presets & Demo Scenario Button */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleLoadDemoScenario}
                    className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Load Demo Scenario
                  </button>

                  <select
                    onChange={(e) => {
                      const found = sampleDrafts.find((s) => s.id === e.target.value);
                      if (found) handleSelectSample(found);
                    }}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    defaultValue=""
                  >
                    <option value="" disabled>Quick Test Drafts...</option>
                    {sampleDrafts.map((sample) => (
                      <option key={sample.id} value={sample.id}>
                        {sample.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Draft Title</label>
                  <input
                    type="text"
                    value={draftTitle}
                    placeholder="e.g. CampusPro Product Launch"
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Target Channel</label>
                  <select
                    value={draftChannel}
                    onChange={(e) => setDraftChannel(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Social Media / Twitter">Social Media / Twitter</option>
                    <option value="Marketing Email">Marketing Email</option>
                    <option value="Product Landing Page">Product Landing Page</option>
                    <option value="Ad Copy / Banner">Ad Copy / Banner</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleRunAiCheck}
                    disabled={isReviewing}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-xs disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {isReviewing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Running AI Review & Validator...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Run BrandGuard AI Check
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Draft Copy</label>
                <textarea
                  rows={3}
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="Paste marketing copy, social post, or product description here... or click 'Load Demo Scenario' above."
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                  <span>Characters: {draftContent.length} | Words: {draftContent.trim().split(/\s+/).filter(Boolean).length}</span>
                  <span className="text-slate-500">Rules active: {rules.length} | Facts active: {facts.length}</span>
                </div>
              </div>

              {reviewError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{reviewError}</span>
                </div>
              )}
            </div>

            {/* Split Screen Review Interface */}
            {activeDraft ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Side-by-Side Original (with Highlights) vs Proposed Final Copy */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-base">{activeDraft.title}</h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 font-mono">
                            v{activeDraft.version}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          Status: <span className="font-semibold capitalize text-slate-700">{activeDraft.status.replace("_", " ")}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> High
                        </span>
                        <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Med
                        </span>
                        <span className="flex items-center gap-1 text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Fact
                        </span>
                      </div>
                    </div>

                    {/* Side-by-Side Comparison Container */}
                    <div className="mt-4 space-y-4">
                      {/* Original with interactive colored highlights */}
                      <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                          Original Draft (Click highlight to view finding)
                        </span>
                        {renderHighlightedText(activeDraft.originalText, activeDraft.findings)}
                      </div>

                      {/* Live Proposed Final Copy */}
                      <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-200">
                        <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1.5">
                          Proposed Final Copy (Reflecting Accepted & Edited Fixes)
                        </span>
                        <p className="text-sm font-medium text-emerald-950 whitespace-pre-wrap leading-relaxed">
                          {activeDraft.currentText}
                        </p>
                      </div>
                    </div>

                    {/* Validator Stats (Real Counts) */}
                    <div className="mt-4 p-3 bg-slate-100/70 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-700">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-blue-600" />
                        <span>
                          <strong>Validator:</strong> {activeDraft.findings?.length || 0} valid findings kept,{" "}
                          {activeDraft.validatorRejected?.length || 0} dropped
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Model: {serverInfo.modelName}
                      </span>
                    </div>

                    {/* Reviewer Comments thread if any */}
                    {activeDraft.comments && activeDraft.comments.length > 0 && (
                      <div className="mt-4 border-t border-slate-100 pt-3">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1 mb-2">
                          <MessageSquare className="w-3.5 h-3.5 text-blue-600" /> Reviewer Notes:
                        </span>
                        <div className="space-y-2">
                          {activeDraft.comments.map((c) => (
                            <div key={c.id} className="p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-lg text-xs">
                              <div className="flex items-center justify-between font-semibold text-amber-900 mb-0.5">
                                <span>{c.author}</span>
                                <span className="text-[10px] text-amber-600 font-normal">
                                  {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-amber-800">{c.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Submission to Reviewer Action */}
                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Send finalized draft with your accepted fixes to reviewer.
                    </span>
                    <button
                      onClick={handleSubmitToReviewer}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <Send className="w-3.5 h-3.5" /> Submit to Reviewer
                    </button>
                  </div>
                </div>

                {/* Right Column: Finding Cards with Accept, Edit, Reject, and Undo */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      Findings & Fixes ({activeDraft.findings?.length || 0})
                    </h3>
                    <span className="text-xs text-slate-500">Click card to highlight</span>
                  </div>

                  {(!activeDraft.findings || activeDraft.findings.length === 0) && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                      <h4 className="font-bold text-slate-800 text-sm">No Compliance Issues Detected</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Draft complies with all active brand guidelines and verified facts.
                      </p>
                    </div>
                  )}

                  <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
                    {activeDraft.findings?.map((finding) => {
                      const isPending = !finding.status || finding.status === "pending";
                      const isSelected = selectedFindingId === finding.id;

                      let borderClass = "border-slate-200";
                      if (isSelected) borderClass = "border-blue-500 ring-2 ring-blue-500/20";
                      else if (finding.severity === "high") borderClass = "border-red-200";
                      else if (finding.category === "fact") borderClass = "border-purple-200";

                      return (
                        <div
                          key={finding.id}
                          onClick={() => setSelectedFindingId(finding.id)}
                          className={`bg-white rounded-xl border p-4 transition-all shadow-2xs ${borderClass} ${
                            !isPending ? "bg-slate-50/60" : ""
                          }`}
                        >
                          {/* Header: Rule ID, Severity, Needs Human Judgement */}
                          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                                {finding.rule_id}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                                  finding.severity === "high"
                                    ? "bg-red-50 text-red-700"
                                    : finding.severity === "medium"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {finding.severity}
                              </span>

                              {finding.needs_human_judgement && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Needs your judgement
                                </span>
                              )}
                            </div>

                            {/* Current Decision Badge */}
                            {!isPending && (
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                  finding.status === "accepted"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : finding.status === "edited"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-slate-200 text-slate-600"
                                }`}
                              >
                                {finding.status}
                              </span>
                            )}
                          </div>

                          {/* Quoted issue */}
                          <div className="mb-2 text-xs">
                            <span className="text-slate-400 font-medium">Flagged text: </span>
                            <span className="font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                              "{finding.quote}"
                            </span>
                          </div>

                          {/* Explanation */}
                          <p className="text-xs text-slate-600 mb-3 font-medium leading-relaxed">
                            {finding.explanation}
                          </p>

                          {/* Suggested Fix View or Inline Edit Box */}
                          {editingFixId === finding.id ? (
                            <div className="mb-3 space-y-2">
                              <label className="text-[11px] font-bold text-slate-700">Customize Replacement Text:</label>
                              <input
                                type="text"
                                value={customFixText}
                                onChange={(e) => setCustomFixText(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleFindingAction(finding.id, "edit", customFixText)}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  Save & Apply
                                </button>
                                <button
                                  onClick={() => setEditingFixId(null)}
                                  className="px-2 py-1 text-slate-500 text-[11px]"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-lg mb-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                                Suggested Fix
                              </span>
                              <p className="text-xs font-semibold text-blue-900">
                                "{finding.suggested_fix}"
                              </p>
                            </div>
                          )}

                          {/* Action Controls: Accept, Edit, Reject at all times + Undo */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                            {isPending ? (
                              <>
                                <button
                                  onClick={() => handleFindingAction(finding.id, "accept")}
                                  className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                  <Check className="w-3.5 h-3.5" /> Accept
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingFixId(finding.id);
                                    setCustomFixText(finding.suggested_fix);
                                  }}
                                  className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center justify-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <Edit3 className="w-3.5 h-3.5" /> Edit
                                </button>
                                <button
                                  onClick={() => handleFindingAction(finding.id, "reject")}
                                  className="py-1.5 px-2.5 bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-500 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
                                  title="Reject finding"
                                >
                                  <X className="w-3.5 h-3.5" /> Reject
                                </button>
                              </>
                            ) : (
                              <div className="w-full flex items-center justify-between">
                                <span className="text-xs text-slate-500 font-medium">
                                  Decided: <strong className="capitalize text-slate-700">{finding.status}</strong>
                                </span>
                                <button
                                  onClick={() => handleFindingAction(finding.id, "undo")}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <RotateCcw className="w-3 h-3" /> Undo Decision
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Empty state if visitor hasn't run any draft yet */
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                <FileText className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="text-base font-bold text-slate-800">No Drafts in Workspace</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Paste your marketing draft above, or click below to load the CampusPro sample scenario and run the governance check.
                </p>
                <button
                  onClick={handleLoadDemoScenario}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Load CampusPro Demo Draft
                </button>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 3: REVIEWER APPROVAL & AUDIT TRAIL                                   */}
        {/* ========================================================================= */}
        {activeRole === "reviewer" && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Reviewer Approval Board</h1>
                <p className="text-xs text-slate-500">
                  Inspect creator revisions, verify evidence and suggested changes, add comments, and sign off.
                </p>
              </div>
            </div>

            {allDrafts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                <UserCheck className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="text-base font-bold text-slate-800">No Drafts Awaiting Review</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Content creators submit drafts here after resolving AI findings.
                </p>
                <button
                  onClick={() => changeRole("creator")}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Go to Content Creator View
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Drafts Queue Sidebar */}
                <div className="lg:col-span-4 space-y-3">
                  <h3 className="font-bold text-slate-700 text-xs uppercase tracking-wider">
                    Drafts Queue ({allDrafts.length})
                  </h3>
                  <div className="space-y-2">
                    {allDrafts.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => setActiveDraft(d)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          activeDraft?.id === d.id
                            ? "bg-white border-blue-500 ring-2 ring-blue-500/10 shadow-xs"
                            : "bg-white border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900 text-sm truncate">{d.title}</span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                              d.status === "approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : d.status === "changes_requested"
                                ? "bg-red-100 text-red-800"
                                : d.status === "pending_reviewer"
                                ? "bg-blue-100 text-blue-800 font-bold animate-pulse"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {d.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-1">{d.currentText}</p>
                        <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
                          <span>By {d.creator}</span>
                          <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reviewer Action Panel */}
                {activeDraft && (
                  <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-5">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">{activeDraft.title}</h2>
                        <p className="text-xs text-slate-500">
                          Channel: <strong>{activeDraft.channel}</strong> | Version: <strong>v{activeDraft.version}</strong>
                        </p>
                      </div>

                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                          activeDraft.status === "approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : activeDraft.status === "changes_requested"
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {activeDraft.status.replace("_", " ")}
                      </span>
                    </div>

                    {/* Before / After Comparison */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Original Submitted Copy
                        </span>
                        <p className="text-xs text-slate-600 line-through decoration-red-400 leading-relaxed whitespace-pre-wrap">
                          {activeDraft.originalText}
                        </p>
                      </div>

                      <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl">
                        <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">
                          Current Finalized Copy
                        </span>
                        <p className="text-xs font-medium text-emerald-950 leading-relaxed whitespace-pre-wrap">
                          {activeDraft.currentText}
                        </p>
                      </div>
                    </div>

                    {/* Resolved Findings Recap */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                        Resolved Findings ({activeDraft.findings?.length || 0})
                      </h4>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {activeDraft.findings?.map((f) => (
                          <div key={f.id} className="p-2 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-blue-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[10px]">
                                {f.rule_id}
                              </span>
                              <span className="text-slate-700">
                                Replaced <strong className="text-red-700">"{f.quote}"</strong> &rarr; <strong className="text-emerald-700">"{f.suggested_fix}"</strong>
                              </span>
                            </div>
                            <span className="text-[10px] font-bold capitalize text-slate-500 bg-slate-200 px-2 py-0.5 rounded">
                              {f.status || "pending"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Reviewer Notes Box with Save Note Button */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-700">Reviewer Feedback Note</label>
                        <button
                          type="button"
                          onClick={handleSaveReviewerNote}
                          disabled={!reviewerComment.trim() || isSavingNote}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800 disabled:opacity-40 flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" /> Save note
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={reviewerComment}
                        onChange={(e) => setReviewerComment(e.target.value)}
                        placeholder="Add compliance notes, rationale, or instructions for the creator..."
                        className="w-full p-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* Decision Controls: Approve or Request Changes */}
                    <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                      <button
                        onClick={() => handleReviewerDecision("approve")}
                        className="flex-1 py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve Publication
                      </button>
                      <button
                        onClick={() => handleReviewerDecision("request_changes")}
                        className="py-2 px-4 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-600" /> Request Revisions
                      </button>
                    </div>

                    {/* Real Audit Trail / Revision History */}
                    <div className="pt-3 border-t border-slate-100">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-2">
                        <History className="w-3.5 h-3.5 text-blue-600" /> Audit Trail (Local Time):
                      </span>
                      <div className="space-y-1.5 max-h-44 overflow-y-auto">
                        {activeDraft.history?.map((h, i) => (
                          <div key={h.id || i} className="text-[11px] text-slate-600 flex items-start gap-2">
                            <span className="font-mono text-slate-400 shrink-0">
                              {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className="font-bold text-slate-800 shrink-0">[{h.actor}]</span>
                            <span>{h.action}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 4: REAL GOVERNANCE INSIGHTS (Computed from Stored Data)               */}
        {/* ========================================================================= */}
        {activeRole === "insights" && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Governance Insights</h1>
              <p className="text-xs text-slate-500">
                Actionable analytics computed directly from your workspace drafts and user review decisions.
              </p>
            </div>

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Drafts Analysed
                </span>
                <span className="text-3xl font-extrabold text-slate-900">{insights?.draftsAnalysed ?? 0}</span>
                <span className="text-[11px] text-slate-500 font-medium block mt-1">Total in workspace</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Findings Flagged
                </span>
                <span className="text-3xl font-extrabold text-blue-600">{insights?.findingsFlagged ?? 0}</span>
                <span className="text-[11px] text-slate-500 font-medium block mt-1">
                  {insights ? `${insights.findingsAccepted} accepted, ${insights.findingsEdited} edited, ${insights.findingsRejected} rejected` : "0 decisions"}
                </span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Fix Acceptance Rate
                </span>
                <span className="text-3xl font-extrabold text-emerald-600">
                  {insights?.fixAcceptanceRate !== null && insights?.fixAcceptanceRate !== undefined
                    ? `${insights.fixAcceptanceRate}%`
                    : "N/A"}
                </span>
                <span className="text-[11px] text-slate-500 font-medium block mt-1">
                  {insights?.totalDecisions ? `${insights.findingsAccepted} of ${insights.totalDecisions} decisions` : "No decisions yet"}
                </span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Validator Stats
                </span>
                <span className="text-xl font-extrabold text-purple-700">
                  {insights?.validatorStats
                    ? `${insights.validatorStats.validKept} kept, ${insights.validatorStats.dropped} dropped`
                    : "0 kept, 0 dropped"}
                </span>
                <span className="text-[11px] text-slate-500 font-medium block mt-1">Verbatim quote check</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Violated Guidelines by Real Count */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6">
                <h3 className="font-bold text-slate-900 text-base mb-1">Top Violated Brand Guidelines</h3>
                <p className="text-xs text-slate-500 mb-4">Guidelines most frequently flagged in submitted drafts</p>

                {(!insights?.topRules || insights.topRules.length === 0) ? (
                  <p className="text-xs text-slate-400 italic">No violation data recorded yet. Run a draft check to view stats.</p>
                ) : (
                  <div className="space-y-3">
                    {insights.topRules.map((r, i) => (
                      <div key={r.rule_id} className="flex items-start justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 gap-2">
                        <div className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <div>
                            <span className="font-mono font-bold text-slate-800 text-xs mr-2">{r.rule_id}</span>
                            <span className="text-xs text-slate-700 font-medium">{r.rule_text}</span>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-blue-600 px-2 py-0.5 bg-blue-50 rounded shrink-0">
                          {r.count} {r.count === 1 ? "flag" : "flags"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Honest, Rule-Based Unclear Guideline Detection */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <h3 className="font-bold text-slate-900 text-base">Unclear Guideline Detection</h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Algorithmic detection: flagged only when a rule has &ge; 3 findings and &ge; 40% dispute rate (rejected or edited).
                </p>

                {(!insights?.unclearGuidelines || insights.unclearGuidelines.length === 0) ? (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-500 leading-relaxed">
                    Not enough data yet. Rules appear here after they are flagged 3+ times and often rejected.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {insights.unclearGuidelines.map((ug) => (
                      <div key={ug.rule_id} className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 bg-amber-200 text-amber-900 text-[11px] font-mono font-bold rounded">
                            {ug.rule_id}
                          </span>
                          <span className="text-xs font-bold text-amber-900">
                            {ug.disputePercentage}% Dispute Rate
                          </span>
                        </div>
                        <p className="text-xs font-medium text-amber-950">{ug.rule_text}</p>
                        <p className="text-xs text-amber-800 leading-relaxed">{ug.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Accessible 4-Step Guide Modal (Closes on Esc, outside click, close button) */}
      {showGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-modal-title"
          onClick={() => setShowGuideModal(false)}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowGuideModal(false);
            }}
            tabIndex={-1}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-5 focus:outline-none"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <h3 id="guide-modal-title" className="font-extrabold text-slate-900 text-lg">
                  Try BrandGuard in 4 Steps
                </h3>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Close guide modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ol className="space-y-3.5 text-xs text-slate-700">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-xs">
                  1
                </span>
                <div>
                  <strong className="text-slate-900 block text-sm">Brand Manager:</strong>
                  Review active brand rules (e.g. R-12 superlatives) and approved benchmark facts.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-xs">
                  2
                </span>
                <div>
                  <strong className="text-slate-900 block text-sm">Content Creator:</strong>
                  Pick the CampusPro draft from the dropdown and click <em>Run BrandGuard AI Check</em>.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-xs">
                  3
                </span>
                <div>
                  <strong className="text-slate-900 block text-sm">Human Decision:</strong>
                  Accept, edit, or reject each suggestion (with undo support), then submit to reviewer.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-xs">
                  4
                </span>
                <div>
                  <strong className="text-slate-900 block text-sm">Reviewer & Insights:</strong>
                  Add a review note and Approve; open Insights to see live analytics and validator statistics.
                </div>
              </li>
            </ol>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowGuideModal(false);
                  handleLoadDemoScenario();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <span>Start the tour</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer with Dynamic Model Name from Server Config */}
      <footer className="bg-white border-t border-slate-200 py-4 px-4 sm:px-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            <strong>BrandGuard</strong> &bull; Explainable Brand Governance &bull; Workspace ID:{" "}
            <code className="font-mono text-slate-700">{workspaceId.slice(0, 12)}...</code>
          </span>
          <span className="text-slate-400">
            Powered by {serverInfo.modelName} &bull; Validator Engine &bull; Private Per-Visitor Workspace
          </span>
        </div>
      </footer>
    </div>
  );
}
