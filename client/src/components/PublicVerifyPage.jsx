import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  FileCheck,
  Hash,
  KeyRound,
  ExternalLink,
  Bug,
  RotateCcw,
  BookOpen,
  ArrowLeft
} from "lucide-react";

export default function PublicVerifyPage({ certificateId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tampering, setTampering] = useState(false);

  const fetchVerification = async () => {
    if (!certificateId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/${certificateId}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
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
        <p className="text-xs text-slate-500 mt-1">Recomputing SHA-256 payload hash and server HMAC signature</p>
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

  const cert = data?.certificate;
  const isVerified = data?.verified === true;

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
          <span className="text-xs text-slate-500">Public Independent Verification Portal</span>
        </div>

        {/* Main Verdict Card */}
        <div
          className={`p-6 sm:p-8 rounded-2xl border shadow-2xl transition-all ${
            isVerified
              ? "bg-slate-900/90 border-emerald-500/40 shadow-emerald-950/20"
              : "bg-slate-900/90 border-red-500/50 shadow-red-950/30"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div className="flex items-start gap-4">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  isVerified ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"
                }`}
              >
                {isVerified ? (
                  <ShieldCheck className="w-8 h-8" />
                ) : (
                  <ShieldAlert className="w-8 h-8" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-extrabold text-white">
                    {isVerified ? "VERIFIED" : "NOT VERIFIED"}
                  </h1>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      isVerified
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-red-500/20 text-red-300 border border-red-500/30"
                    }`}
                  >
                    {isVerified ? "Integrity-Verified" : "Tamper Detected"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Verification Type: <span className="text-slate-300 font-medium">tamper-evident (signed by the server)</span>
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
            {isVerified ? (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs sm:text-sm leading-relaxed flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Integrity Verification Succeeded</span>
                  <span>{data.message}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs sm:text-sm leading-relaxed flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Integrity Verification Failed</span>
                  <span>{data.reason}</span>
                </div>
              </div>
            )}
          </div>

          {/* Tamper Test Interactive Demo Tool */}
          <div className="mt-6 p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
                <Bug className="w-4 h-4" />
                <span>Hackathon Demo: Tamper Evident Proof Test</span>
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
                  <span className="text-slate-500 block text-[11px]">Approval Timestamp (Server)</span>
                  <span className="text-slate-200 font-semibold">
                    {new Date(cert.approvedAt).toUTCString()}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Sign-off Reviewer</span>
                  <span className="text-slate-200 font-semibold">{cert.reviewerLabel}</span>
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
                  <span className="font-bold text-slate-300">Key Facts Cross-Referenced & Verified</span>
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
