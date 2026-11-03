import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  FileCheck,
  FileText,
  Upload,
  Download,
  Hash,
  KeyRound,
  ExternalLink,
  Bug,
  RotateCcw,
  BookOpen,
  ArrowLeft,
  Palette
} from "lucide-react";

export default function PublicVerifyPage({ certificateId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFoundInfo, setNotFoundInfo] = useState(null);
  const [tampering, setTampering] = useState(false);
  const [pastedJson, setPastedJson] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [isVerifyingPasted, setIsVerifyingPasted] = useState(false);

  const cert = data?.certificate;
  const isVerified = data?.verified === true;
  const isOverride = cert?.status === "Issued with override" || Boolean(cert?.securityOverride);

  const handleDownloadJson = () => {
    const certToDownload = cert || data?.certificate;
    if (!certToDownload) return;
    const downloadId = certificateId || certToDownload.certificateId || "certificate";
    const blob = new Blob([JSON.stringify(certToDownload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const verifyCertPayload = async (certObj) => {
    setIsVerifyingPasted(true);
    setPasteError("");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificate: certObj })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Server returned ${res.status}`);
      }
      setData(json);
      setNotFoundInfo(null);
      setError(null);
      if (certObj.certificateId) {
        try {
          localStorage.setItem(`brandguard_cert_${certObj.certificateId}`, JSON.stringify(certObj));
        } catch (_) {}
      }
    } catch (err) {
      setPasteError(err.message || "Failed to verify certificate payload");
    } finally {
      setIsVerifyingPasted(false);
    }
  };

  const handlePasteSubmit = () => {
    if (!pastedJson.trim()) {
      setPasteError("Please paste certificate JSON content.");
      return;
    }
    try {
      const parsed = JSON.parse(pastedJson.trim());
      verifyCertPayload(parsed);
    } catch (e) {
      setPasteError("Invalid JSON format. Please ensure you pasted the full certificate JSON.");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result;
        const parsed = JSON.parse(text);
        await verifyCertPayload(parsed);
      } catch (err) {
        setPasteError("Invalid JSON file. Please select a valid BrandGuard certificate JSON file.");
      }
    };
    reader.readAsText(file);
  };

  const fetchVerification = async () => {
    if (!certificateId) return;
    setLoading(true);
    setError(null);
    setNotFoundInfo(null);
    try {
      const res = await fetch(`/api/verify/${certificateId}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 404 || errJson.notFound) {
          // Check local storage fallback
          let cached = null;
          try {
            cached = localStorage.getItem(`brandguard_cert_${certificateId}`);
          } catch (_) {}
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              await verifyCertPayload(parsed);
              return;
            } catch (_) {}
          }
          setNotFoundInfo(
            errJson.message ||
            errJson.error ||
            "This record is no longer stored on this server. Certificates are tamper-evident and signed by the server, but the free demo disk resets. Re-issue or paste the certificate file."
          );
          return;
        }
        throw new Error(errJson.error || errJson.reason || `Server returned ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("[Verify Error]:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVerification();
  }, [certificateId]);

  const handleTamperTest = async () => {
    setTampering(true);
    try {
      const res = await fetch(`/api/certificates/${certificateId}/tamper`, {
        method: "POST"
      });
      if (res.ok) {
        await fetchVerification();
      }
    } catch (e) {
      console.error("Tamper test failed:", e);
    } finally {
      setTampering(false);
    }
  };

  const handleRestoreRecord = async () => {
    setTampering(true);
    try {
      const res = await fetch(`/api/certificates/${certificateId}/restore`, {
        method: "POST"
      });
      if (res.ok) {
        await fetchVerification();
      }
    } catch (e) {
      console.error("Restore failed:", e);
    } finally {
      setTampering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-300">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <h2 className="text-lg font-semibold">Verifying Integrity with BrandGuard Server...</h2>
        <p className="text-xs text-slate-500 mt-1">Recomputing SHA-256 payload hash, copy digest, and server HMAC signature</p>
      </div>
    );
  }

  // Friendly not-found screen when record was cleared by server restart
  if (notFoundInfo) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 py-10 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            {onBack ? (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to BrandGuard Platform</span>
              </button>
            ) : (
              <a
                href="/"
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Open BrandGuard Platform</span>
              </a>
            )}
            <div className="flex items-center gap-2">
            {cert && (
              <button
                onClick={handleDownloadJson}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition border border-slate-700"
                title="Download full signed certificate JSON record"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                <span>Download Certificate JSON</span>
              </button>
            )}
            <span className="text-xs text-slate-500">Public Independent Verification Portal</span>
          </div>
          </div>

          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-6 sm:p-8 shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white text-center">Certificate Record Not Stored on Disk</h2>
            <p className="text-sm text-slate-300 text-center mt-3 leading-relaxed">
              {notFoundInfo}
            </p>

            {/* Offline Verification Box: Paste or Upload Certificate */}
            <div className="mt-6 pt-6 border-t border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-400" />
                <span>Verify Offline or Exported Certificate Record</span>
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                BrandGuard certificates are self-contained and cryptographically signed. If you saved the certificate JSON or link payload, paste it below to verify server HMAC signature directly.
              </p>

              <textarea
                value={pastedJson}
                onChange={(e) => setPastedJson(e.target.value)}
                placeholder="Paste certificate JSON content here (starts with { &quot;certificateId&quot;: ... })"
                className="w-full h-32 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />

              {pasteError && (
                <p className="text-xs text-red-400 mt-2">{pasteError}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={handlePasteSubmit}
                  disabled={isVerifyingPasted}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isVerifyingPasted ? "Verifying..." : "Verify Pasted JSON"}</span>
                </button>

                <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold cursor-pointer transition flex items-center gap-1.5 border border-slate-700">
                  <Upload className="w-4 h-4" />
                  <span>Upload .json File</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <button
                  onClick={fetchVerification}
                  className="px-3 py-2 bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl text-xs transition ml-auto"
                >
                  Retry Server
                </button>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/80 flex justify-center">
              {onBack ? (
                <button
                  onClick={onBack}
                  className="text-xs text-blue-400 hover:underline"
                >
                  Return to Content Reviewer to Re-issue
                </button>
              ) : (
                <a
                  href="/#/reviewer"
                  className="text-xs text-blue-400 hover:underline"
                >
                  Open BrandGuard Content Reviewer
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-300">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-2xl p-6 text-center shadow-xl">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white">Certificate Verification Failed</h2>
          <p className="text-sm text-red-400 mt-2">{error}</p>
          <div className="mt-6 flex justify-center gap-3">
            {onBack ? (
              <button
                onClick={onBack}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm"
              >
                Back to BrandGuard
              </button>
            ) : (
              <a
                href="/"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm"
              >
                Go to BrandGuard Home
              </a>
            )}
            <button
              onClick={fetchVerification}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
            >
              Retry Check
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Back Link */}
        <div className="flex items-center justify-between">
          {onBack ? (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to BrandGuard Platform</span>
            </button>
          ) : (
            <a
              href="/"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Open BrandGuard Platform</span>
            </a>
          )}
          <div className="flex items-center gap-2">
            {cert && (
              <button
                onClick={handleDownloadJson}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition border border-slate-700"
                title="Download full signed certificate JSON record"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                <span>Download Certificate JSON</span>
              </button>
            )}
            <span className="text-xs text-slate-500">Public Independent Verification Portal</span>
          </div>
        </div>

        {/* Main Verdict Card */}
        <div
          className={`p-6 sm:p-8 rounded-2xl border shadow-2xl transition-all ${
            !isVerified
              ? "bg-slate-900/90 border-red-500/50 shadow-red-950/30"
              : isOverride
              ? "bg-slate-900/90 border-amber-500/50 shadow-amber-950/30"
              : "bg-slate-900/90 border-emerald-500/40 shadow-emerald-950/20"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div className="flex items-start gap-4">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  !isVerified
                    ? "bg-red-500/10 text-red-400 border border-red-500/30"
                    : isOverride
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                }`}
              >
                {!isVerified ? (
                  <ShieldAlert className="w-8 h-8" />
                ) : isOverride ? (
                  <AlertTriangle className="w-8 h-8" />
                ) : (
                  <ShieldCheck className="w-8 h-8" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-extrabold text-white">
                    {isVerified ? (isOverride ? "ISSUED WITH OVERRIDE" : "VERIFIED") : "NOT VERIFIED"}
                  </h1>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      !isVerified
                        ? "bg-red-500/20 text-red-300 border border-red-500/30"
                        : isOverride || cert?.status === "Reviewed by code checks only"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    }`}
                  >
                    {!isVerified ? "Tamper Detected" : (isOverride ? "Issued with override" : (cert?.status || "Compliant"))}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Verification Type: <span className="text-slate-300 font-medium">tamper-evident, signed by the server</span>
                </p>
              </div>
            </div>

            {/* Re-verify Button */}
            <button
              onClick={fetchVerification}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 transition"
              title="Re-verify signature"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Re-check</span>
            </button>
          </div>

          {/* Status Message */}
          <div className="mt-6">
            {!isVerified ? (
              <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs sm:text-sm leading-relaxed flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Integrity Verification Failed</span>
                  <span>{data?.reason || "Integrity verification failed"}</span>
                </div>
              </div>
            ) : isOverride ? (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs sm:text-sm leading-relaxed flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Issued with Override: Security Finding Overridden</span>
                  <span>{cert?.securityOverride || "Security finding overridden by creator"}. Stored certificate record and signature are tamper-evident, signed by the server.</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs sm:text-sm leading-relaxed flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Integrity Verification Succeeded</span>
                  <span>{data?.message || "Integrity verification succeeded"}</span>
                </div>
              </div>
            )}
          </div>

          {/* Tamper Test Interactive Demo Tool */}
          <div className="mt-6 p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
                <Bug className="w-4 h-4" />
                <span>Hackathon Demo: Tamper-Evident Proof Test</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Simulate an adversary altering 1 character in the approved record to observe instant signature verification failure.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {cert?.isTampered ? (
                <button
                  type="button"
                  onClick={handleRestoreRecord}
                  disabled={tampering}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore Original Record</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleTamperTest}
                  disabled={tampering}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow transition"
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Tamper Test (Alter 1 Char)</span>
                </button>
              )}
            </div>
          </div>

          {/* Details Grid */}
          {cert && (
            <div className="mt-6 space-y-4 text-xs">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Stored Governance Certificate Record
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Certificate Identifier</span>
                  <code className="text-blue-400 font-mono font-semibold break-all">{cert.certificateId}</code>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Draft & Version</span>
                  <span className="text-slate-200 font-semibold">{cert.title} (v{cert.version})</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Tone Profile Channel</span>
                  <span className="text-slate-200 font-semibold">{cert.channel || "Web / Campaign"}</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Approval Timestamp (Server)</span>
                  <span className="text-slate-200 font-semibold">
                    {new Date(cert.approvedAt).toUTCString()}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Sign-off Reviewer</span>
                  <span className="text-slate-200 font-semibold">{cert.reviewerLabel}</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Governance Status</span>
                  <span className={`font-semibold ${isOverride ? "text-amber-400" : "text-emerald-400"}`}>
                    {cert.status || "Compliant"}
                  </span>
                </div>
              </div>

              {/* Final Stored Text */}
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-500 block text-[11px] mb-1 font-semibold uppercase">
                  Approved Publication Copy
                </span>
                <p className="text-slate-300 font-sans whitespace-pre-wrap leading-relaxed select-text">
                  {cert.finalText}
                </p>
              </div>

              {/* Final Copy Hash (finalTextHash) */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 font-mono">
                <span className="text-slate-500 block text-[11px] mb-0.5">Final Copy SHA-256 Digest (finalTextHash)</span>
                <code className="text-emerald-400 break-all select-all text-xs">{cert.finalTextHash}</code>
              </div>

              {/* Design Instructions List (designInstructions) */}
              {cert.designInstructions && cert.designInstructions.length > 0 && (
                <div className="p-4 bg-purple-950/30 rounded-xl border border-purple-900/40 text-purple-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Palette className="w-4 h-4 text-purple-400" />
                    <span className="font-bold text-purple-300 uppercase tracking-wider text-[11px]">
                      Design changes required ({cert.designInstructions.length})
                    </span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {cert.designInstructions.map((instruction, idx) => (
                      <li key={idx} className="text-slate-300">
                        {instruction}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Findings Evaluated List (findingsList) */}
              {cert.findingsList && cert.findingsList.length > 0 && (
                <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-400 font-bold block mb-2 text-[11px] uppercase tracking-wider">
                    Evaluated Findings ({cert.findingsList.length})
                  </span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {cert.findingsList.map((f, idx) => (
                      <div key={idx} className="p-2 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-400 bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                            {f.rule_id} (v{f.ruleVersion})
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300">
                            {f.type}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold capitalize px-2 py-0.5 rounded ${
                          f.status === "accepted" ? "bg-emerald-950 text-emerald-300 border border-emerald-800" :
                          f.status === "edited" ? "bg-blue-950 text-blue-300 border border-blue-800" :
                          "bg-rose-950 text-rose-300 border border-rose-800"
                        }`}>
                          {f.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviewer Note */}
              {cert.reviewerNote && (
                <div className="p-3 bg-blue-950/30 rounded-xl border border-blue-900/40 text-blue-200">
                  <span className="text-blue-400 block text-[11px] font-semibold">Reviewer Sign-off Note:</span>
                  <p className="italic text-xs mt-0.5">&ldquo;{cert.reviewerNote}&rdquo;</p>
                </div>
              )}

              {/* Key Facts Checked */}
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-slate-300">Key Facts Cross-Referenced &amp; Verified</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(cert.factsChecked || []).map(fId => (
                    <span
                      key={fId}
                      className="px-2.5 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-mono text-xs font-semibold"
                    >
                      {fId}
                    </span>
                  ))}
                  {(!cert.factsChecked || cert.factsChecked.length === 0) && (
                    <span className="text-slate-500 text-xs">No specific facts cross-referenced.</span>
                  )}
                </div>
              </div>

              {/* Signature Comparison */}
              <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 font-mono space-y-2 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Expected Server Signature:</span>
                  <code className="text-emerald-400 break-all select-all">{cert.signature}</code>
                </div>
                <div>
                  <span className="text-slate-500 block">Recomputed Server Signature:</span>
                  <code className={isVerified ? "text-emerald-400 break-all select-all" : "text-red-400 break-all select-all font-bold"}>
                    {data.recomputedSignature || "(signature calculation error)"}
                  </code>
                </div>
              </div>
            </div>
          )}

          {/* Mandatory Footnote */}
          <div className="mt-8 pt-4 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-500 italic">
              &ldquo;This certificate proves the stored record has not changed since approval. It does not replace legal review.&rdquo;
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
