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
  ArrowRight,
  Image as ImageIcon,
  Palette,
  Eye,
  Upload,
  Trash2
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

  // Creator Mode Toggle: "text" | "visual"
  const [creatorMode, setCreatorMode] = useState("text");

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

  // Brand Visual Settings (Brand Manager)
  const [visualSettings, setVisualSettings] = useState({
    palette: ["#1D4ED8", "#0F172A", "#FFFFFF", "#F59E0B"],
    minContrastRatio: 4.5,
    disclaimerPhrase: "",
    rules: [
      { id: "V-01", category: "accessibility", text: "Text must meet the minimum contrast ratio", severity: "high" },
      { id: "V-02", category: "brand", text: "Use only brand palette colours", severity: "medium" },
      { id: "V-03", category: "accessibility", text: "Every image needs alt text", severity: "medium" },
      { id: "V-04", category: "claim", text: "If a disclaimer phrase is set, it must appear in the image text", severity: "high" }
    ]
  });
  const [newColorHex, setNewColorHex] = useState("#2563EB");

  // Creator & Review State (Text)
  const [draftTitle, setDraftTitle] = useState("");
  const [draftChannel, setDraftChannel] = useState("Social Media / Twitter");
  const [draftContent, setDraftContent] = useState("");
  const [activeDraft, setActiveDraft] = useState(null);
  const [allDrafts, setAllDrafts] = useState([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [selectedFindingId, setSelectedFindingId] = useState(null);

  // Creator & Review State (Visual Audit)
  const [isVisualAuditing, setIsVisualAuditing] = useState(false);
  const [visualAuditError, setVisualAuditError] = useState(null);
  const [visualImagePreview, setVisualImagePreview] = useState(null);
  const [hoveredRegionIdx, setHoveredRegionIdx] = useState(null);
  const [editableAltText, setEditableAltText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [copiedItem, setCopiedItem] = useState(null);
  const fileInputRef = useRef(null);

  const handleCopyText = (text, id) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedItem(id);
      setTimeout(() => setCopiedItem(null), 2000);
    }
  };

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
      const [rulesRes, factsRes, samplesRes, draftsRes, insightsRes, visualRes] = await Promise.all([
        wsFetch("/api/rules"),
        wsFetch("/api/facts"),
        wsFetch("/api/sample-drafts"),
        wsFetch("/api/drafts"),
        wsFetch("/api/insights"),
        wsFetch("/api/visual-settings")
      ]);

      if (rulesRes.ok) setRules(await rulesRes.json());
      if (factsRes.ok) setFacts(await factsRes.json());
      if (samplesRes.ok) setSampleDrafts(await samplesRes.json());
      if (draftsRes.ok) {
        const dList = await draftsRes.json();
        setAllDrafts(dList);
        if (dList.length > 0) {
          setActiveDraft((prev) => (prev ? dList.find((d) => d.id === prev.id) || dList[0] : dList[0]));
        } else {
          setActiveDraft(null);
        }
      }
      if (insightsRes.ok) setInsights(await insightsRes.json());
      if (visualRes && visualRes.ok) setVisualSettings(await visualRes.json());
    } catch (e) {
      console.error("Error loading workspace data", e);
    }
  };

  // Save Brand Visual Settings
  const handleSaveVisualSettings = async (updated) => {
    try {
      const res = await wsFetch("/api/visual-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated || visualSettings)
      });
      if (res.ok) {
        const data = await res.json();
        setVisualSettings(data.visualSettings);
        showNotice("Visual brand settings saved successfully.");
      }
    } catch (e) {
      console.error("Failed to save visual settings", e);
    }
  };

  const handleAddPaletteColor = () => {
    const hex = newColorHex.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/i.test(hex)) {
      alert("Please enter a valid 6-character hex color (e.g. #1D4ED8).");
      return;
    }
    if (visualSettings.palette.includes(hex)) return;
    const updated = {
      ...visualSettings,
      palette: [...visualSettings.palette, hex]
    };
    setVisualSettings(updated);
    handleSaveVisualSettings(updated);
  };

  const handleRemovePaletteColor = (colorToRemove) => {
    if (visualSettings.palette.length <= 1) {
      alert("At least one brand palette color is required.");
      return;
    }
    const updated = {
      ...visualSettings,
      palette: visualSettings.palette.filter((c) => c !== colorToRemove)
    };
    setVisualSettings(updated);
    handleSaveVisualSettings(updated);
  };

  // Run Visual Audit on uploaded image or sample banner
  const handleRunVisualAudit = async (base64Image, title = "Visual Banner Audit", channel = "Social / Display Banner") => {
    setIsVisualAuditing(true);
    setVisualAuditError(null);
    setVisualImagePreview(base64Image);

    try {
      const res = await wsFetch("/api/visual-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64Image,
          draftTitle: title,
          channel: channel
        })
      });

      if (res.status === 429) {
        const err = await res.json();
        throw new Error(err.error || "Rate limit reached (10 checks per minute). Please wait a moment.");
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to analyze image.");
      }

      const data = await res.json();
      setActiveDraft(data.draft);
      setEditableAltText(data.alt_text || "");
      await loadWorkspaceData();
      showNotice(`Visual audit completed: ${data.findings.length} findings flagged.`);
    } catch (err) {
      setVisualAuditError(err.message);
    } finally {
      setIsVisualAuditing(false);
    }
  };

  // Load Sample Banner Preset
  const handleLoadSampleBanner = async (sampleFileName, label) => {
    setCreatorMode("visual");
    setIsVisualAuditing(true);
    setVisualAuditError(null);
    try {
      const response = await fetch(`/samples/${sampleFileName}`);
      if (!response.ok) throw new Error(`Could not load sample banner ${sampleFileName}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        handleRunVisualAudit(reader.result, label, "Social / Banner");
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      setIsVisualAuditing(false);
      setVisualAuditError(e.message);
    }
  };

  // Handle Drag & Drop / File Upload
  const handleImageFileUpload = (file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setVisualAuditError("Image exceeds 4 MB maximum size limit.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      handleRunVisualAudit(reader.result, file.name.replace(/\.[^/.]+$/, ""), "Social / Display Banner");
    };
    reader.readAsDataURL(file);
  };

  // Save Alt-Text for active visual draft
  const handleSaveAltText = async () => {
    if (!activeDraft) return;
    try {
      const res = await wsFetch(`/api/drafts/${activeDraft.id}/alt-text`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ altText: editableAltText })
      });
      if (res.ok) {
        const data = await res.json();
        setActiveDraft(data.draft);
        await loadWorkspaceData();
        showNotice("Image alt-text updated.");
      }
    } catch (e) {
      console.error(e);
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

  // Contrast Math Helpers (WCAG AA)
  const getRgbFromHex = (hex) => {
    if (!hex || typeof hex !== "string") return [0, 0, 0];
    const clean = hex.replace("#", "").trim();
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [0, 0, 0];
    if (clean.length === 3) {
      return [((num >> 8) & 0xf) * 17, ((num >> 4) & 0xf) * 17, (num & 0xf) * 17];
    }
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };

  const getLuminance = (r, g, b) => {
    const [rL, gL, bL] = [r / 255, g / 255, b / 255].map((c) =>
      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
  };

  const calcContrast = (hex1, hex2) => {
    const rgb1 = getRgbFromHex(hex1);
    const rgb2 = getRgbFromHex(hex2);
    const l1 = getLuminance(...rgb1);
    const l2 = getLuminance(...rgb2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
  };

  // Helper: Render Audited Banner Image with Interactive Bounding Boxes
  const renderBannerImageWithBoxes = (draft, preview) => {
    if (!draft) return null;
    const imgSrc = preview || draft.imagePath;

    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-slate-950 flex items-center justify-center p-2 border border-slate-200">
        <div className="relative inline-block max-w-full">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={draft.altText || "Audited banner"}
              className="max-h-[440px] w-auto max-w-full object-contain rounded-lg block"
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
              Banner image not available
            </div>
          )}

          {/* Bounding box overlays */}
          {draft.regions?.map((reg, idx) => {
            const isHovered = hoveredRegionIdx === idx;
            const measuredRatio = reg.contrastRatio || (reg.fgColor && reg.bgColor ? calcContrast(reg.fgColor, reg.bgColor) : null);
            const isFindingSelected =
              selectedFindingId &&
              draft.findings?.some(
                (f) =>
                  f.id === selectedFindingId &&
                  ((f.quote && reg.text && f.quote.toLowerCase().includes(reg.text.toLowerCase())) ||
                    (f.explanation && f.explanation.includes(reg.text)))
              );
            const hasContrastFail = reg.passesContrast === false || (measuredRatio !== null && measuredRatio < (visualSettings.minContrastRatio || 4.5));

            return (
              <div
                key={idx}
                onMouseEnter={() => setHoveredRegionIdx(idx)}
                onMouseLeave={() => setHoveredRegionIdx(null)}
                style={{
                  position: "absolute",
                  left: `${(reg.x || 0) * 100}%`,
                  top: `${(reg.y || 0) * 100}%`,
                  width: `${(reg.w || 0) * 100}%`,
                  height: `${(reg.h || 0) * 100}%`
                }}
                className={`cursor-pointer transition-all border-2 rounded-xs ${
                  isHovered || isFindingSelected
                    ? "border-blue-500 bg-blue-500/30 ring-2 ring-blue-400 z-30"
                    : hasContrastFail
                    ? "border-red-500 bg-red-500/20 z-10"
                    : "border-emerald-400 bg-emerald-400/10 z-10"
                }`}
                title={`Region #${idx + 1}: "${reg.text}" (${measuredRatio ? measuredRatio + ':1' : 'could not measure'})`}
              >
                <span
                  className={`absolute -top-4 left-0 text-[9px] font-bold px-1 rounded font-mono shadow-xs ${
                    hasContrastFail ? "bg-red-600 text-white" : "bg-emerald-700 text-white"
                  }`}
                >
                  #{idx + 1} {measuredRatio ? `${measuredRatio}:1` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper: Render Colour and Contrast Governance Card
  const renderColourAndContrastCard = (draft) => {
    if (!draft) return null;
    const paletteCheck = draft.paletteCheck;
    const offPercent = paletteCheck?.offPalettePercentage || 0;
    const onPercent = Math.max(0, 100 - offPercent);

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-sm">Colour &amp; Contrast Governance</h3>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            WCAG AA &amp; Brand Palette
          </span>
        </div>

        {/* Brand Palette Match */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-slate-700">Brand Palette Match (Rule V-02):</span>
            {paletteCheck?.measured ? (
              paletteCheck.flagged ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Flagged ({paletteCheck.off_palette_percentage}% off-palette)
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  ✓ Compliant ({paletteCheck.on_palette_percentage}% on-palette)
                </span>
              )
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                Not measured
              </span>
            )}
          </div>

          {/* Brand Swatches */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[11px] text-slate-500 mr-1">Brand Colours:</span>
            {(visualSettings.palette || []).map((hex) => (
              <span key={hex} className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded">
                <span className="w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: hex }} />
                {hex}
              </span>
            ))}
          </div>

          {/* If off-palette flagged, show dominant 3 off colors */}
          {paletteCheck?.flagged && paletteCheck?.dominantOffColors?.length > 0 && (
            <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs space-y-1.5">
              <span className="text-amber-900 font-bold block">
                3 Most Common Off-Palette Colours:
              </span>
              <div className="flex flex-wrap gap-2">
                {paletteCheck.dominantOffColors.map((offHex, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1.5 font-mono text-[11px] bg-white px-2 py-1 rounded border border-amber-300 shadow-2xs">
                    <span className="w-3.5 h-3.5 rounded-sm border border-slate-300" style={{ backgroundColor: offHex }} />
                    <strong className="text-slate-800">{offHex}</strong>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-amber-800 italic mt-0.5">
                Flagged as needs human judgement because photographic assets legitimately include other colours.
              </p>
            </div>
          )}
        </div>

        {/* Typography Contrast Ratios per Region */}
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700">
              Typography Contrast Ratios (Rule V-01):
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              Min Target: {visualSettings.minContrastRatio || 4.5}:1
            </span>
          </div>

          {(!draft.regions || draft.regions.length === 0) ? (
            <p className="text-xs text-slate-400 italic">No text regions detected in image.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {draft.regions.map((reg, idx) => {
                const measuredRatio = reg.contrastRatio || (reg.fgColor && reg.bgColor ? calcContrast(reg.fgColor, reg.bgColor) : null);
                const calcType = reg.calculationType || (measuredRatio ? "computed" : "estimated");
                const isPassed = measuredRatio !== null ? measuredRatio >= (visualSettings.minContrastRatio || 4.5) : false;
                const isHovered = hoveredRegionIdx === idx;

                return (
                  <div
                    key={idx}
                    onMouseEnter={() => setHoveredRegionIdx(idx)}
                    onMouseLeave={() => setHoveredRegionIdx(null)}
                    className={`p-2.5 rounded-xl border text-xs transition-all ${
                      isHovered
                        ? "border-blue-500 bg-blue-50/50"
                        : isPassed
                        ? "border-slate-200 bg-slate-50/60"
                        : "border-red-200 bg-red-50/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] flex items-center justify-center font-mono">
                          {idx + 1}
                        </span>
                        <span className="truncate max-w-[200px]">"{reg.text}"</span>
                      </span>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {calcType === "computed" ? "[computed]" : "[estimated]"}
                        </span>
                        {measuredRatio ? (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isPassed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800 font-extrabold"
                            }`}
                          >
                            {measuredRatio}:1 {isPassed ? "✓ Pass" : "✕ Fail"}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            Could not measure
                          </span>
                        )}
                      </div>
                    </div>

                    {reg.fgColor && reg.bgColor && (
                      <div className="flex items-center gap-3 text-[11px] text-slate-600 mt-1">
                        <span className="flex items-center gap-1">
                          Text: <span className="w-2.5 h-2.5 rounded-full border border-slate-300" style={{ backgroundColor: reg.fgColor }} />
                          <code className="font-mono">{reg.fgColor}</code>
                        </span>
                        <span className="flex items-center gap-1">
                          Bg: <span className="w-2.5 h-2.5 rounded-full border border-slate-300" style={{ backgroundColor: reg.bgColor }} />
                          <code className="font-mono">{reg.bgColor}</code>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Helper: Render Replacement Copy for the Designer (Text copy fixes only)
  const renderReplacementCopyList = (draft) => {
    if (!draft || !draft.findings) return null;
    const copyFindings = draft.findings.filter(
      (f) => f.suggested_fix && !["V-01", "V-02"].includes(f.rule_id) && f.source !== "contrast" && f.source !== "palette"
    );
    if (copyFindings.length === 0) return null;

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <h4 className="font-bold text-slate-900 text-sm">Replacement Copy for the Designer</h4>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
            Text Copy Only
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Copy-pasteable text replacements to update marketing copy in design artwork:
        </p>

        <div className="space-y-2">
          {copyFindings.map((f, i) => {
            const designerLine = `Change "${f.quote}" to "${f.suggested_fix}"`;
            const isCopied = copiedItem === `copy-${f.id || i}`;

            return (
              <div
                key={f.id || i}
                className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="font-mono text-slate-800 leading-snug">
                  <span className="text-red-700 font-bold line-through mr-1">"{f.quote}"</span>
                  <span className="text-slate-400 font-sans mr-1">&rarr;</span>
                  <span className="text-emerald-700 font-bold">"{f.suggested_fix}"</span>
                  <span className="text-[10px] text-slate-400 font-sans ml-2">[{f.rule_id}]</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyText(designerLine, `copy-${f.id || i}`)}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-[11px] font-bold text-slate-700 transition-all flex items-center gap-1 shrink-0"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <FileText className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper: Render Design Fixes (Visual contrast & colour fixes)
  const renderDesignFixesList = (draft) => {
    if (!draft || !draft.findings) return null;
    const designFindings = draft.findings.filter(
      (f) => ["V-01", "V-02"].includes(f.rule_id) || f.source === "contrast" || f.source === "palette"
    );
    if (designFindings.length === 0) return null;

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-purple-600" />
            <h4 className="font-bold text-slate-900 text-sm">Design Fixes</h4>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
            Contrast &amp; Colour
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Visual styling adjustments required to meet WCAG AA contrast and brand palette guidelines:
        </p>

        <div className="space-y-2">
          {designFindings.map((f, i) => {
            const designLine = f.rule_id === "V-01"
              ? `Change text colour on "${f.quote}" to meet 4.5:1 minimum contrast ratio.`
              : `Adjust background or accents to adhere to approved brand palette colours (${(visualSettings.palette || []).join(", ")}).`;
            const isCopied = copiedItem === `design-${f.id || i}`;

            return (
              <div
                key={f.id || i}
                className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="text-slate-800 leading-snug">
                  <span className="font-mono font-bold text-purple-700 mr-1">[{f.rule_id}]</span>
                  <span>{designLine}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyText(designLine, `design-${f.id || i}`)}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-[11px] font-bold text-slate-700 transition-all flex items-center gap-1 shrink-0"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <FileText className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
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

            {/* Brand Visual Rules & Palette */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <Palette className="w-5 h-5 text-blue-600" />
                    <span>Visual Rules & Brand Palette</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Governs approved banner colours, minimum WCAG text contrast ratios, and required disclaimers
                  </p>
                </div>
              </div>

              <div className="p-5 space-y-6">
                {/* 1. Approved Brand Palette */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Approved Brand Palette Hex Colours
                  </label>
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    {visualSettings.palette.map((color) => (
                      <div
                        key={color}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 shadow-2xs text-xs font-mono font-bold text-slate-800"
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-black/15 shrink-0 shadow-2xs"
                          style={{ backgroundColor: color }}
                        />
                        <span>{color}</span>
                        <button
                          type="button"
                          onClick={() => handleRemovePaletteColor(color)}
                          className="text-slate-400 hover:text-red-600 p-0.5 rounded transition-colors"
                          title={`Remove ${color}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Color Form */}
                  <div className="flex items-center gap-2 max-w-sm">
                    <input
                      type="color"
                      value={newColorHex}
                      onChange={(e) => setNewColorHex(e.target.value.toUpperCase())}
                      className="w-9 h-9 p-0.5 rounded-lg border border-slate-200 cursor-pointer bg-white shrink-0"
                    />
                    <input
                      type="text"
                      value={newColorHex}
                      onChange={(e) => setNewColorHex(e.target.value.toUpperCase())}
                      placeholder="#1D4ED8"
                      maxLength={7}
                      className="w-28 px-2.5 py-1.5 text-xs font-mono uppercase rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddPaletteColor}
                      className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Colour
                    </button>
                  </div>
                </div>

                {/* 2. Contrast & Disclaimer Settings Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Minimum Text Contrast Ratio (WCAG AA)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="21"
                        step="0.1"
                        value={visualSettings.minContrastRatio}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const updated = { ...visualSettings, minContrastRatio: val };
                          setVisualSettings(updated);
                          handleSaveVisualSettings(updated);
                        }}
                        className="w-28 px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-500">
                        Default: <strong>4.5:1</strong> (WCAG AA Compliance)
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Optional Required Disclaimer Phrase
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Terms and conditions apply"
                      value={visualSettings.disclaimerPhrase || ""}
                      onChange={(e) => {
                        const updated = { ...visualSettings, disclaimerPhrase: e.target.value };
                        setVisualSettings(updated);
                        handleSaveVisualSettings(updated);
                      }}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">
                      If set, triggers rule V-04 if missing in image copy.
                    </span>
                  </div>
                </div>

                {/* 3. Visual Rules Table */}
                <div className="pt-4 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                    Enforced Visual Governance Rules ({visualSettings.rules.length})
                  </span>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                          <th className="py-2.5 px-3">Rule ID</th>
                          <th className="py-2.5 px-3">Category</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Severity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visualSettings.rules.map((vr) => (
                          <tr key={vr.id} className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-3 font-mono font-bold text-blue-600">{vr.id}</td>
                            <td className="py-2.5 px-3 capitalize text-slate-600 font-medium">{vr.category}</td>
                            <td className="py-2.5 px-3 text-slate-800">{vr.text}</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                                  vr.severity === "high"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-amber-50 text-amber-700"
                                }`}
                              >
                                {vr.severity}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: CONTENT CREATOR (Text Copy + Visual Banner Auditor)              */}
        {/* ========================================================================= */}
        {activeRole === "creator" && (
          <div className="space-y-6 animate-fade-in">
            {/* Mode Switcher Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreatorMode("text")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    creatorMode === "text"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>Copy (text)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreatorMode("visual")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    creatorMode === "visual"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Banner (image)</span>
                </button>
              </div>

              <span className="text-xs text-slate-500 font-medium px-2">
                {creatorMode === "text"
                  ? "Review written copy against brand rules and verified facts"
                  : "Visual Auditor: Contrast (WCAG AA), brand palette & disclaimer detection"}
              </span>
            </div>

            {/* TAB 1: TEXT DRAFT SUBMISSION */}
            {creatorMode === "text" && (
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
                          Running AI Review &amp; Validator...
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
            )}

            {/* TAB 2: VISUAL BANNER AUDITOR SUBMISSION */}
            {creatorMode === "visual" && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-blue-600" />
                      Visual Banner Auditor
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Upload display ads or marketing banners (PNG, JPG, WebP &le; 4 MB). The image is sent to Google Gemini for analysis.
                    </p>
                  </div>

                  {/* Quick-test buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                      Quick Tests:
                    </span>
                    <button
                      type="button"
                      disabled={isVisualAuditing}
                      onClick={() => handleLoadSampleBanner("bad-banner.png", "Sample Bad Banner")}
                      className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Try Bad Banner
                    </button>
                    <button
                      type="button"
                      disabled={isVisualAuditing}
                      onClick={() => handleLoadSampleBanner("clean-banner.png", "Sample Clean Banner")}
                      className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Try Clean Banner
                    </button>
                    <button
                      type="button"
                      disabled={isVisualAuditing}
                      onClick={() => handleLoadSampleBanner("injection-banner.png", "Sample Prompt Injection Banner")}
                      className="px-3 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Try Injection Banner
                    </button>
                  </div>
                </div>

                {/* Drag-and-drop / file picker zone */}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleImageFileUpload(e.target.files[0]);
                    }
                  }}
                />

                <div
                  onClick={() => !isVisualAuditing && fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleImageFileUpload(e.dataTransfer.files[0]);
                    }
                  }}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20"
                      : "border-slate-300 hover:border-blue-400 hover:bg-slate-50/60"
                  } ${isVisualAuditing ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        Drop your banner image here, or <span className="text-blue-600 underline">browse</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Supports PNG, JPG, or WebP up to 4 MB (real content-type validated)
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      The image is sent to Google Gemini for analysis.
                    </span>
                  </div>
                </div>

                {/* Loading State while processing */}
                {isVisualAuditing && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-600 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-blue-900">Reading the image...</p>
                      <p className="text-[11px] text-blue-700 mt-0.5">
                        Downscaling to max 1600px &bull; Calling Gemini Vision for OCR &bull; WCAG AA typography contrast check &bull; CIE Lab palette analysis &bull; Verbatim text validator
                      </p>
                    </div>
                  </div>
                )}

                {visualAuditError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{visualAuditError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Split Screen Review Interface */}
            {activeDraft ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Visual Banner Review OR Text Copy Review */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-base">{activeDraft.title}</h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 font-mono">
                            v{activeDraft.version}
                          </span>
                          {activeDraft.isVisual && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 font-mono">
                              Visual Banner
                            </span>
                          )}
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

                    {/* Content Section: Visual vs Text */}
                    {activeDraft.isVisual ? (
                      <div className="mt-4 space-y-4">
                        {/* Image Preview with overlay bounding boxes */}
                        {renderBannerImageWithBoxes(activeDraft, visualImagePreview)}

                        {/* Extracted Text with Highlighted Quotes */}
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              Extracted Banner Text (Click highlight to view finding)
                            </span>
                            {activeDraft.hasLogo !== undefined && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono">
                                {activeDraft.hasLogo ? "Brand Logo Detected" : "No logo detected"}
                              </span>
                            )}
                          </div>
                          {renderHighlightedText(activeDraft.originalText || activeDraft.extractedText, activeDraft.findings)}
                        </div>

                        {/* Editable Alt-Text Box (Rule V-03) */}
                        <div className="p-3.5 bg-blue-50/40 rounded-xl border border-blue-200/80">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                              <Eye className="w-3.5 h-3.5 text-blue-600" />
                              Image Alt Text (Rule V-03)
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                (activeDraft.altText || editableAltText)
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {(activeDraft.altText || editableAltText) ? "Alt Text Present" : "Missing Alt Text (V-03)"}
                            </span>
                          </div>
                          <div className="space-y-2">
                            <textarea
                              rows={2}
                              maxLength={125}
                              value={editableAltText}
                              onChange={(e) => setEditableAltText(e.target.value)}
                              placeholder="Describe image concisely for screen readers (max 125 chars)..."
                              className="w-full p-2.5 text-xs bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans"
                            />
                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                              <span>{editableAltText.length} / 125 characters</span>
                              <button
                                type="button"
                                onClick={handleSaveAltText}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-2xs"
                              >
                                <Save className="w-3 h-3" /> Save Alt Text
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Standard Text Side-by-Side Comparison */
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
                            Proposed Final Copy (Reflecting Accepted &amp; Edited Fixes)
                          </span>
                          <p className="text-sm font-medium text-emerald-950 whitespace-pre-wrap leading-relaxed">
                            {activeDraft.currentText}
                          </p>
                        </div>
                      </div>
                    )}

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

                {/* Right Column: Visual Cards (if visual) + Finding Cards (Accept, Edit, Reject, Undo) */}
                <div className="lg:col-span-5 space-y-4">
                  {/* If active draft is a visual banner, show Colour/Contrast Card, Replacement Copy, and Design Fixes */}
                  {activeDraft.isVisual && (
                    <>
                      {renderColourAndContrastCard(activeDraft)}
                      {renderReplacementCopyList(activeDraft)}
                      {renderDesignFixesList(activeDraft)}
                    </>
                  )}

                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      Findings &amp; Fixes ({activeDraft.findings?.length || 0})
                    </h3>
                    <span className="text-xs text-slate-500">Click card to highlight</span>
                  </div>

                  {(!activeDraft.findings || activeDraft.findings.length === 0) && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                      <h4 className="font-bold text-slate-800 text-sm">No Compliance Issues Detected</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Draft complies with all active brand guidelines, visual rules, and verified facts.
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
                                  Save &amp; Apply
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
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4">
                <FileText className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="text-base font-bold text-slate-800">No Drafts in Workspace</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Submit a written marketing draft or upload a banner image above to run the explainable BrandGuard check.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    onClick={handleLoadDemoScenario}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Load CampusPro Demo Draft
                  </button>
                  <button
                    onClick={() => handleLoadSampleBanner("clean-banner.png", "Sample Clean Banner")}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <ImageIcon className="w-3.5 h-3.5" /> Try Sample Clean Banner
                  </button>
                </div>
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

                    {/* Visual Banner Review vs Standard Copy Comparison */}
                    {activeDraft.isVisual ? (
                      <div className="space-y-4">
                        {/* Audited Banner Image */}
                        {renderBannerImageWithBoxes(activeDraft)}

                        {/* Extracted Text & Alt Text */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                Extracted Banner Text (OCR)
                              </span>
                              {activeDraft.hasLogo !== undefined && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono">
                                  {activeDraft.hasLogo ? "Brand Logo Detected" : "No logo detected"}
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-mono text-slate-800 leading-relaxed whitespace-pre-wrap">
                              {activeDraft.originalText || activeDraft.extractedText}
                            </p>
                          </div>

                          <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl">
                            <span className="text-[10px] font-bold text-blue-900 uppercase tracking-wider block mb-1 flex items-center gap-1">
                              <Eye className="w-3 h-3 text-blue-600" /> Accessibility Alt Text (V-03)
                            </span>
                            <p className="text-xs font-medium text-slate-800 leading-relaxed">
                              {activeDraft.altText ? (
                                `"${activeDraft.altText}"`
                              ) : (
                                <span className="text-red-600 italic">No alt text provided (Rule V-03 violation)</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Colour & Contrast Governance Card */}
                        {renderColourAndContrastCard(activeDraft)}

                        {/* Replacement Copy and Design Fixes Lists */}
                        {renderReplacementCopyList(activeDraft)}
                        {renderDesignFixesList(activeDraft)}
                      </div>
                    ) : (
                      /* Before / After Text Copy Comparison */
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
                    )}

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
                <span className="text-[11px] text-slate-500 font-medium block mt-1">
                  {insights ? `${insights.textDraftsCount || 0} text drafts • ${insights.visualDraftsCount || 0} banners` : "0 text • 0 banners"}
                </span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Findings Flagged
                </span>
                <span className="text-3xl font-extrabold text-blue-600">{insights?.findingsFlagged ?? 0}</span>
                <span className="text-[11px] text-slate-500 font-medium block mt-1">
                  {insights ? `${insights.textFindingsCount || 0} text • ${insights.visualFindingsCount || 0} visual rules` : "0 decisions"}
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
