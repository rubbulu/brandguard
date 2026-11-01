import React, { useState, useEffect, useRef } from "react";
import {
  Shield,
  ShieldCheck,
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
  ChevronDown,
  Plus,
  RotateCcw,
  Save,
  ArrowRight,
  Image as ImageIcon,
  Palette,
  Eye,
  Upload,
  Trash2,
  Sliders
} from "lucide-react";
import RedlineDiff from "./components/RedlineDiff";
import ComplianceCertificate from "./components/ComplianceCertificate";
import PublicVerifyPage from "./components/PublicVerifyPage";
import ErrorBoundary from "./components/ErrorBoundary";

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
    const rawHash = typeof window !== "undefined" ? window.location.hash : "";
    const hash = rawHash.replace(/^#\/?/, "");
    return ["manager", "creator", "reviewer", "insights"].includes(hash) ? hash : "manager";
  });

  const changeRole = (role) => {
    setActiveRole(role);
    window.location.hash = `#/${role}`;
  };

  // Certificate & Verification State
  const [verifyCertId, setVerifyCertId] = useState(() => {
    const pathname = window.location.pathname;
    if (pathname.startsWith("/verify/")) {
      return pathname.replace("/verify/", "").trim();
    }
    const hash = window.location.hash;
    if (hash.startsWith("#/verify/")) {
      return hash.replace("#/verify/", "").trim();
    }
    return null;
  });
  const [viewingCertificateDraft, setViewingCertificateDraft] = useState(null);

  // Creator Mode Toggle: "text" | "visual"
  const [creatorMode, setCreatorMode] = useState("text");

  // Server & Health Status
  const [serverStatus, setServerStatus] = useState("connecting"); // 'connected' | 'waking' | 'offline'
  const [serverInfo, setServerInfo] = useState({ modelName: "gemini-flash-lite-latest", version: "2.1.0" });
  const [globalNotice, setGlobalNotice] = useState(null);

  // Guide Modal State
  const [showGuideModal, setShowGuideModal] = useState(() => {
    if (typeof window === "undefined") return false;
    const rawHash = window.location.hash;
    const isNoHash = !rawHash || rawHash === "#" || rawHash === "#/";
    const isVerify = window.location.pathname.startsWith("/verify/") || rawHash.startsWith("#/verify/");
    return isNoHash && !isVerify;
  });

  const handleCloseGuideModal = () => {
    setShowGuideModal(false);
  };

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

  // Tone Profiles & Brand Terms State (Brand Manager)
  const [toneProfiles, setToneProfiles] = useState({
    "Social Media / Twitter": { maxExclamationMarks: 1, maxAllCapsWords: 0, maxCharacters: 280 },
    "Marketing Email": { maxExclamationMarks: 2, maxAllCapsWords: 2, maxCharacters: 0 },
    "Product Landing Page": { maxExclamationMarks: 2, maxAllCapsWords: 2, maxCharacters: 0 },
    "Ad Copy / Banner": { maxExclamationMarks: 1, maxAllCapsWords: 0, maxCharacters: 120 }
  });
  const [brandTermsText, setBrandTermsText] = useState("CampusPro");
  const [toneSettingsError, setToneSettingsError] = useState(null);
  const [isSavingToneSettings, setIsSavingToneSettings] = useState(false);

  // Brand Guideline Document Import (Brand Manager)
  const [guidelineInputTab, setGuidelineInputTab] = useState("paste"); // "paste" | "upload"
  const [guidelineText, setGuidelineText] = useState("");
  const [guidelineFileBase64, setGuidelineFileBase64] = useState(null);
  const [guidelineFileName, setGuidelineFileName] = useState("");
  const [isExtractingGuideline, setIsExtractingGuideline] = useState(false);
  const [guidelineError, setGuidelineError] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [blockedLines, setBlockedLines] = useState([]);
  const [droppedProposals, setDroppedProposals] = useState([]);
  const [lastImportStats, setLastImportStats] = useState(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [originalLength, setOriginalLength] = useState(0);
  const [showWhyDropped, setShowWhyDropped] = useState(false);
  const [editingProposalId, setEditingProposalId] = useState(null);
  const [editedProposalData, setEditedProposalData] = useState({});
  const [proposalEditError, setProposalEditError] = useState(null);
  const [savingProposalId, setSavingProposalId] = useState(null);
  const [hideDecidedItems, setHideDecidedItems] = useState(false);
  const [guidelineSourceName, setGuidelineSourceName] = useState("Pasted text");
  const [isProposalActionPending, setIsProposalActionPending] = useState(false);
  const guidelineFileInputRef = useRef(null);

  // Self-Healing Guideline Clarification (Brand Manager)
  const [clarificationRequests, setClarificationRequests] = useState([]);
  const [isLoadingClarificationDemo, setIsLoadingClarificationDemo] = useState(false);
  const [savingClarificationId, setSavingClarificationId] = useState(null);
  const [editingClarificationId, setEditingClarificationId] = useState(null);
  const [editingClarificationText, setEditingClarificationText] = useState("");
  const [editingClarificationError, setEditingClarificationError] = useState(null);
  const [recheckResults, setRecheckResults] = useState({});
  const [isRecheckingId, setIsRecheckingId] = useState(null);

  // Compare Channels State (Content Creator)
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareResults, setCompareResults] = useState(null);
  const [isComparingChannels, setIsComparingChannels] = useState(false);
  const [compareNotice, setCompareNotice] = useState(null);

  // Creator & Review State (Text)
  const [draftTitle, setDraftTitle] = useState("");
  const [draftChannel, setDraftChannel] = useState("Social Media / Twitter");
  const [draftContent, setDraftContent] = useState("");
  const [activeDraft, setActiveDraft] = useState(null);
  const [allDrafts, setAllDrafts] = useState([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [selectedFindingId, setSelectedFindingId] = useState(null);
  const [analyzingDraftTitle, setAnalyzingDraftTitle] = useState(null);
  const [selectedSampleDraftId, setSelectedSampleDraftId] = useState("");
  const [textReviewStages, setTextReviewStages] = useState({
    init: false,
    security: false,
    gemini_review: false,
    deterministic: false,
    validator: false
  });

  // Creator & Review State (Visual Audit)
  const [isVisualAuditing, setIsVisualAuditing] = useState(false);
  const [visualAuditError, setVisualAuditError] = useState(null);
  const [visualImagePreview, setVisualImagePreview] = useState(null);
  const [hoveredRegionIdx, setHoveredRegionIdx] = useState(null);
  const [editableAltText, setEditableAltText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [copiedItem, setCopiedItem] = useState(null);
  const fileInputRef = useRef(null);
  const [analyzingFilename, setAnalyzingFilename] = useState(null);
  const currentVisualReqIdRef = useRef(0);
  const currentVisualAbortControllerRef = useRef(null);
  const lastVisualAuditRef = useRef(null);
  const [auditStages, setAuditStages] = useState({
    upload: false,
    resize: false,
    gemini_ocr: false,
    palette: false,
    contrast: false,
    review: false,
    validator: false
  });

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
  const [showValidatorDetails, setShowValidatorDetails] = useState(false);

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

  // 1. Hash & Path Routing Sync
  useEffect(() => {
    const handleUrlChange = () => {
      const pathname = window.location.pathname;
      if (pathname.startsWith("/verify/")) {
        setVerifyCertId(pathname.replace("/verify/", "").trim());
        return;
      }
      const rawHash = window.location.hash;
      const hash = rawHash.replace(/^#\/?/, "");
      if (hash.startsWith("verify/")) {
        setVerifyCertId(hash.replace("verify/", "").trim());
        return;
      }
      setVerifyCertId(null);
      if (["manager", "creator", "reviewer", "insights"].includes(hash)) {
        setActiveRole(hash);
      } else if (!hash) {
        changeRole("manager");
      }
    };
    window.addEventListener("hashchange", handleUrlChange);
    window.addEventListener("popstate", handleUrlChange);
    const rawHash = window.location.hash;
    const isNoHash = !rawHash || rawHash === "#" || rawHash === "#/";
    if (isNoHash && !window.location.pathname.startsWith("/verify/")) {
      changeRole("manager");
      setShowGuideModal(true);
    }
    return () => {
      window.removeEventListener("hashchange", handleUrlChange);
      window.removeEventListener("popstate", handleUrlChange);
    };
  }, []);

  // 2. Initial Setup and Health Pings (wakes up sleeping Render instance)
  useEffect(() => {
    // Immediate health pings on page load to wake up sleeping Render instances before user uploads
    fetch("/health").catch(() => {});
    fetch("/api/health").catch(() => {});

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
          modelName: data.modelName || "gemini-flash-lite-latest",
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
      const [rulesRes, factsRes, samplesRes, draftsRes, insightsRes, visualRes, toneRes, guidelinesRes, clarificationsRes] = await Promise.all([
        wsFetch("/api/rules"),
        wsFetch("/api/facts"),
        wsFetch("/api/sample-drafts"),
        wsFetch("/api/drafts"),
        wsFetch("/api/insights"),
        wsFetch("/api/visual-settings"),
        wsFetch("/api/tone-settings"),
        wsFetch("/api/guidelines/proposals"),
        wsFetch("/api/clarifications")
      ]);

      if (rulesRes.ok) setRules(await rulesRes.json());
      if (factsRes.ok) setFacts(await factsRes.json());
      if (samplesRes.ok) setSampleDrafts(await samplesRes.json());
      if (draftsRes.ok) {
        const dList = await draftsRes.json();
        setAllDrafts(dList);
        if (dList.length > 0) {
          setActiveDraft((prev) => {
            const nextDraft = prev ? dList.find((d) => d.id === prev.id) || dList[0] : dList[0];
            if (nextDraft && nextDraft.isVisual) {
              setCreatorMode("visual");
            }
            return nextDraft;
          });
        } else {
          setActiveDraft(null);
        }
      }
      if (insightsRes.ok) setInsights(await insightsRes.json());
      if (visualRes && visualRes.ok) setVisualSettings(await visualRes.json());
      if (toneRes && toneRes.ok) {
        const toneData = await toneRes.json();
        if (toneData.toneProfiles) setToneProfiles(toneData.toneProfiles);
        if (Array.isArray(toneData.brandTerms)) setBrandTermsText(toneData.brandTerms.join(", "));
      }
      if (guidelinesRes && guidelinesRes.ok) {
        const gData = await guidelinesRes.json();
        setProposals(gData.proposals || []);
        if (gData.lastImport) {
          setLastImportStats(gData.lastImport.stats || null);
          setBlockedLines(gData.lastImport.blockedLines || []);
          setDroppedProposals(gData.lastImport.dropped || []);
          setIsTruncated(Boolean(gData.lastImport.truncated));
          setOriginalLength(gData.lastImport.originalLength || 0);
        }
      }
      if (clarificationsRes && clarificationsRes.ok) {
        const cData = await clarificationsRes.json();
        setClarificationRequests(cData.requests || []);
      }
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

  // Save Brand Tone Settings (T-03, T-05, T-06)
  const handleSaveToneSettings = async (e) => {
    if (e) e.preventDefault();
    setToneSettingsError(null);

    const standardChannels = [
      "Social Media / Twitter",
      "Marketing Email",
      "Product Landing Page",
      "Ad Copy / Banner"
    ];

    for (const ch of standardChannels) {
      const p = toneProfiles[ch];
      if (!p) {
        setToneSettingsError(`Missing settings for ${ch}.`);
        return;
      }
      const ex = Number(p.maxExclamationMarks);
      const caps = Number(p.maxAllCapsWords);
      const chars = Number(p.maxCharacters);

      if (
        p.maxExclamationMarks === "" || isNaN(ex) || !Number.isInteger(ex) || ex < 0 || ex > 1000 ||
        p.maxAllCapsWords === "" || isNaN(caps) || !Number.isInteger(caps) || caps < 0 || caps > 1000 ||
        p.maxCharacters === "" || isNaN(chars) || !Number.isInteger(chars) || chars < 0 || chars > 1000
      ) {
        setToneSettingsError(`Limits for "${ch}" must be whole numbers between 0 and 1000. Blank values are not permitted.`);
        return;
      }
    }

    const brandTerms = brandTermsText
      .split(/[,;\n]+/)
      .map(t => t.trim())
      .filter(Boolean);

    if (brandTerms.length === 0) {
      setToneSettingsError("Please provide at least one exempt brand term (e.g. CampusPro).");
      return;
    }

    setIsSavingToneSettings(true);
    try {
      const res = await wsFetch("/api/tone-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toneProfiles, brandTerms })
      });
      if (res.ok) {
        const data = await res.json();
        setToneProfiles(data.toneProfiles);
        setBrandTermsText(data.brandTerms.join(", "));
        showNotice("Tone profiles and brand terms saved successfully.");
      } else {
        const err = await res.json();
        setToneSettingsError(err.error || "Failed to save tone settings.");
      }
    } catch (e) {
      setToneSettingsError("Network error while saving tone settings.");
    } finally {
      setIsSavingToneSettings(false);
    }
  };

  // Reset Tone Settings to Defaults
  const handleResetToneSettings = async () => {
    setToneSettingsError(null);
    try {
      const res = await wsFetch("/api/tone-settings/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setToneProfiles(data.toneProfiles);
        setBrandTermsText(data.brandTerms.join(", "));
        showNotice("Tone profiles restored to default settings.");
      }
    } catch (e) {
      setToneSettingsError("Failed to reset tone settings.");
    }
  };

  // Compare Deterministic Tone Checks Across All 4 Channels
  const handleCompareChannels = async () => {
    if (!draftContent || !draftContent.trim()) {
      setCompareNotice("Please enter or select draft copy first to compare channel tone profiles.");
      setShowCompareModal(true);
      setCompareResults(null);
      return;
    }

    setCompareNotice(null);
    setIsComparingChannels(true);
    setShowCompareModal(true);

    try {
      const res = await wsFetch("/api/compare-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftText: draftContent.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setCompareResults(data.channels);
      } else {
        const err = await res.json();
        setCompareNotice(err.error || "Failed to compare channels.");
      }
    } catch (e) {
      setCompareNotice("Error connecting to server to compare channels.");
    } finally {
      setIsComparingChannels(false);
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

  // Run Visual Audit on uploaded image or sample banner (STALE STATE FIX: immediately clear previous results)
  const handleRunVisualAudit = async (base64Image, title = "Visual Banner Audit", channel = "Social / Display Banner", filename = null) => {
    // 1. Abort previous in-flight request
    currentVisualAbortControllerRef.current?.abort();
    const controller = new AbortController();
    currentVisualAbortControllerRef.current = controller;
    const reqId = ++currentVisualReqIdRef.current;

    const displayFilename = filename || title || "banner";
    lastVisualAuditRef.current = { base64Image, title, channel, filename: displayFilename };

    // 2. Immediately clear previous visual state
    setActiveDraft(null);
    setEditableAltText("");
    setSelectedFindingId(null);
    setHoveredRegionIdx(null);
    setVisualImagePreview(base64Image);
    setAnalyzingFilename(displayFilename);
    setIsVisualAuditing(true);
    setVisualAuditError(null);
    setAuditStages({
      upload: false,
      resize: false,
      gemini_ocr: false,
      palette: false,
      contrast: false,
      review: false,
      validator: false
    });

    try {
      const res = await wsFetch("/api/visual-review?stream=true", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-stream": "true" },
        signal: controller.signal,
        body: JSON.stringify({
          image: base64Image,
          draftTitle: title,
          channel: channel
        })
      });

      if (reqId !== currentVisualReqIdRef.current) return;

      if (res.status === 429) {
        const err = await res.json();
        throw new Error(err.error || "Rate limit reached (10 checks per minute). Please wait a moment.");
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to analyze image.");
      }

      let data = null;
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep last incomplete line

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "stage") {
                setAuditStages(prev => ({ ...prev, [msg.stage]: true }));
              } else if (msg.type === "complete") {
                data = msg.data;
              } else if (msg.type === "error") {
                throw new Error(msg.error);
              }
            } catch (err) {
              if (err.message && !err.message.includes("JSON")) {
                throw err;
              }
            }
          }
        }
      }

      if (!data) {
        data = await res.json();
      }

      if (reqId !== currentVisualReqIdRef.current) return;

      setActiveDraft(data.draft);
      setEditableAltText(data.alt_text || "");
      setAnalyzingFilename(null);
      await loadWorkspaceData();
      showNotice(`Visual audit completed in ${data.timings_ms?.total || 0}ms (${data.findings?.length || 0} findings flagged).`);
    } catch (err) {
      if (err.name === "AbortError" || reqId !== currentVisualReqIdRef.current) {
        return;
      }
      setVisualAuditError(err.message);
      setAnalyzingFilename(null);
    } finally {
      if (reqId === currentVisualReqIdRef.current) {
        setIsVisualAuditing(false);
      }
    }
  };

  const handleRetryVisualAudit = () => {
    if (lastVisualAuditRef.current) {
      const { base64Image, title, channel, filename } = lastVisualAuditRef.current;
      handleRunVisualAudit(base64Image, title, channel, filename);
    } else if (activeDraft?.imageUrl) {
      fetch(activeDraft.imageUrl)
        .then(r => r.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const b64 = reader.result.split(",")[1];
            handleRunVisualAudit(b64, activeDraft.title || "Visual Banner Audit", activeDraft.channel || "Social / Banner", "banner");
          };
          reader.readAsDataURL(blob);
        })
        .catch(console.error);
    }
  };

  // Load Sample Banner Preset (STALE STATE FIX: clear immediately)
  const handleLoadSampleBanner = async (sampleFileName, label) => {
    currentVisualAbortControllerRef.current?.abort();
    setCreatorMode("visual");
    setActiveDraft(null);
    setEditableAltText("");
    setSelectedFindingId(null);
    setVisualImagePreview(null);
    setAnalyzingFilename(sampleFileName);
    setIsVisualAuditing(true);
    setVisualAuditError(null);

    try {
      const response = await fetch(`/samples/${sampleFileName}`);
      if (!response.ok) throw new Error(`Could not load sample banner ${sampleFileName}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        handleRunVisualAudit(reader.result, label, "Social / Banner", sampleFileName);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      setIsVisualAuditing(false);
      setAnalyzingFilename(null);
      setVisualAuditError(e.message);
    }
  };

  // Handle Drag & Drop / File Upload (STALE STATE FIX: clear immediately)
  const handleImageFileUpload = (file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setVisualAuditError("Image exceeds 4 MB maximum size limit.");
      return;
    }
    currentVisualAbortControllerRef.current?.abort();
    setActiveDraft(null);
    setEditableAltText("");
    setSelectedFindingId(null);
    setVisualImagePreview(null);
    setAnalyzingFilename(file.name);
    setIsVisualAuditing(true);
    setVisualAuditError(null);

    const reader = new FileReader();
    reader.onloadend = () => {
      handleRunVisualAudit(reader.result, file.name.replace(/\.[^/.]+$/, ""), "Social / Display Banner", file.name);
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
        setGuidelineText("");
        setGuidelineFileBase64(null);
        setGuidelineFileName("");
        setGuidelineError(null);
        setProposals([]);
        setBlockedLines([]);
        setDroppedProposals([]);
        setLastImportStats(null);
        setIsTruncated(false);
        setEditingProposalId(null);
        setProposalEditError(null);
        setSavingProposalId(null);
        setHideDecidedItems(false);
        setGuidelineSourceName("Pasted text");
        setClarificationRequests([]);
        setIsLoadingClarificationDemo(false);
        setSavingClarificationId(null);
        setEditingClarificationId(null);
        setEditingClarificationText("");
        setEditingClarificationError(null);
        setRecheckResults({});
        setIsRecheckingId(null);
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
  const handleLoadDemoScenario = (shouldNavigate = true) => {
    const campusPro = sampleDrafts.find((s) => s.id === "sample-1") || {
      title: "CampusPro Launch Announcement",
      content: "Meet CampusPro, India's fastest laptop for students! Its battery lasts 3 days. Buy now!!"
    };
    setDraftTitle(campusPro.title);
    setDraftContent(campusPro.content);
    setReviewError(null);
    setSelectedSampleDraftId("");
    if (shouldNavigate !== false) {
      changeRole("creator");
    }
  };

  const handleSelectSample = (sample) => {
    setDraftTitle(sample.title);
    setDraftContent(sample.content);
    setReviewError(null);
    setSelectedSampleDraftId(sample.id);
  };

  // Submit Draft & Run AI Check
  const handleRunAiCheck = async () => {
    if (!draftContent.trim()) {
      alert("Please enter draft text to review.");
      return;
    }

    // Immediately clear previous draft and findings so old results do not persist
    setActiveDraft(null);
    setSelectedFindingId(null);
    setReviewError(null);
    setIsReviewing(true);
    setAnalyzingDraftTitle(draftTitle.trim() || "Untitled Campaign Draft");
    setTextReviewStages({
      init: true,
      security: false,
      gemini_review: false,
      deterministic: false,
      validator: false
    });

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

      setTextReviewStages(prev => ({ ...prev, init: true, security: true }));

      // 2. Call AI Review with Validator (supporting real-time stream stages)
      const reviewRes = await wsFetch("/api/review?stream=true", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-stream": "true" },
        body: JSON.stringify({
          draftId: newDraft.id,
          draftText: draftContent.trim(),
          channel: draftChannel
        })
      });

      if (reviewRes.status === 429) {
        const errData = await reviewRes.json();
        throw new Error(errData.error || "Rate limit reached (10 checks per minute). Please wait a moment.");
      }

      if (!reviewRes.ok && reviewRes.headers.get("content-type")?.includes("json")) {
        const errData = await reviewRes.json();
        throw new Error(errData.error || "The AI is busy, please try again in a minute.");
      }

      let reviewData = null;
      if (reviewRes.body && typeof reviewRes.body.getReader === "function") {
        const reader = reviewRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "stage") {
                setTextReviewStages(prev => ({ ...prev, [msg.stage]: true }));
              } else if (msg.type === "complete") {
                reviewData = msg.data;
              } else if (msg.type === "error") {
                throw new Error(msg.error);
              }
            } catch (err) {
              if (err.message && !err.message.includes("JSON")) {
                throw err;
              }
            }
          }
        }
      }

      if (!reviewData) {
        reviewData = await reviewRes.json();
      }

      setTextReviewStages({
        init: true,
        security: true,
        gemini_review: true,
        deterministic: true,
        validator: true
      });

      setActiveDraft(reviewData.updatedDraft || newDraft);
      setAnalyzingDraftTitle(null);
      await loadWorkspaceData();
    } catch (err) {
      setReviewError(err.message);
      setAnalyzingDraftTitle(null);
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
        if (decision === "approve") {
          setViewingCertificateDraft(updated);
          showNotice(`Draft approved for publication! Tamper-evident compliance certificate generated (${updated.certificate?.certificateId || ""}).`);
        } else {
          showNotice("Revisions requested. Returned to creator queue.");
        }
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

  // Helper: Format extraction time
  const formatExtractionTime = (isoString) => {
    if (!isoString) return "Just now";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "Recent";
    }
  };

  // Manager: Guideline Import & Proposals Handlers
  const handleTrySampleGuideline = async () => {
    setGuidelineError(null);
    try {
      const res = await wsFetch("/api/guidelines/sample");
      if (res.ok) {
        const data = await res.json();
        setGuidelineText(data.text);
        setGuidelineInputTab("paste");
        setGuidelineSourceName("Sample guideline");
        showNotice("Loaded sample brand guideline for CampusPro (~12 sentences).");
      } else {
        const err = await res.json();
        setGuidelineError(err.error || "Failed to load sample guideline.");
      }
    } catch (e) {
      setGuidelineError("Network error loading sample guideline.");
    }
  };

  const handleGuidelineFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGuidelineError(null);

    // Enforce 2 MB limit
    if (file.size > 2 * 1024 * 1024) {
      setGuidelineError(`File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds 2 MB limit.`);
      if (guidelineFileInputRef.current) guidelineFileInputRef.current.value = "";
      return;
    }

    const ext = file.name.split(".").pop().toLowerCase();
    const validExtension = ["txt", "md", "docx", "pdf"].includes(ext);
    if (!validExtension) {
      setGuidelineError("Unsupported file. Please upload .txt, .md, .docx or a text-based .pdf.");
      if (guidelineFileInputRef.current) guidelineFileInputRef.current.value = "";
      return;
    }

    // Inspect real content (magic bytes) to catch renamed images/binaries
    const checkReader = new FileReader();
    checkReader.onload = (loadEvent) => {
      const buffer = new Uint8Array(loadEvent.target.result);

      // Known image / binary headers
      const isPng = buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isJpg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isGif = buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
      const isExe = buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a;
      const isRiff = buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;

      const isPdf = buffer.length >= 5 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d;
      const isDocx = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;

      let hasBinaryBytes = false;
      const checkLen = Math.min(buffer.length, 512);
      for (let i = 0; i < checkLen; i++) {
        const b = buffer[i];
        if (b === 0x00 || (b < 0x09) || b === 0x0b || b === 0x0c || (b >= 0x0e && b <= 0x1f)) {
          hasBinaryBytes = true;
          break;
        }
      }

      if (isPng || isJpg || isGif || isExe || isRiff || (!isPdf && !isDocx && hasBinaryBytes)) {
        setGuidelineError("Unsupported file. Please upload .txt, .md, .docx or a text-based .pdf.");
        setGuidelineFileBase64(null);
        setGuidelineFileName("");
        if (guidelineFileInputRef.current) guidelineFileInputRef.current.value = "";
        return;
      }

      // Valid - read file as DataURL for API transfer
      const dataUrlReader = new FileReader();
      dataUrlReader.onload = (dataUrlEvent) => {
        setGuidelineFileBase64(dataUrlEvent.target.result);
        setGuidelineFileName(file.name);
        setGuidelineSourceName(file.name);
      };
      dataUrlReader.readAsDataURL(file);
    };
    checkReader.readAsArrayBuffer(file.slice(0, 1024));
  };

  const handleExtractProposals = async () => {
    setGuidelineError(null);
    if (guidelineInputTab === "paste" && !guidelineText.trim()) {
      setGuidelineError("Please enter or paste guideline text, or click 'Try sample guideline'.");
      return;
    }
    if (guidelineInputTab === "upload" && !guidelineFileBase64) {
      setGuidelineError("Please select a guideline document (.txt, .md, .docx, or .pdf).");
      return;
    }

    setIsExtractingGuideline(true);
    try {
      const effectiveSource =
        guidelineInputTab === "upload"
          ? (guidelineFileName || "Uploaded document")
          : (guidelineSourceName === "Sample guideline" ? "Sample guideline" : "Pasted text");

      const payload = {
        text: guidelineInputTab === "paste" ? guidelineText : undefined,
        fileBase64: guidelineInputTab === "upload" ? guidelineFileBase64 : undefined,
        fileName: guidelineInputTab === "upload" ? guidelineFileName : undefined,
        sourceName: effectiveSource
      };

      const res = await wsFetch("/api/guidelines/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setProposals(data.proposals || []);
        setLastImportStats(data.stats || null);
        setBlockedLines(data.blockedLines || []);
        setDroppedProposals(data.dropped || []);
        setIsTruncated(Boolean(data.truncated));
        setOriginalLength(data.originalLength || 0);
        await loadWorkspaceData();
        if (data.stats.kept === 0 && data.stats.dropped === 0 && data.stats.blocked === 0) {
          showNotice("No brand rules or facts were found in this file.");
        } else {
          showNotice(`Extracted: ${data.stats.kept} proposals kept, ${data.stats.dropped} dropped, ${data.stats.blocked} blocked.`);
        }
      } else {
        setGuidelineError(data.error || "Failed to extract proposals from guideline.");
      }
    } catch (e) {
      setGuidelineError(`Network error during guideline extraction: ${e.message}`);
    } finally {
      setIsExtractingGuideline(false);
    }
  };

  const handleProposalDecision = async (proposalId, action, editedData = null) => {
    if (savingProposalId) return;

    if (action === "edit_and_approve") {
      const textVal = editedData?.text !== undefined ? editedData.text : "";
      const trimmed = textVal.trim();
      if (!trimmed || trimmed.length < 5) {
        setProposalEditError("Rule text can't be empty");
        return;
      }
      if (textVal.length > 500) {
        setProposalEditError("Rule text cannot exceed 500 characters.");
        return;
      }
    }

    setSavingProposalId(proposalId);
    setProposalEditError(null);

    try {
      const res = await wsFetch(`/api/guidelines/proposals/${proposalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, editedData })
      });
      const data = await res.json();
      if (res.ok) {
        setProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? { ...p, ...data.proposal } : p))
        );
        if (data.rules) setRules(data.rules);
        if (data.facts) setFacts(data.facts);
        setEditingProposalId(null);
        setEditedProposalData({});
        await loadWorkspaceData();
        if (action === "approve" || action === "edit_and_approve") {
          showNotice(`Approved proposal into library as ${data.createdItem?.id || data.proposal?.approvedId}.`);
        } else {
          showNotice("Proposal rejected.");
        }
      } else {
        if (action === "edit_and_approve") {
          setProposalEditError(data.error || "Rule text can't be empty");
        } else {
          alert(data.error || "Failed to record proposal decision.");
        }
      }
    } catch (e) {
      alert(`Network error: ${e.message}`);
    } finally {
      setSavingProposalId(null);
    }
  };

  const handleUndoProposal = async (proposalId) => {
    if (savingProposalId) return;
    setSavingProposalId(proposalId);
    try {
      const res = await wsFetch(`/api/guidelines/proposals/${proposalId}/undo`, {
        method: "POST"
      });
      const data = await res.json();
      if (res.ok) {
        setProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? { ...p, ...data.proposal } : p))
        );
        if (data.rules) setRules(data.rules);
        if (data.facts) setFacts(data.facts);
        await loadWorkspaceData();
        showNotice(data.message || "Approval undone. Rule/fact removed from library.");
      } else {
        alert(data.error || "Failed to undo approval.");
      }
    } catch (e) {
      alert(`Network error: ${e.message}`);
    } finally {
      setSavingProposalId(null);
    }
  };

  const handleClearProposals = async () => {
    if (!window.confirm("Clear all proposals from the review queue? (Active library rules and facts will remain intact)")) return;
    try {
      const res = await wsFetch("/api/guidelines/proposals", { method: "DELETE" });
      if (res.ok) {
        setProposals([]);
        setLastImportStats(null);
        setBlockedLines([]);
        setDroppedProposals([]);
        setIsTruncated(false);
        showNotice("Review queue cleared.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Self-Healing Guideline Clarification Handlers (Round 3, Improvement 2)
  const handleLoadClarificationDemo = async () => {
    setIsLoadingClarificationDemo(true);
    try {
      const res = await wsFetch("/api/clarifications/demo", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setClarificationRequests(data.requests || []);
        await loadWorkspaceData();
        showNotice("Clarification demo loaded (5 flags, 3 disputes for R-07, 1 stored draft).");
      } else {
        showNotice(`Error loading demo: ${data.error || "Failed"}`);
      }
    } catch (err) {
      showNotice(`Error loading clarification demo: ${err.message}`);
    } finally {
      setIsLoadingClarificationDemo(false);
    }
  };

  const handleClarificationDecide = async (requestId, action, wording = null, ruleId = null) => {
    if (savingClarificationId) return;

    if (action === "edit_and_apply" || action === "apply") {
      const trimmed = (wording || "").trim();
      if (!trimmed || trimmed.length < 5) {
        setEditingClarificationError("Rule text can't be empty");
        return;
      }
      if (trimmed.length > 500) {
        setEditingClarificationError("Rule text exceeds maximum length of 500 characters.");
        return;
      }
    }

    setSavingClarificationId(requestId);
    setEditingClarificationError(null);

    try {
      const res = await wsFetch(`/api/clarifications/${requestId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, wording, ruleId })
      });
      const data = await res.json();
      if (res.ok) {
        setEditingClarificationId(null);
        setEditingClarificationText("");
        setEditingClarificationError(null);
        await loadWorkspaceData();

        if (action === "apply" || action === "edit_and_apply") {
          const targetRuleId = ruleId || data.rule?.id || "R-xx";
          const newVer = data.version || data.rule?.version || 2;
          showNotice(`Rule ${targetRuleId} updated (v${newVer})`);
        } else if (action === "dismiss") {
          showNotice("Clarification dismissed (rule kept as is).");
        }
      } else {
        if (action === "edit_and_apply") {
          setEditingClarificationError(data.error || "Rule text can't be empty");
        } else {
          showNotice(data.error || "Failed to update clarification.");
        }
      }
    } catch (err) {
      if (action === "edit_and_apply") {
        setEditingClarificationError(`Network error: ${err.message}`);
      } else {
        showNotice(`Network error: ${err.message}`);
      }
    } finally {
      setSavingClarificationId(null);
    }
  };

  const handleRecheckClarification = async (requestId, ruleId) => {
    setIsRecheckingId(requestId);
    try {
      const res = await wsFetch(`/api/clarifications/${requestId}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId })
      });
      const data = await res.json();
      if (res.ok) {
        setRecheckResults(prev => ({ ...prev, [requestId]: data }));
        showNotice(data.message || "Re-check completed.");
      } else {
        showNotice(`Re-check failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      showNotice(`Re-check error: ${err.message}`);
    } finally {
      setIsRecheckingId(null);
    }
  };

  // Render Highlighted Draft Text (Left Pane in Creator View)
  const renderHighlightedText = (text, findings = []) => {
    if (!text || typeof text !== "string") {
      return <span className="text-slate-400 italic">No text extracted from banner</span>;
    }

    if (!Array.isArray(findings) || findings.length === 0) {
      return <span className="text-slate-800 whitespace-pre-wrap">{text}</span>;
    }

    const matches = [];
    for (const f of findings) {
      if (!f || !f.quote || typeof f.quote !== "string") continue;
      const cleanQuote = f.quote.trim();
      if (!cleanQuote || cleanQuote.startsWith("(") || cleanQuote.startsWith("[")) continue;

      const idx = text.indexOf(cleanQuote);
      if (idx !== -1) {
        matches.push({ start: idx, end: idx + cleanQuote.length, finding: f, matchedQuote: cleanQuote });
      }
    }

    if (matches.length === 0) {
      return <span className="text-slate-800 whitespace-pre-wrap">{text}</span>;
    }

    matches.sort((a, b) => a.start - b.start);

    let result = [];
    let currentIndex = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (match.start < currentIndex) {
        continue;
      }

      if (match.start > currentIndex) {
        result.push(
          <span key={`txt-${currentIndex}`}>{text.substring(currentIndex, match.start)}</span>
        );
      }

      const f = match.finding;
      const isSelected = selectedFindingId === f.id;

      // Color coding: Red = High, Amber = Medium, Yellow = Low, Violet = Fact
      let highlightClass = "highlight-high";
      if (f.category === "fact" || (f.rule_id && f.rule_id.startsWith("F-"))) highlightClass = "highlight-fact";
      else if (f.severity === "medium") highlightClass = "highlight-medium";
      else if (f.severity === "low") highlightClass = "highlight-low";

      // If already accepted/rejected, visually strike through or tint
      const isDecided = f.status && f.status !== "pending";

      result.push(
        <mark
          key={f.id || `mark-${i}`}
          className={`${highlightClass} ${isSelected ? "ring-2 ring-blue-600 font-bold" : ""} ${
            isDecided ? "opacity-60" : ""
          }`}
          onClick={() => setSelectedFindingId(f.id)}
          title={`Click to inspect [${f.rule_id}]: ${f.explanation || ""}`}
        >
          {match.matchedQuote}
          <span className="text-[10px] ml-1 px-1 py-0.2 bg-black/10 rounded font-mono">
            {f.rule_id}
          </span>
        </mark>
      );

      currentIndex = match.end;
    }

    if (currentIndex < text.length) {
      result.push(<span key={`txt-end`}>{text.substring(currentIndex)}</span>);
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
    try {
      const rgb1 = getRgbFromHex(hex1);
      const rgb2 = getRgbFromHex(hex2);
      const l1 = getLuminance(...rgb1);
      const l2 = getLuminance(...rgb2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
    } catch {
      return null;
    }
  };

  // Helper: Render Audited Banner Image with Interactive Bounding Boxes
  const renderBannerImageWithBoxes = (draft, preview) => {
    const imgSrc = preview || draft?.imageUrl || draft?.imagePath;

    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-slate-950 flex items-center justify-center p-2 border border-slate-200">
        <div className="relative inline-block max-w-full">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={draft?.altText || "Audited banner"}
              className="max-h-[440px] w-auto max-w-full object-contain rounded-lg block"
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
              Banner image not available
            </div>
          )}

          {/* Bounding box overlays (hidden while isVisualAuditing) */}
          {!isVisualAuditing && Array.isArray(draft?.regions) && draft.regions.map((reg, idx) => {
            if (!reg) return null;
            const isHovered = hoveredRegionIdx === idx;
            const measuredRatio = reg.contrastRatio || (reg.fgColor && reg.bgColor ? calcContrast(reg.fgColor, reg.bgColor) : null);
            const regText = typeof reg.text === "string" ? reg.text : "";
            const isFindingSelected =
              selectedFindingId &&
              Array.isArray(draft.findings) &&
              draft.findings.some(
                (f) =>
                  f && f.id === selectedFindingId &&
                  ((f.quote && regText && f.quote.toLowerCase().includes(regText.toLowerCase())) ||
                    (f.explanation && regText && f.explanation.includes(regText)))
              );
            const isApprox = reg.isApproximate || reg.calculationType === "approximate";
            const hasContrastFail = !isApprox && (reg.passesContrast === false || (measuredRatio !== null && measuredRatio < (visualSettings?.minContrastRatio || 4.5)));

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
                    : isApprox
                    ? "border-amber-400 bg-amber-400/20 z-10"
                    : hasContrastFail
                    ? "border-red-500 bg-red-500/20 z-10"
                    : "border-emerald-400 bg-emerald-400/10 z-10"
                }`}
                title={`Region #${idx + 1}: "${regText}" (${isApprox ? '~' + measuredRatio + ':1 (approximate)' : measuredRatio ? measuredRatio + ':1' : 'could not measure'})`}
              >
                <span
                  className={`absolute -top-4 left-0 text-[9px] font-bold px-1 rounded font-mono shadow-xs ${
                    isApprox
                      ? "bg-amber-600 text-white"
                      : hasContrastFail ? "bg-red-600 text-white" : "bg-emerald-700 text-white"
                  }`}
                >
                  #{idx + 1} {measuredRatio ? `${isApprox ? '~' : ''}${measuredRatio}:1` : ""}
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
    const paletteCheck = draft.paletteSummary || draft.paletteCheck;
    const offColors = paletteCheck?.dominantOffColors || paletteCheck?.top_off_palette_hex || [];
    const onPct = paletteCheck?.on_palette_percentage ?? paletteCheck?.onPalettePercentage ?? 0;

    const isDraftOcrFailed = Boolean(
      draft?.isVisual && (
        draft?.ocrFailed ||
        draft?.ocr_failed ||
        draft?.originalText === "Text extraction failed. Please try again" ||
        draft?.originalText === "Text could not be read, please retry" ||
        draft?.extractedText === "Text extraction failed. Please try again" ||
        draft?.extractedText === "Text could not be read, please retry"
      )
    );

    const isDraftZeroLines = Boolean(
      draft?.isVisual && !isDraftOcrFailed && (
        draft?.hasZeroLines ||
        draft?.has_zero_lines ||
        draft?.originalText === "No text found in this image" ||
        draft?.extractedText === "No text found in this image" ||
        (Array.isArray(draft?.regions) && draft.regions.length === 0 && (!draft?.originalText || draft?.originalText.trim() === ""))
      )
    );

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
            {paletteCheck?.measured !== false && (paletteCheck?.on_palette_percentage !== undefined || paletteCheck?.onPalettePercentage !== undefined) ? (
              paletteCheck.flagged || paletteCheck.status === "non_compliant" || paletteCheck.status === "flagged" ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-red-600" /> ✕ Non-compliant ({onPct}% on-palette)
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  ✓ Compliant ({onPct}% on-palette)
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
            {(visualSettings?.palette || []).map((hex) => (
              <span key={hex} className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded">
                <span className="w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: hex }} />
                {hex}
              </span>
            ))}
          </div>

          {/* If off-palette flagged, show dominant 3 off colors */}
          {paletteCheck?.flagged && offColors.length > 0 && (
            <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs space-y-1.5">
              <span className="text-amber-900 font-bold block">
                3 Most Common Off-Palette Colours:
              </span>
              <div className="flex flex-wrap gap-2">
                {offColors.map((offHex, idx) => (
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
              Min Target: {visualSettings?.minContrastRatio || 4.5}:1
            </span>
          </div>

          {isDraftOcrFailed ? (
            <p className="text-xs text-slate-400 italic">Contrast not checked</p>
          ) : (!Array.isArray(draft.regions) || draft.regions.length === 0) ? (
            <p className="text-xs text-slate-400 italic">
              {isDraftZeroLines ? "No text found in this image" : "No text regions detected in image."}
            </p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {draft.regions.map((reg, idx) => {
                if (!reg) return null;
                const measuredRatio = reg.contrastRatio || (reg.fgColor && reg.bgColor ? calcContrast(reg.fgColor, reg.bgColor) : null);
                const isApprox = reg.isApproximate || reg.calculationType === "approximate";
                const calcType = reg.calculationType || (isApprox ? "approximate" : measuredRatio ? "computed" : "estimated");
                const isPassed = !isApprox && (measuredRatio !== null ? measuredRatio >= (visualSettings?.minContrastRatio || 4.5) : false);
                const isHovered = hoveredRegionIdx === idx;
                const regText = typeof reg.text === "string" ? reg.text : "";

                return (
                  <div
                    key={idx}
                    onMouseEnter={() => setHoveredRegionIdx(idx)}
                    onMouseLeave={() => setHoveredRegionIdx(null)}
                    className={`p-2.5 rounded-xl border text-xs transition-all ${
                      isHovered
                        ? "border-blue-500 bg-blue-50/50"
                        : isApprox
                        ? "border-amber-200 bg-amber-50/40"
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
                        <span className="truncate max-w-[200px]">"{regText}"</span>
                      </span>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {isApprox ? "[approximate]" : calcType === "computed" ? "[computed]" : "[estimated]"}
                        </span>
                        {measuredRatio ? (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isApprox
                                ? "bg-amber-100 text-amber-800 font-bold"
                                : isPassed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800 font-extrabold"
                            }`}
                          >
                            {isApprox
                              ? `~${measuredRatio}:1 Approximate`
                              : `${measuredRatio}:1 ${isPassed ? "✓ Pass" : "✕ Fail"}`}
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
    if (!draft || !Array.isArray(draft.findings)) return null;
    const copyFindings = draft.findings.filter(
      (f) => f && f.suggested_fix && f.rule_id !== "SEC-01" && f.source !== "security" && !["V-01", "V-02", "V-03"].includes(f.rule_id) && f.source !== "contrast" && f.source !== "palette" && f.source !== "alt_text"
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
            const designerLine = `Change "${f.quote || ""}" to "${f.suggested_fix || ""}"`;
            const isCopied = copiedItem === `copy-${f.id || i}`;

            return (
              <div
                key={f.id || i}
                className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="font-mono text-slate-800 leading-snug">
                  <span className="text-red-700 font-bold line-through mr-1">"{f.quote || ""}"</span>
                  <span className="text-slate-400 font-sans mr-1">&rarr;</span>
                  <span className="text-emerald-700 font-bold">"{f.suggested_fix || ""}"</span>
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

        {/* Word-Level Redline Diff for Visual Banner Copy */}
        {Boolean(draft.originalText && draft.currentText) && (
          <div className="pt-2 border-t border-slate-100">
            <RedlineDiff
              originalText={draft.originalText}
              finalText={draft.currentText}
              findings={draft.findings}
              title="Redline Copy Diff for Designer"
              defaultMode="inline"
              showToggle={true}
            />
          </div>
        )}
      </div>
    );
  };

  // Helper: Render Design Fixes (Visual contrast & colour fixes)
  const renderDesignFixesList = (draft) => {
    if (!draft || !Array.isArray(draft.findings)) return null;
    const designFindings = draft.findings.filter(
      (f) => f && (["V-01", "V-02"].includes(f.rule_id) || f.source === "contrast" || f.source === "palette")
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
              ? `Change text colour on "${f.quote || "text"}" to meet 4.5:1 minimum contrast ratio.`
              : `Adjust background or accents to adhere to approved brand palette colours (${(visualSettings?.palette || []).join(", ")}).`;
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

  if (verifyCertId) {
    return (
      <PublicVerifyPage
        certificateId={verifyCertId}
        onBack={() => {
          setVerifyCertId(null);
          window.history.pushState(null, "", "/#/manager");
        }}
      />
    );
  }

  const isOcrFailed = Boolean(
    activeDraft?.isVisual && (
      activeDraft?.ocrFailed ||
      activeDraft?.ocr_failed ||
      activeDraft?.originalText === "Text extraction failed. Please try again" ||
      activeDraft?.originalText === "Text could not be read, please retry" ||
      activeDraft?.extractedText === "Text extraction failed. Please try again" ||
      activeDraft?.extractedText === "Text could not be read, please retry"
    )
  );

  const hasZeroLines = Boolean(
    activeDraft?.isVisual && !isOcrFailed && (
      activeDraft?.hasZeroLines ||
      activeDraft?.has_zero_lines ||
      activeDraft?.originalText === "No text found in this image" ||
      activeDraft?.extractedText === "No text found in this image" ||
      (Array.isArray(activeDraft?.regions) && activeDraft.regions.length === 0 && (!activeDraft?.originalText || activeDraft?.originalText.trim() === ""))
    )
  );

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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                    Rules in library: {rules.length} ({rules.filter(r => r.source).length} imported)
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200">
                    Facts in library: {facts.length} ({facts.filter(f => f.source).length} imported)
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoadClarificationDemo}
                  disabled={isLoadingClarificationDemo}
                  className="px-3.5 py-2 rounded-xl bg-purple-50 border border-purple-200 hover:bg-purple-100 text-purple-700 text-xs font-bold transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-2xs disabled:opacity-50"
                  title="Seed dispute history for R-07 (5 flags, 3 disputes) and 1 stored draft to test clarification in < 1 minute"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  {isLoadingClarificationDemo ? "Loading demo..." : "Load clarification demo"}
                </button>
                <button
                  type="button"
                  onClick={handleLoadDemoScenario}
                  className="px-3.5 py-2 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 text-xs font-bold transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Load Demo Scenario
                </button>
              </div>
            </div>

            {/* IMPORT BRAND GUIDELINES (AI PROPOSALS & HUMAN REVIEW QUEUE) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-blue-600" />
                    <h2 className="font-bold text-slate-900 text-base">Import Brand Guidelines</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
                      AI Proposals & Human Review Queue
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Upload or paste brand documents (.pdf, .docx, .txt, .md). Proposals require brand manager approval before entering the library.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTrySampleGuideline}
                    className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                    title="Load fictional CampusPro guideline with 2 rules, 2 facts, 1 duplicate, and 1 adversarial injection test line"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    Try sample guideline
                  </button>
                  {proposals.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearProposals}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs font-medium transition-all"
                    >
                      Clear Queue
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                {/* Input Mode Selector */}
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <button
                    type="button"
                    onClick={() => { setGuidelineInputTab("paste"); setGuidelineError(null); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      guidelineInputTab === "paste"
                        ? "bg-blue-600 text-white shadow-2xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    Paste Guideline Text
                  </button>
                  <button
                    type="button"
                    onClick={() => { setGuidelineInputTab("upload"); setGuidelineError(null); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      guidelineInputTab === "upload"
                        ? "bg-blue-600 text-white shadow-2xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    Upload File (.txt, .md, .docx, .pdf)
                  </button>
                </div>

                {/* Paste Tab */}
                {guidelineInputTab === "paste" && (
                  <div>
                    <textarea
                      rows={5}
                      value={guidelineText}
                      onChange={(e) => setGuidelineText(e.target.value)}
                      placeholder="Paste brand guideline statements, policy specifications, or approved facts here... or click 'Try sample guideline' above."
                      className="w-full p-3 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-slate-800"
                    />
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                      <span>Characters: {guidelineText.length} / 15,000 max (excess characters automatically truncated)</span>
                      {guidelineText.length > 15000 && (
                        <span className="text-amber-600 font-medium">Text will be truncated to first 15,000 characters</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Upload Tab */}
                {guidelineInputTab === "upload" && (
                  <div>
                    <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl p-6 text-center transition-colors bg-slate-50/50">
                      <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs font-bold text-slate-700">
                        {guidelineFileName ? guidelineFileName : "Choose a guideline document"}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Supports text-based .pdf, .docx, .txt, .md (max 2 MB)
                      </p>
                      <input
                        ref={guidelineFileInputRef}
                        type="file"
                        accept=".txt,.md,.docx,.pdf"
                        onChange={handleGuidelineFileChange}
                        className="hidden"
                        id="guideline-file-upload"
                      />
                      <label
                        htmlFor="guideline-file-upload"
                        className="mt-3 inline-block px-4 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer shadow-2xs"
                      >
                        {guidelineFileName ? "Change File" : "Select File from Computer"}
                      </label>
                    </div>
                  </div>
                )}

                {/* Error display with Retry */}
                {guidelineError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                      <span>{guidelineError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleExtractProposals}
                      className="px-2.5 py-1 rounded bg-red-100 hover:bg-red-200 text-red-800 text-[11px] font-bold"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Truncation Notice */}
                {isTruncated && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                    <Info className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      <strong>Document Truncated:</strong> The document exceeded the 15,000 character limit ({originalLength.toLocaleString()} characters) and was truncated to the first 15,000 characters.
                    </span>
                  </div>
                )}

                {/* Extract CTA Button */}
                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    disabled={isExtractingGuideline || (guidelineInputTab === "paste" ? !guidelineText.trim() : !guidelineFileBase64)}
                    onClick={handleExtractProposals}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {isExtractingGuideline ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Analyzing Guidelines & Extracting Proposals...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Extract Rules & Facts
                      </>
                    )}
                  </button>
                </div>

                {/* Stats Strip */}
                {lastImportStats && (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                    {lastImportStats.kept === 0 && lastImportStats.dropped === 0 && lastImportStats.blocked === 0 ? (
                      <div className="flex items-center gap-2 text-slate-700 font-medium">
                        <Info className="w-4 h-4 text-slate-500 shrink-0" />
                        <span>No brand rules or facts were found in this file.</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-800">Extraction Results:</span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800">
                          {lastImportStats.kept} Kept
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowWhyDropped(!showWhyDropped)}
                          className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors flex items-center gap-1"
                        >
                          {lastImportStats.dropped} Dropped
                          <ChevronDown className={`w-3 h-3 transition-transform ${showWhyDropped ? "rotate-180" : ""}`} />
                        </button>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                          {lastImportStats.blocked} Blocked
                        </span>
                      </div>
                    )}
                    <span className="text-[11px] text-slate-500 font-medium">
                      Source: {lastImportStats.sourceName || guidelineFileName || (proposals.length > 0 ? proposals[0]?.sourceName : null) || (guidelineInputTab === "paste" ? "Pasted text" : "Uploaded file")}
                    </span>
                  </div>
                )}

                {/* Blocked Lines Panel (SEC-01) */}
                {blockedLines.length > 0 && (
                  <div className="p-4 bg-red-50/80 border border-red-200 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-red-800">
                      <Shield className="w-4 h-4 text-red-600" />
                      <span>Blocked Lines ({blockedLines.length}) — SEC-01 Adversarial Prompt Injection Defense</span>
                    </div>
                    <p className="text-[11px] text-red-700">
                      The following instruction-like lines were detected by the deterministic security scanner. They were blocked and prevented from becoming library rules:
                    </p>
                    <div className="space-y-1.5 pt-1">
                      {blockedLines.map((b, idx) => (
                        <div key={idx} className="p-2 bg-white rounded-lg border border-red-200 text-xs font-mono text-red-800 flex items-center justify-between">
                          <span>"{b.line}"</span>
                          <span className="text-[10px] uppercase font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                            Blocked: {b.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Why Dropped Collapsible Panel */}
                {showWhyDropped && droppedProposals.length > 0 && (
                  <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                        <Info className="w-4 h-4 text-amber-700" />
                        <span>Why Dropped? ({droppedProposals.length} proposals rejected by code-based validator)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowWhyDropped(false)}
                        className="text-xs text-amber-800 hover:text-amber-950 font-bold"
                      >
                        Close
                      </button>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {droppedProposals.map((d, idx) => (
                        <div key={idx} className="p-2 bg-white rounded-lg border border-amber-200 text-xs text-slate-800">
                          <span className="font-bold text-slate-900">{d.title}: </span>
                          <span className="text-amber-800 font-medium">{d.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review Queue Cards */}
                {proposals.length > 0 && (
                  <div className="pt-2 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
                      <div>
                        <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                          Human Review Queue ({proposals.filter(p => p.status === "pending").length} Pending Review)
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Rules and facts enter the library ONLY when explicitly approved by a person.
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={hideDecidedItems}
                            onChange={(e) => setHideDecidedItems(e.target.checked)}
                            className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span>Hide decided items</span>
                        </label>
                        <button
                          type="button"
                          onClick={handleClearProposals}
                          className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 font-medium transition-all"
                        >
                          Clear Queue
                        </button>
                      </div>
                    </div>

                    {(() => {
                      const visibleProposals = hideDecidedItems
                        ? proposals.filter((p) => p.status === "pending")
                        : proposals;

                      if (visibleProposals.length === 0) {
                        return (
                          <div className="p-6 bg-slate-50 rounded-xl text-center text-xs text-slate-500 border border-dashed border-slate-200">
                            {hideDecidedItems
                              ? "No pending proposals. All items have been decided."
                              : "No proposals in queue."}
                          </div>
                        );
                      }

                      // Group by sourceName
                      const sourceGroups = [];
                      const groupMap = new Map();

                      for (const p of visibleProposals) {
                        const src = p.sourceName || "Pasted text";
                        if (!groupMap.has(src)) {
                          const newGroup = {
                            sourceName: src,
                            latestTime: p.importedAt || p.createdAt || "",
                            items: []
                          };
                          groupMap.set(src, newGroup);
                          sourceGroups.push(newGroup);
                        }
                        const group = groupMap.get(src);
                        group.items.push(p);
                        const itemTime = p.importedAt || p.createdAt || "";
                        if (itemTime && (!group.latestTime || new Date(itemTime) > new Date(group.latestTime))) {
                          group.latestTime = itemTime;
                        }
                      }

                      // Sort groups: newest first
                      sourceGroups.sort((a, b) => {
                        const timeA = a.latestTime ? new Date(a.latestTime).getTime() : 0;
                        const timeB = b.latestTime ? new Date(b.latestTime).getTime() : 0;
                        return timeB - timeA;
                      });

                      // Within each group, pending items on top
                      for (const group of sourceGroups) {
                        group.items.sort((a, b) => {
                          if (a.status === "pending" && b.status !== "pending") return -1;
                          if (a.status !== "pending" && b.status === "pending") return 1;
                          return 0;
                        });
                      }

                      return (
                        <div className="space-y-6">
                          {sourceGroups.map((group) => (
                            <div key={group.sourceName} className="space-y-3">
                              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                                  <h4 className="text-xs font-bold text-slate-800">
                                    Source: {group.sourceName}
                                  </h4>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                    {group.items.length} {group.items.length === 1 ? "item" : "items"}
                                    {group.items.filter(i => i.status === "pending").length > 0 &&
                                      ` (${group.items.filter(i => i.status === "pending").length} pending)`}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-400">
                                  Latest: {formatExtractionTime(group.latestTime)}
                                </span>
                              </div>

                              <div className="space-y-3">
                                {group.items.map((proposal) => {
                                  const isEditing = editingProposalId === proposal.id;
                                  const isSavingThis = savingProposalId === proposal.id;

                                  return (
                                    <div
                                      key={proposal.id}
                                      className={`p-4 rounded-xl border transition-all ${
                                        proposal.status === "approved"
                                          ? "bg-green-50/40 border-green-200"
                                          : proposal.status === "rejected"
                                          ? "bg-slate-50 border-slate-200 opacity-70"
                                          : "bg-white border-slate-200 shadow-2xs hover:border-blue-300"
                                      }`}
                                    >
                                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                        <div className="space-y-2 flex-1">
                                          {/* Source & Extraction Time Label */}
                                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-medium">
                                            <span className="font-semibold text-slate-700">Source:</span>
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                                              {proposal.sourceName || "Pasted text"}
                                            </span>
                                            <span>•</span>
                                            <span>Extracted: {formatExtractionTime(proposal.importedAt || proposal.createdAt)}</span>
                                          </div>

                                          {/* Badge Row */}
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span
                                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${
                                                proposal.type === "fact"
                                                  ? "bg-purple-100 text-purple-700"
                                                  : "bg-blue-100 text-blue-700"
                                              }`}
                                            >
                                              {proposal.type}
                                            </span>
                                            {proposal.category && (
                                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 capitalize">
                                                {proposal.category}
                                              </span>
                                            )}
                                            {proposal.type === "rule" && proposal.severity && (
                                              <span
                                                className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${
                                                  proposal.severity === "high"
                                                    ? "bg-red-100 text-red-700"
                                                    : proposal.severity === "medium"
                                                    ? "bg-amber-100 text-amber-700"
                                                    : "bg-slate-100 text-slate-700"
                                                }`}
                                              >
                                                {proposal.severity} severity
                                              </span>
                                            )}
                                            {proposal.duplicateOf && (
                                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                                {proposal.duplicateOf}
                                              </span>
                                            )}
                                            {proposal.status === "approved" && (
                                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3 text-green-600" />
                                                Approved as {proposal.approvedId}
                                              </span>
                                            )}
                                            {proposal.status === "rejected" && (
                                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                                                Rejected
                                              </span>
                                            )}
                                          </div>

                                          {/* Proposal Title and Statement */}
                                          {isEditing ? (
                                            <div className="space-y-2 pt-1 bg-blue-50/50 p-3 rounded-lg border border-blue-200">
                                              <label className="block text-[11px] font-bold text-slate-700">Edit Proposal Details</label>
                                              <input
                                                type="text"
                                                value={editedProposalData.title ?? proposal.title}
                                                onChange={(e) => setEditedProposalData({ ...editedProposalData, title: e.target.value })}
                                                className="w-full px-2.5 py-1 text-xs rounded border border-slate-300 font-bold"
                                                placeholder="Proposal Title"
                                              />
                                              <div>
                                                <textarea
                                                  rows={2}
                                                  value={editedProposalData.text ?? proposal.text}
                                                  onChange={(e) => {
                                                    setEditedProposalData({ ...editedProposalData, text: e.target.value });
                                                    setProposalEditError(null);
                                                  }}
                                                  className={`w-full px-2.5 py-1 text-xs rounded border font-medium ${
                                                    proposalEditError ? "border-red-500 ring-1 ring-red-500" : "border-slate-300"
                                                  }`}
                                                  placeholder="Policy instruction or fact statement"
                                                />
                                                {proposalEditError && (
                                                  <p className="text-[11px] font-bold text-red-600 flex items-center gap-1 mt-1">
                                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                                                    <span>{proposalEditError}</span>
                                                  </p>
                                                )}
                                              </div>
                                              {proposal.type === "rule" && (
                                                <div className="flex items-center gap-3">
                                                  <label className="text-[11px] font-bold text-slate-600">Severity:</label>
                                                  <select
                                                    value={editedProposalData.severity ?? proposal.severity}
                                                    onChange={(e) => setEditedProposalData({ ...editedProposalData, severity: e.target.value })}
                                                    className="px-2 py-1 text-xs rounded border border-slate-300"
                                                  >
                                                    <option value="high">High</option>
                                                    <option value="medium">Medium</option>
                                                    <option value="low">Low</option>
                                                  </select>
                                                </div>
                                              )}
                                              <div className="flex items-center gap-2 pt-1">
                                                <button
                                                  type="button"
                                                  disabled={Boolean(savingProposalId)}
                                                  onClick={() => handleProposalDecision(proposal.id, "edit_and_approve", editedProposalData)}
                                                  className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs font-bold shadow-2xs flex items-center gap-1.5"
                                                >
                                                  {isSavingThis ? (
                                                    <>
                                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                                      <span>Saving...</span>
                                                    </>
                                                  ) : (
                                                    "Save & Approve"
                                                  )}
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={Boolean(savingProposalId)}
                                                  onClick={() => {
                                                    setEditingProposalId(null);
                                                    setEditedProposalData({});
                                                    setProposalEditError(null);
                                                  }}
                                                  className="px-2.5 py-1 text-slate-600 hover:text-slate-800 text-xs font-medium"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <>
                                              <h4 className="text-sm font-bold text-slate-900">{proposal.title}</h4>
                                              <p className="text-xs text-slate-800 font-medium bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                                {proposal.text}
                                              </p>
                                            </>
                                          )}

                                          {/* Verbatim Source Sentence in Context */}
                                          {proposal.excerpt && (
                                            <div className="text-[11px] text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/70">
                                              <span className="font-bold text-slate-700 block mb-1">Source sentence in context:</span>
                                              <div className="font-mono text-slate-700 text-[11px]">
                                                <span>{proposal.excerpt.before}</span>
                                                <mark className="bg-amber-200/90 text-slate-900 px-1 py-0.5 rounded font-bold mx-0.5">
                                                  {proposal.excerpt.match}
                                                </mark>
                                                <span>{proposal.excerpt.after}</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        {/* Actions Column */}
                                        <div className="flex sm:flex-col items-center gap-2 shrink-0">
                                          {proposal.status === "pending" && !isEditing && (
                                            isSavingThis ? (
                                              <div className="w-full px-3 py-2 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 flex items-center justify-center gap-1.5 animate-pulse">
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                                <span>Saving...</span>
                                              </div>
                                            ) : (
                                              <>
                                                <button
                                                  type="button"
                                                  disabled={Boolean(savingProposalId)}
                                                  onClick={() => handleProposalDecision(proposal.id, "approve")}
                                                  className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all shadow-2xs flex items-center justify-center gap-1.5"
                                                >
                                                  <Check className="w-3.5 h-3.5" />
                                                  Approve
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={Boolean(savingProposalId)}
                                                  onClick={() => {
                                                    setEditingProposalId(proposal.id);
                                                    setProposalEditError(null);
                                                    setEditedProposalData({
                                                      title: proposal.title,
                                                      text: proposal.text,
                                                      category: proposal.category,
                                                      severity: proposal.severity
                                                    });
                                                  }}
                                                  className="w-full px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
                                                >
                                                  <Edit3 className="w-3.5 h-3.5" />
                                                  Edit & Approve
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={Boolean(savingProposalId)}
                                                  onClick={() => handleProposalDecision(proposal.id, "reject")}
                                                  className="w-full px-3 py-1.5 bg-slate-50 hover:bg-red-50 disabled:opacity-50 text-slate-600 hover:text-red-700 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
                                                >
                                                  <X className="w-3.5 h-3.5" />
                                                  Reject
                                                </button>
                                              </>
                                            )
                                          )}

                                          {proposal.status === "approved" && (
                                            <div className="space-y-1 text-right">
                                              <button
                                                type="button"
                                                disabled={Boolean(savingProposalId)}
                                                onClick={() => handleUndoProposal(proposal.id)}
                                                className="px-2.5 py-1 text-xs text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg font-bold flex items-center gap-1 disabled:opacity-50"
                                                title="Rollback this approval and remove the item from the library"
                                              >
                                                {isSavingThis ? (
                                                  <>
                                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                                    <span>Saving...</span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <RotateCcw className="w-3 h-3" />
                                                    Undo Approval
                                                  </>
                                                )}
                                              </button>
                                              <p className="text-[10px] text-slate-400 italic text-right max-w-[140px]">
                                                Also removable via table delete button below
                                              </p>
                                            </div>
                                          )}

                                          {proposal.status === "rejected" && (
                                            <button
                                              type="button"
                                              disabled={Boolean(savingProposalId)}
                                              onClick={() => handleProposalDecision(proposal.id, "pending")}
                                              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium disabled:opacity-50"
                                            >
                                              {isSavingThis ? "Saving..." : "Reconsider"}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* SELF-HEALING GUIDELINE CLARIFICATION (ROUND 3, IMPROVEMENT 2) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-purple-600" />
                    <h2 className="font-bold text-slate-900 text-base">Clarification Requests</h2>
                    {clarificationRequests.filter(r => r.status === "pending").length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse">
                        {clarificationRequests.filter(r => r.status === "pending").length} Needs Attention
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Self-healing policy clarification triggered when creators frequently dispute a rule (&ge; 3 flags, &ge; 40% disputes). AI suggests clearer wordings; you decide what enters the library.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadClarificationDemo}
                    disabled={isLoadingClarificationDemo}
                    className="px-3 py-1.5 rounded-xl bg-purple-50 border border-purple-200 hover:bg-purple-100 text-purple-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
                    title="Seed dispute history for R-07 (5 flags, 3 disputes) and 1 stored draft to test clarification in < 1 minute"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    {isLoadingClarificationDemo ? "Loading demo..." : "Load clarification demo"}
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                {clarificationRequests.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center mx-auto mb-2.5">
                      <HelpCircle className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold text-slate-800 text-sm">
                      No unclear rules right now. Rules that creators keep disputing will appear here.
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                      When creators frequently reject or edit AI-suggested fixes for a policy, BrandGuard automatically raises a clarification request with suggested clearer wordings.
                    </p>
                    <button
                      type="button"
                      onClick={handleLoadClarificationDemo}
                      disabled={isLoadingClarificationDemo}
                      className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all shadow-2xs"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {isLoadingClarificationDemo ? "Loading demo..." : "Load clarification demo"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {clarificationRequests.map((request) => {
                      const isSavingThis = savingClarificationId === request.id;
                      const isEditingThis = editingClarificationId === request.id;
                      const recheckData = recheckResults[request.id];
                      const isRecheckingThis = isRecheckingId === request.id;

                      return (
                        <div
                          key={request.id}
                          className={`p-4 sm:p-5 rounded-xl border transition-all space-y-3 ${
                            request.status === "resolved"
                              ? "bg-emerald-50/20 border-emerald-200"
                              : request.status === "dismissed"
                              ? "bg-slate-50/60 border-slate-200 opacity-80"
                              : "bg-white border-slate-200 shadow-2xs hover:border-purple-200"
                          }`}
                        >
                          {/* Card Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-purple-700 text-sm">{request.ruleId}</span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 capitalize">
                                {request.ruleCategory || "terminology"}
                              </span>
                              {request.status === "resolved" ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  Clarified (v{request.newVersion || 2})
                                </span>
                              ) : request.status === "dismissed" ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                  Dismissed (Kept as is)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                  Pending Clarification
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500 font-medium">
                              Flagged {request.stats?.totalFlagged} times &bull; {request.stats?.disputePercentage}% dispute rate ({request.stats?.disputedCount} of {request.stats?.decidedCount} decisions disputed)
                            </span>
                          </div>

                          {/* Current Policy Text */}
                          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700">
                            <span className="font-bold text-slate-900">Current Rule Text: </span>
                            "{request.ruleText}"
                          </div>

                          {/* Disputed Examples (up to 5) */}
                          {request.examples && request.examples.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                Disputed Creator Examples ({request.examples.length}):
                              </span>
                              <div className="grid grid-cols-1 gap-2">
                                {request.examples.map((ex, idx) => (
                                  <div key={idx} className="p-2.5 bg-amber-50/60 border border-amber-200/80 rounded-lg text-xs space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-bold text-slate-900 font-mono">"{ex.quote}"</span>
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        ex.status === "rejected" ? "bg-red-100 text-red-800" : "bg-purple-100 text-purple-800"
                                      }`}>
                                        Creator {ex.creatorDecision || ex.status}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-600">
                                      <span className="text-slate-500">Suggested fix: </span>"{ex.suggestedFix}"
                                      {ex.explanation && <span className="text-slate-500 italic ml-2">({ex.explanation})</span>}
                                    </div>
                                    <div className="text-[10px] text-slate-400">Context: {ex.draftTitle}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Clarifying Question Callout */}
                          <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl space-y-1">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-purple-900">
                              <HelpCircle className="w-4 h-4 text-purple-600" />
                              <span>Clarifying Question for Brand Manager</span>
                              {!request.aiAvailable && (
                                <span className="text-[10px] font-normal text-purple-600 italic ml-1">
                                  (AI suggestions unavailable; template question shown)
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-purple-950 font-medium leading-relaxed">
                              {request.question}
                            </p>
                          </div>

                          {/* Pending State: Suggested Wordings & Actions */}
                          {request.status === "pending" && (
                            <div className="space-y-3 pt-1">
                              {request.suggestedWordings && request.suggestedWordings.length > 0 && (
                                <div className="space-y-2">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    AI Suggested Clearer Wordings ({request.suggestedWordings.length}):
                                  </span>
                                  <div className="space-y-2">
                                    {request.suggestedWordings.map((wording, wIdx) => (
                                      <div
                                        key={wIdx}
                                        className="p-3 bg-white border border-slate-200 hover:border-purple-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors shadow-2xs"
                                      >
                                        <span className="text-slate-800 font-medium flex-1">"{wording}"</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <button
                                            type="button"
                                            disabled={isSavingThis}
                                            onClick={() => handleClarificationDecide(request.id, "apply", wording, request.ruleId)}
                                            className="px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-50"
                                          >
                                            {isSavingThis ? (
                                              <>
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                                Saving...
                                              </>
                                            ) : (
                                              <>
                                                <Check className="w-3 h-3" />
                                                Use this wording
                                              </>
                                            )}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isSavingThis}
                                            onClick={() => {
                                              setEditingClarificationId(request.id);
                                              setEditingClarificationText(wording);
                                              setEditingClarificationError(null);
                                            }}
                                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-50"
                                          >
                                            <Edit3 className="w-3 h-3" />
                                            Edit & use
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Inline Edit Box */}
                              {isEditingThis && (
                                <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2 text-xs">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-blue-900">Edit and Apply Clearer Rule Text:</span>
                                    <span className="text-[11px] text-blue-700">{editingClarificationText.length}/500</span>
                                  </div>
                                  <textarea
                                    value={editingClarificationText}
                                    onChange={(e) => {
                                      setEditingClarificationText(e.target.value);
                                      if (editingClarificationError) setEditingClarificationError(null);
                                    }}
                                    rows={3}
                                    maxLength={500}
                                    className="w-full p-2.5 bg-white border border-blue-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Enter clarified policy wording (min 5 characters)..."
                                  />
                                  {editingClarificationError && (
                                    <p className="text-[11px] text-red-600 font-bold flex items-center gap-1">
                                      <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                                      {editingClarificationError}
                                    </p>
                                  )}
                                  <div className="flex items-center justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      disabled={isSavingThis}
                                      onClick={() => {
                                        setEditingClarificationId(null);
                                        setEditingClarificationError(null);
                                      }}
                                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-medium"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isSavingThis}
                                      onClick={() => handleClarificationDecide(request.id, "edit_and_apply", editingClarificationText, request.ruleId)}
                                      className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                                    >
                                      {isSavingThis ? (
                                        <>
                                          <RefreshCw className="w-3 h-3 animate-spin" />
                                          Saving...
                                        </>
                                      ) : (
                                        <>
                                          <Save className="w-3 h-3" />
                                          Save & Apply Wording
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Card Actions: Keep rule as is */}
                              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                {(!request.suggestedWordings || request.suggestedWordings.length === 0) && !isEditingThis && (
                                  <button
                                    type="button"
                                    disabled={isSavingThis}
                                    onClick={() => {
                                      setEditingClarificationId(request.id);
                                      setEditingClarificationText(request.ruleText);
                                      setEditingClarificationError(null);
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    Write clearer wording
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isSavingThis}
                                  onClick={() => handleClarificationDecide(request.id, "dismiss", null, request.ruleId)}
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium flex items-center gap-1 transition-all disabled:opacity-50 ml-auto"
                                  title="Dismiss this clarification; keeps current rule as is. Won't re-raise until at least 3 new disputes occur."
                                >
                                  {isSavingThis ? "Saving..." : "Keep rule as is"}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Resolved State & Re-check Comparison */}
                          {request.status === "resolved" && (
                            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2 text-xs">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-emerald-900 font-bold">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                  <span>Rule {request.ruleId} updated (v{request.newVersion || 2})</span>
                                </div>
                                <button
                                  type="button"
                                  disabled={isRecheckingThis}
                                  onClick={() => handleRecheckClarification(request.id, request.ruleId)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-2xs disabled:opacity-50 shrink-0"
                                  title="Re-run review on stored drafts whose findings were disputed for this rule"
                                >
                                  {isRecheckingThis ? (
                                    <>
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                      Re-checking stored drafts...
                                    </>
                                  ) : (
                                    <>
                                      <RefreshCw className="w-3 h-3" />
                                      Re-check
                                    </>
                                  )}
                                </button>
                              </div>
                              <p className="text-slate-800 font-medium">
                                <span className="font-bold text-emerald-900">Applied Wording: </span>
                                "{request.appliedWording}"
                              </p>

                              {/* Re-check Comparison Result */}
                              {recheckData && (
                                <div className="mt-3 pt-3 border-t border-emerald-200 space-y-2.5">
                                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                                    <span>Before vs After Re-check Verification</span>
                                    <span className="text-[11px] text-emerald-800 font-normal">
                                      {recheckData.message}
                                    </span>
                                  </div>

                                  {recheckData.draftsTested === 0 ? (
                                    <p className="text-slate-500 italic text-[11px] p-2 bg-white rounded-lg border border-slate-200">
                                      No stored drafts exist for this rule.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                                          <div className="text-slate-500 text-[10px] uppercase font-bold">Before Findings</div>
                                          <div className="text-base font-bold text-slate-800">{recheckData.beforeFindingsCount}</div>
                                        </div>
                                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                                          <div className="text-slate-500 text-[10px] uppercase font-bold">After Findings</div>
                                          <div className="text-base font-bold text-slate-800">{recheckData.afterFindingsCount}</div>
                                        </div>
                                        <div className="p-2 bg-emerald-100/70 rounded-lg border border-emerald-300">
                                          <div className="text-emerald-900 text-[10px] uppercase font-bold">Resolved / Disappeared</div>
                                          <div className="text-base font-bold text-emerald-700">
                                            {recheckData.disappearedFindings?.length || 0}
                                          </div>
                                        </div>
                                      </div>

                                      {recheckData.disappearedFindings?.length > 0 && (
                                        <div className="space-y-1 pt-1">
                                          <span className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider">
                                            Findings Disappeared Under Clarified Policy:
                                          </span>
                                          <div className="space-y-1">
                                            {recheckData.disappearedFindings.map((df, dfIdx) => (
                                              <div
                                                key={dfIdx}
                                                className="p-2 bg-white rounded-lg border border-emerald-200 text-[11px] flex items-center justify-between gap-2"
                                              >
                                                <div>
                                                  <span className="font-bold text-slate-900 font-mono">"{df.quote}"</span>
                                                  <span className="text-slate-500 ml-1.5">({df.draftTitle})</span>
                                                </div>
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 shrink-0">
                                                  {df.reason}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Rules Library */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-900 text-base flex flex-wrap items-center gap-2">
                    <span>Active Brand Rules ({rules.length})</span>
                    <span className="text-xs font-medium text-slate-500">
                      Rules in library: {rules.length} ({rules.filter(r => r.source).length} imported)
                    </span>
                  </h2>
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
                        <td className="py-3 px-4 font-mono font-bold text-blue-600">
                          <div className="flex items-center gap-1.5">
                            <span>{rule.id}</span>
                            {rule.version && rule.version > 1 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-sans font-bold">
                                v{rule.version}
                              </span>
                            )}
                          </div>
                          {rule.source && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-sans font-medium block mt-0.5 max-w-[120px] truncate"
                              title={rule.source}
                            >
                              Imported
                            </span>
                          )}
                        </td>
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
                  <h2 className="font-bold text-slate-900 text-base flex flex-wrap items-center gap-2">
                    <span>Approved Facts Library ({facts.length})</span>
                    <span className="text-xs font-medium text-slate-500">
                      Facts in library: {facts.length} ({facts.filter(f => f.source).length} imported)
                    </span>
                  </h2>
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
                        <td className="py-3 px-4 font-mono font-bold text-purple-600">
                          <div>{fact.id}</div>
                          {fact.source && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-sans font-medium block mt-0.5 max-w-[120px] truncate"
                              title={fact.source}
                            >
                              Imported
                            </span>
                          )}
                        </td>
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

            {/* Tone Profiles & Brand Terms */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-blue-600" />
                    Channel Tone Profiles &amp; Brand Terms
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Rule-based tone settings per channel, allowing the same copy to be judged differently across Twitter, Email, Landing Pages, and Banners.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetToneSettings}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset to Defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveToneSettings}
                    disabled={isSavingToneSettings}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {isSavingToneSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Tone Profiles
                  </button>
                </div>
              </div>

              {toneSettingsError && (
                <div className="mx-4 sm:mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{toneSettingsError}</span>
                </div>
              )}

              <div className="p-4 sm:p-6 space-y-6">
                {/* Table of channels */}
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <th className="py-2.5 px-4">Target Channel</th>
                        <th className="py-2.5 px-4">Max Exclamations (T-03)</th>
                        <th className="py-2.5 px-4">Max ALL-CAPS Words (T-05)</th>
                        <th className="py-2.5 px-4">Max Characters (T-06)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        "Social Media / Twitter",
                        "Marketing Email",
                        "Product Landing Page",
                        "Ad Copy / Banner"
                      ].map((channelKey) => {
                        const prof = toneProfiles[channelKey] || { maxExclamationMarks: 1, maxAllCapsWords: 0, maxCharacters: 0 };
                        return (
                          <tr key={channelKey} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-900">
                              {channelKey}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="1000"
                                  step="1"
                                  value={prof.maxExclamationMarks}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setToneProfiles(prev => ({
                                      ...prev,
                                      [channelKey]: { ...prev[channelKey], maxExclamationMarks: val }
                                    }));
                                  }}
                                  className="w-20 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  required
                                />
                                <span className="text-[11px] text-slate-400">marks</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="1000"
                                  step="1"
                                  value={prof.maxAllCapsWords}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setToneProfiles(prev => ({
                                      ...prev,
                                      [channelKey]: { ...prev[channelKey], maxAllCapsWords: val }
                                    }));
                                  }}
                                  className="w-20 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  required
                                />
                                <span className="text-[11px] text-slate-400">words</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="1000"
                                  step="1"
                                  value={prof.maxCharacters}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setToneProfiles(prev => ({
                                      ...prev,
                                      [channelKey]: { ...prev[channelKey], maxCharacters: val }
                                    }));
                                  }}
                                  className="w-24 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  required
                                />
                                <span className="text-[11px] text-slate-400">
                                  {Number(prof.maxCharacters) === 0 ? "(0 = no limit)" : "chars"}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Brand Terms Input */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                  <label className="block text-xs font-bold text-slate-800">
                    Exempt Brand Terms &amp; Approved Acronyms
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Words, brand names, or approved acronyms listed here are exempted from all-caps (T-05) tone violations (comma or newline separated).
                  </p>
                  <input
                    type="text"
                    value={brandTermsText}
                    onChange={(e) => setBrandTermsText(e.target.value)}
                    placeholder="e.g. CampusPro, AI, AGY, RAM"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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
                  onClick={() => {
                    setCreatorMode("text");
                    setActiveDraft(null);
                    setVisualImagePreview(null);
                    setAnalyzingFilename(null);
                    setSelectedFindingId(null);
                    setVisualAuditError(null);
                  }}
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
                  onClick={() => {
                    setCreatorMode("visual");
                    setActiveDraft(null);
                    setVisualImagePreview(null);
                    setAnalyzingFilename(null);
                    setSelectedFindingId(null);
                    setVisualAuditError(null);
                  }}
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

                    <button
                      type="button"
                      onClick={handleCompareChannels}
                      className="px-3 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 rounded-lg text-xs font-bold flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all shadow-2xs"
                      title="Compare tone rules (T-03, T-05, T-06) across all 4 channels instantly"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Compare Channels</span>
                    </button>

                    <select
                      value={selectedSampleDraftId}
                      onChange={(e) => {
                        const found = sampleDrafts.find((s) => s.id === e.target.value);
                        if (found) {
                          setSelectedSampleDraftId(found.id);
                          handleSelectSample(found);
                        }
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    <span className="text-slate-500">Rules active: {rules.length} ({rules.filter(r => r.source).length} imported) | Facts active: {facts.length} ({facts.filter(f => f.source).length} imported)</span>
                  </div>
                </div>

                {reviewError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{reviewError}</span>
                  </div>
                )}

                {/* Loading State with stage progress for Copy check */}
                {isReviewing && (
                  <div className="mt-4 p-4 bg-white border border-blue-200 rounded-2xl shadow-xs text-blue-900 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-slate-800">
                            Checking {analyzingDraftTitle || draftTitle || "copy draft"}...
                          </p>
                          <p className="text-[11px] text-slate-500">Real-time governance analysis in progress</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono">
                        Pipeline Active
                      </span>
                    </div>

                    {/* Stages that tick off */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-1">
                      {[
                        { key: "init", label: "Draft validation & ingest" },
                        { key: "security", label: "Prompt injection scan" },
                        { key: "gemini_review", label: "Gemini AI policy review" },
                        { key: "deterministic", label: "Deterministic tone checks" },
                        { key: "validator", label: "Validator & dedupe" }
                      ].map(stage => {
                        const isDone = textReviewStages[stage.key];
                        return (
                          <div
                            key={stage.key}
                            className={`flex items-center gap-1.5 p-2 rounded-xl text-[11px] transition-all ${
                              isDone
                                ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                                : "bg-slate-50 text-slate-600 border border-slate-200"
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
                            )}
                            <span className={isDone ? "font-bold text-emerald-900 truncate" : "truncate"}>
                              {stage.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: VISUAL BANNER AUDITOR SUBMISSION */}
            {creatorMode === "visual" && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-blue-600" />
                    Visual Banner Auditor
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Upload display ads or marketing banners (PNG, JPG, WebP &le; 4 MB). The image is sent to Google Gemini for analysis.
                  </p>
                </div>

                {/* Quick-test buttons in their own row below description, left-aligned */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
                    QUICK TESTS:
                  </span>
                  <button
                    type="button"
                    disabled={isVisualAuditing}
                    onClick={() => handleLoadSampleBanner("bad-banner.png", "Sample Bad Banner")}
                    className="h-8 px-3.5 py-1.5 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Try Bad Banner</span>
                  </button>
                  <button
                    type="button"
                    disabled={isVisualAuditing}
                    onClick={() => handleLoadSampleBanner("clean-banner.png", "Sample Clean Banner")}
                    className="h-8 px-3.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Try Clean Banner</span>
                  </button>
                  <button
                    type="button"
                    disabled={isVisualAuditing}
                    onClick={() => handleLoadSampleBanner("injection-banner.png", "Sample Prompt Injection Banner")}
                    className="h-8 px-3.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                  >
                    <Shield className="w-3.5 h-3.5 shrink-0" />
                    <span>Try Injection Banner</span>
                  </button>
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

                {/* Loading State with real stages ticking off */}
                {isVisualAuditing && (
                  <div className="p-4 bg-white border border-blue-200 rounded-2xl shadow-xs text-blue-900 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-slate-800">Analysing {analyzingFilename || "banner"}...</p>
                          <p className="text-[11px] text-slate-500">AI analysis can take up to a minute.</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono">
                        Pipeline Active
                      </span>
                    </div>

                    {/* Real stages that tick off */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      {[
                        { key: "upload", label: "Upload & validation" },
                        { key: "resize", label: "Downscale & thumbnail" },
                        { key: "gemini_ocr", label: "Gemini Vision OCR" },
                        { key: "palette", label: "CIE Lab palette check" },
                        { key: "contrast", label: "WCAG contrast clustering" },
                        { key: "review", label: "Rules & fact review" },
                        { key: "validator", label: "Validator & dedupe" }
                      ].map(stage => {
                        const isDone = auditStages[stage.key];
                        return (
                          <div
                            key={stage.key}
                            className={`flex items-center gap-1.5 p-2 rounded-xl text-[11px] transition-all ${
                              isDone
                                ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                                : "bg-slate-50 text-slate-600 border border-slate-200"
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
                            )}
                            <span className={isDone ? "font-bold text-emerald-900 truncate" : "truncate"}>
                              {stage.label}
                            </span>
                          </div>
                        );
                      })}
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
            {isVisualAuditing ? (
              /* Analysing <filename>... Skeleton State */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
                {/* Left Column: Image Preview with NO overlays + OCR & Alt-Text skeleton */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">
                          Analysing {analyzingFilename || "banner"}...
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          AI analysis can take up to a minute.
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono">
                      Analysing...
                    </span>
                  </div>

                  {/* New Image preview with NO overlays */}
                  {renderBannerImageWithBoxes(null, visualImagePreview)}

                  {/* Skeleton placeholders */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="h-3 bg-slate-200 rounded w-1/3"></div>
                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                    <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                  </div>

                  <div className="p-3.5 bg-blue-50/40 rounded-xl border border-blue-200/80 space-y-2">
                    <div className="h-3 bg-blue-200 rounded w-1/4"></div>
                    <div className="h-8 bg-blue-100 rounded w-full"></div>
                  </div>
                </div>

                {/* Right Column: Skeleton for Findings, Contrast, and Palette */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                    <div className="h-3 bg-slate-100 rounded w-full"></div>
                    <div className="h-16 bg-slate-100 rounded w-full"></div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <div className="h-4 bg-slate-200 rounded w-2/3"></div>
                    <div className="h-24 bg-slate-100 rounded w-full"></div>
                  </div>
                </div>
              </div>
            ) : isReviewing ? (
              /* Checking <draftTitle>... Skeleton State */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
                {/* Left Column: Copy skeleton */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                      <h3 className="font-bold text-slate-800 text-sm">
                        Checking {analyzingDraftTitle || draftTitle || "copy draft"}...
                      </h3>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono">
                      Checking...
                    </span>
                  </div>

                  {/* Skeleton placeholders for Original Draft, Proposed Final Copy, and Diff */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                    <div className="h-4 bg-slate-200 rounded w-full"></div>
                    <div className="h-4 bg-slate-200 rounded w-5/6"></div>
                  </div>

                  <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-200 space-y-2">
                    <div className="h-3 bg-emerald-200 rounded w-1/3"></div>
                    <div className="h-4 bg-emerald-100 rounded w-3/4"></div>
                  </div>

                  <div className="p-3.5 bg-slate-100 rounded-xl border border-slate-200 space-y-2">
                    <div className="h-3 bg-slate-300 rounded w-1/2"></div>
                    <div className="h-8 bg-slate-200 rounded w-full"></div>
                  </div>
                </div>

                {/* Right Column: Skeleton for Finding Cards */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                    <div className="h-3 bg-slate-100 rounded w-full"></div>
                    <div className="h-16 bg-slate-100 rounded w-full"></div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <div className="h-4 bg-slate-200 rounded w-2/3"></div>
                    <div className="h-20 bg-slate-100 rounded w-full"></div>
                  </div>
                </div>
              </div>
            ) : activeDraft ? (
              <ErrorBoundary onReset={() => { setActiveDraft(null); setCreatorMode("text"); handleLoadDemoScenario(); }}>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Security Alert Strip for Prompt Injections */}
                {activeDraft.findings?.some(f => f.rule_id === "SEC-01" || f.source === "security") && (
                  <div className="lg:col-span-12 p-3.5 bg-red-600 text-white rounded-xl flex items-center justify-between shadow-xs">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle className="w-5 h-5 shrink-0 text-white" />
                      <div>
                        <span className="font-bold text-xs uppercase tracking-wider block">Security Alert: Prompt Injection Detected</span>
                        <span className="text-xs text-red-100">Adversarial instructions attempting to instruct the reviewer were detected and must be removed.</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 bg-red-800 text-white rounded-full uppercase tracking-wider">
                      Action Required
                    </span>
                  </div>
                )}

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
                          {isOcrFailed ? (
                            <div className="flex items-center justify-between py-1 bg-red-50/70 p-2.5 rounded-lg border border-red-200">
                              <span className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                                Text extraction failed. Please try again
                              </span>
                              <button
                                type="button"
                                onClick={handleRetryVisualAudit}
                                className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-all"
                              >
                                <RefreshCw className="w-3 h-3" /> Retry
                              </button>
                            </div>
                          ) : hasZeroLines ? (
                            <p className="text-xs text-slate-500 italic py-1">No text found in this image</p>
                          ) : (
                            renderHighlightedText(activeDraft.originalText || activeDraft.extractedText, activeDraft.findings)
                          )}
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
                                disabled={isVisualAuditing}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50"
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

                        {/* Word-Level Redline Diff */}
                        <RedlineDiff
                          originalText={activeDraft.originalText}
                          finalText={activeDraft.currentText}
                          findings={activeDraft.findings}
                          title="Word-Level Redline Diff (Original vs Proposed Final Copy)"
                          defaultMode="inline"
                          showToggle={true}
                        />
                      </div>
                    )}

                    {/* Validator Stats (Real Counts) + Why dropped / merged expander */}
                    <div className="mt-4 p-3 bg-slate-100/70 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-blue-600 shrink-0" />
                          <span>
                            <strong>Validator:</strong> {activeDraft.findings?.length || 0} valid findings kept,{" "}
                            {activeDraft.validatorRejected?.length || 0} dropped,{" "}
                            {activeDraft.validatorMerged?.length || 0} merged
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                            Model: {activeDraft?.modelUsed || serverInfo.modelName}
                          </span>
                          {((activeDraft.validatorRejected && activeDraft.validatorRejected.length > 0) ||
                            (activeDraft.validatorMerged && activeDraft.validatorMerged.length > 0)) && (
                            <button
                              onClick={() => setShowValidatorDetails(!showValidatorDetails)}
                              className="text-[11px] font-bold text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5 cursor-pointer"
                            >
                              {showValidatorDetails ? "Hide details ▲" : "Why dropped / merged? ▼"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Collapsible Why Dropped / Merged Expander Card */}
                      {showValidatorDetails && (
                        <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                          {/* Dropped items */}
                          {activeDraft.validatorRejected && activeDraft.validatorRejected.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 block">
                                Dropped by Validator ({activeDraft.validatorRejected.length}):
                              </span>
                              <div className="space-y-1">
                                {activeDraft.validatorRejected.map((item, idx) => (
                                  <div key={idx} className="p-2 bg-rose-50/80 border border-rose-200 rounded-lg text-[11px]">
                                    <div className="flex items-center justify-between font-semibold text-rose-900">
                                      <span className="font-mono">[{item.rule_id || item.finding?.rule_id || "R-??"}]</span>
                                      <span className="text-slate-600 italic font-normal">"{item.quote || item.finding?.quote || "text"}"</span>
                                    </div>
                                    <div className="text-rose-700 mt-0.5">
                                      {(item.reasons || ["Dropped by governance filter"]).join(" • ")}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Merged items */}
                          {activeDraft.validatorMerged && activeDraft.validatorMerged.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
                                Merged by Validator ({activeDraft.validatorMerged.length}):
                              </span>
                              <div className="space-y-1">
                                {activeDraft.validatorMerged.map((item, idx) => (
                                  <div key={idx} className="p-2 bg-blue-50/80 border border-blue-200 rounded-lg text-[11px]">
                                    <div className="flex items-center justify-between font-semibold text-blue-900">
                                      <span className="font-mono">[{item.rule_id || "MERGE"}]</span>
                                      <span className="text-slate-600 italic font-normal">"{item.originalQuote || item.quote}"</span>
                                    </div>
                                    <div className="text-blue-700 mt-0.5">
                                      {item.reason || `Merged into longest span "${item.mergedIntoQuote || item.quote}"`}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
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
                  <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">
                      Send finalized draft with your accepted fixes to reviewer.
                    </span>
                    <div className="flex items-center gap-2">
                      {activeDraft.certificate && (
                        <button
                          type="button"
                          onClick={() => setViewingCertificateDraft(activeDraft)}
                          className="px-3.5 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> View Compliance Certificate
                        </button>
                      )}
                      <button
                        onClick={handleSubmitToReviewer}
                        disabled={isVisualAuditing || isReviewing}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" /> Submit to Reviewer
                      </button>
                    </div>
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

                  {(!activeDraft.findings || activeDraft.findings.length === 0) && !isOcrFailed && !hasZeroLines && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                      <h4 className="font-bold text-slate-800 text-sm">No Compliance Issues Detected</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Draft complies with all active brand guidelines, visual rules, and verified facts.
                      </p>
                    </div>
                  )}

                  {isOcrFailed && (!activeDraft.findings || activeDraft.findings.length === 0) && (
                    <div className="bg-white rounded-2xl border border-red-200 bg-red-50/30 p-8 text-center">
                      <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-2" />
                      <h4 className="font-bold text-slate-800 text-sm">Text extraction failed. Please try again</h4>
                      <p className="text-xs text-slate-500 mt-1 mb-3">
                        OCR could not extract text from this image.
                      </p>
                      <button
                        type="button"
                        onClick={handleRetryVisualAudit}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-all"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Retry
                      </button>
                    </div>
                  )}

                  {hasZeroLines && (!activeDraft.findings || activeDraft.findings.length === 0) && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                      <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                      <h4 className="font-bold text-slate-800 text-sm">No text found in this image</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        No visible text elements were detected in this banner.
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
                          {finding.rule_id === "SEC-01" ? (
                            <div className="p-2.5 bg-red-50 border border-red-200/80 rounded-lg mb-3 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 block mb-0.5">
                                  Action
                                </span>
                                <p className="text-xs font-semibold text-red-950">
                                  Remove instruction text from banner / copy
                                </p>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-0.5 bg-red-200 text-red-800 rounded uppercase font-mono">
                                Remove
                              </span>
                            </div>
                          ) : editingFixId === finding.id ? (
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
                            <div className={`p-2.5 rounded-lg mb-3 border ${finding.suggested_fix === "Needs manual edit" ? "bg-amber-50/80 border-amber-200" : "bg-slate-50 border-slate-200/80"}`}>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                                Suggested Fix
                              </span>
                              {finding.suggested_fix === "Needs manual edit" ? (
                                <div className="space-y-1">
                                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded text-xs font-bold">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Needs manual edit
                                  </div>
                                  <p className="text-[11px] text-amber-700">
                                    {finding.fix_rejection_reason || "Auto-fix was rejected for ungrammatical outcome. Please edit manually."}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs font-semibold text-blue-900">
                                  "{finding.suggested_fix}"
                                </p>
                              )}
                            </div>
                          )}

                          {/* Action Controls: Accept, Edit, Reject at all times + Undo */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                            {isPending ? (
                              <>
                                {finding.suggested_fix === "Needs manual edit" ? (
                                  <button
                                    onClick={() => {
                                      setEditingFixId(finding.id);
                                      setCustomFixText("");
                                    }}
                                    disabled={isVisualAuditing || isReviewing}
                                    className="flex-1 py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                                    title="Click to write manual replacement"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> Needs manual edit
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleFindingAction(finding.id, "accept")}
                                    disabled={isVisualAuditing || isReviewing}
                                    className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                  >
                                    <Check className="w-3.5 h-3.5" /> {finding.rule_id === "SEC-01" ? "Accept Removal" : "Accept"}
                                  </button>
                                )}
                                {finding.rule_id !== "SEC-01" && finding.suggested_fix !== "Needs manual edit" && (
                                  <button
                                    onClick={() => {
                                      setEditingFixId(finding.id);
                                      setCustomFixText(finding.suggested_fix);
                                    }}
                                    disabled={isVisualAuditing || isReviewing}
                                    className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center justify-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> Edit
                                  </button>
                                )}
                                <button
                                  onClick={() => handleFindingAction(finding.id, "reject")}
                                  disabled={isVisualAuditing || isReviewing}
                                  className="py-1.5 px-2.5 bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-500 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
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

                {/* Total timing in small grey text under the result */}
                {activeDraft?.timings_ms && (
                  <div className="col-span-1 lg:col-span-12 text-center py-2">
                    <p className="text-xs text-slate-400 font-mono">
                      {activeDraft.timings_ms.cached ? (
                        <span>⚡ Instant cached response ({activeDraft.timings_ms.total || 1}ms)</span>
                      ) : (
                        <span>
                          Total: {activeDraft.timings_ms.total}ms (Upload: {activeDraft.timings_ms.upload}ms &bull; Resize: {activeDraft.timings_ms.resize}ms &bull; OCR: {activeDraft.timings_ms.gemini_ocr}ms &bull; Palette: {activeDraft.timings_ms.palette}ms &bull; Contrast: {activeDraft.timings_ms.contrast}ms &bull; Review: {activeDraft.timings_ms.review}ms &bull; Validator: {activeDraft.timings_ms.validator}ms)
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </ErrorBoundary>
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
                <ErrorBoundary onReset={() => setActiveDraft(null)}>
                  {activeDraft && (
                  <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-5">
                    {/* Security Alert Strip for Reviewer */}
                    {activeDraft.findings?.some(f => f.rule_id === "SEC-01" || f.source === "security") && (
                      <div className="p-3.5 bg-red-600 text-white rounded-xl flex items-center justify-between shadow-xs">
                        <div className="flex items-center gap-2.5">
                          <AlertTriangle className="w-5 h-5 shrink-0 text-white" />
                          <div>
                            <span className="font-bold text-xs uppercase tracking-wider block">Security Alert: Prompt Injection Detected</span>
                            <span className="text-xs text-red-100">Adversarial instructions attempting to instruct the reviewer were detected and must be removed.</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 bg-red-800 text-white rounded-full uppercase tracking-wider">
                          Action Required
                        </span>
                      </div>
                    )}

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
                            {isOcrFailed ? (
                              <div className="flex items-center justify-between py-1 bg-red-50/70 p-2.5 rounded-lg border border-red-200">
                                <span className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                                  Text extraction failed. Please try again
                                </span>
                                <button
                                  type="button"
                                  onClick={handleRetryVisualAudit}
                                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-all"
                                >
                                  <RefreshCw className="w-3 h-3" /> Retry
                                </button>
                              </div>
                            ) : hasZeroLines ? (
                              <p className="text-xs text-slate-500 italic py-1">No text found in this image</p>
                            ) : (
                              <p className="text-xs font-mono text-slate-800 leading-relaxed whitespace-pre-wrap">
                                {activeDraft.originalText || activeDraft.extractedText}
                              </p>
                            )}
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
                      /* Word-Level Redline Diff in Reviewer View */
                      <RedlineDiff
                        originalText={activeDraft.originalText}
                        finalText={activeDraft.currentText}
                        findings={activeDraft.findings}
                        title="Reviewer Redline Diff (Original vs Final Approved Copy)"
                        defaultMode="inline"
                        showToggle={true}
                      />
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

                    {/* Active Compliance Certificate Card */}
                    {activeDraft.certificate && (
                      <div className="p-3.5 bg-emerald-50/90 border border-emerald-300 rounded-xl flex items-center justify-between gap-3 shadow-xs">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                            <ShieldCheck className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-emerald-950 block flex items-center gap-1.5">
                              Compliance Certificate Issued
                              <span className="text-[10px] font-normal px-1.5 py-0.2 rounded-full bg-emerald-200 text-emerald-800">
                                v{activeDraft.certificate.version}
                              </span>
                            </span>
                            <span className="text-[11px] font-mono text-emerald-700 block truncate max-w-[200px] sm:max-w-xs">
                              {activeDraft.certificate.certificateId}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setViewingCertificateDraft(activeDraft)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>View Certificate</span>
                        </button>
                      </div>
                    )}

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
              </ErrorBoundary>
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
          onClick={handleCloseGuideModal}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCloseGuideModal();
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
                type="button"
                onClick={handleCloseGuideModal}
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
                type="button"
                onClick={handleCloseGuideModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGuideModal(false);
                  handleLoadDemoScenario(false);
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

      {/* Compare Channels Modal (Deterministic multi-channel check) */}
      {showCompareModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="compare-modal-title"
          onClick={() => setShowCompareModal(false)}
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCompareModal(false);
            }}
            tabIndex={-1}
            className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 focus:outline-none max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="compare-modal-title" className="font-extrabold text-slate-900 text-base">
                    Channel Tone Profiles Comparison
                  </h3>
                  <p className="text-xs text-slate-500">
                    Deterministic code checks (T-03, T-05, T-06) across all 4 channels without AI calls
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCompareModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                aria-label="Close compare modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {compareNotice && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>{compareNotice}</span>
              </div>
            )}

            {isComparingChannels ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                <span className="text-xs font-semibold">Running deterministic channel checks...</span>
              </div>
            ) : compareResults ? (
              <div className="space-y-4">
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Evaluated Draft Text ({draftContent.length} chars)
                  </span>
                  <p className="text-xs font-mono text-slate-800 line-clamp-2">
                    "{draftContent}"
                  </p>
                </div>

                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <th className="py-2.5 px-3.5">Channel</th>
                        <th className="py-2.5 px-3.5">Tone Profile Limits</th>
                        <th className="py-2.5 px-3.5">Status</th>
                        <th className="py-2.5 px-3.5">Tone Findings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {compareResults.map((item) => {
                        const hasViolations = item.findings && item.findings.length > 0;
                        return (
                          <tr key={item.channel} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 px-3.5 font-bold text-slate-900 whitespace-nowrap">
                              {item.channel}
                            </td>
                            <td className="py-3 px-3.5 text-slate-600">
                              <div className="space-y-0.5 text-[11px]">
                                <div>Max '!': <strong>{item.profile.maxExclamationMarks}</strong></div>
                                <div>Max ALL-CAPS: <strong>{item.profile.maxAllCapsWords}</strong></div>
                                <div>
                                  Max Length: <strong>{item.profile.maxCharacters === 0 ? "No limit" : `${item.profile.maxCharacters} chars`}</strong>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3.5 whitespace-nowrap">
                              {hasViolations ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 inline-flex items-center gap-1 border border-red-200">
                                  <AlertTriangle className="w-3 h-3" />
                                  {item.findings.length} Finding{item.findings.length > 1 ? "s" : ""}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 inline-flex items-center gap-1 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Compliant
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3.5">
                              {hasViolations ? (
                                <div className="space-y-2">
                                  {item.findings.map((f, idx) => (
                                    <div key={idx} className="p-2 bg-red-50/60 border border-red-100 rounded-lg text-xs space-y-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-mono font-bold text-red-700 text-[10px] px-1.5 py-0.5 bg-red-100 rounded">
                                          {f.rule_id}
                                        </span>
                                        <span className="font-semibold text-slate-800 text-[11px]">
                                          "{f.quote}"
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-slate-600">
                                        {f.explanation}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">
                                  No tone or length violations for this channel.
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowCompareModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compliance Certificate Modal */}
      {viewingCertificateDraft && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm overflow-y-auto p-4 sm:p-6 flex items-start justify-center">
          <ComplianceCertificate
            draft={viewingCertificateDraft}
            certificate={viewingCertificateDraft.certificate}
            onClose={() => setViewingCertificateDraft(null)}
            onOpenVerify={(id) => {
              setViewingCertificateDraft(null);
              setVerifyCertId(id);
              window.history.pushState(null, "", `/verify/${id}`);
            }}
          />
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
