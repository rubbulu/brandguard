import React, { useState, useEffect } from "react";
import QRCode from "qrcode";
import {
  ShieldCheck,
  Printer,
  Copy,
  Check,
  ExternalLink,
  Calendar,
  User,
  Cpu,
  FileCheck,
  Hash,
  AlertCircle,
  FileText,
  Sparkles,
  ArrowLeft
} from "lucide-react";
import RedlineDiff from "./RedlineDiff";

export default function ComplianceCertificate({
  certificate,
  draft,
  onClose,
  onOpenVerify
}) {
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedSig, setCopiedSig] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const cert = certificate || draft?.certificate;
  const verifyUrl = cert
    ? `${window.location.origin}/verify/${cert.certificateId}`
    : "";

  useEffect(() => {
    if (verifyUrl) {
      QRCode.toDataURL(verifyUrl, {
        width: 140,
        margin: 1,
        color: { dark: "#0F172A", light: "#FFFFFF" }
      })
        .then(setQrDataUrl)
        .catch(err => console.warn("[QR Code Error]:", err));
    }
  }, [verifyUrl]);

  if (!cert) {
    return (
      <div className="p-8 text-center text-slate-400">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-slate-200">Certificate Not Available</h3>
        <p className="text-sm mt-1">This draft has not been approved for publication yet.</p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-slate-800 text-slate-200 text-sm rounded-lg hover:bg-slate-700"
          >
            Back to Draft
          </button>
        )}
      </div>
    );
  }

  const handleCopy = (text, type) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      if (type === "hash") {
        setCopiedHash(true);
        setTimeout(() => setCopiedHash(false), 2000);
      } else if (type === "sig") {
        setCopiedSig(true);
        setTimeout(() => setCopiedSig(false), 2000);
      } else if (type === "link") {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="certificate-modal-container max-w-4xl mx-auto my-6 p-4">
      {/* Action / Toolbar (Hidden during Print) */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        <div className="flex items-center gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Draft</span>
            </button>
          )}
          <span className="text-sm text-slate-400 hidden sm:inline">
            Status: <span className="text-emerald-400 font-semibold">Approved (v{cert.version})</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onOpenVerify ? (
            <button
              onClick={() => onOpenVerify(cert.certificateId)}
              className="flex items-center gap-1.5 text-xs sm:text-sm font-medium bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 px-3 py-2 rounded-lg border border-slate-700 transition"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open Public /verify</span>
            </button>
          ) : (
            <a
              href={`/verify/${cert.certificateId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs sm:text-sm font-medium bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 px-3 py-2 rounded-lg border border-slate-700 transition"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open Public /verify</span>
            </a>
          )}

          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg shadow-md transition"
          >
            <Printer className="w-4 h-4" />
            <span>Download / Print PDF</span>
          </button>
        </div>
      </div>

      {/* A4 Printable Certificate Document Sheet */}
      <div className="certificate-sheet bg-white text-slate-900 p-8 sm:p-12 rounded-2xl shadow-2xl border border-slate-300 relative print:p-0 print:border-none print:shadow-none print:rounded-none">
        
        {/* Certificate Watermark / Header Seal */}
        <div className="border-b-2 border-slate-900 pb-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-blue-700 font-bold text-xs uppercase tracking-widest mb-1">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                <span>BrandGuard Governance Authority</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                Compliance Verification Certificate
              </h1>
              <p className="text-xs text-slate-600 mt-1">
                Pre-Publication Brand Governance Record &bull; Tamper-Evident Server Signed
              </p>
            </div>

            {/* Integrity Badge */}
            <div className="flex flex-col items-end">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                INTEGRITY-VERIFIED
              </span>
              <span className="text-[11px] font-mono text-slate-500 mt-1">
                ID: {cert.certificateId.slice(0, 18)}...
              </span>
            </div>
          </div>
        </div>

        {/* Certificate Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs mb-6">
          <div>
            <span className="text-slate-500 block">Draft Title</span>
            <span className="font-semibold text-slate-900 block truncate" title={cert.title}>
              {cert.title}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Version & Channel</span>
            <span className="font-semibold text-slate-900 block">
              v{cert.version} &bull; {cert.channel}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Approved Date (UTC)</span>
            <span className="font-semibold text-slate-900 block">
              {new Date(cert.approvedAt).toLocaleDateString()} {new Date(cert.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Sign-off Reviewer</span>
            <span className="font-semibold text-slate-900 block">
              {cert.reviewerLabel}
            </span>
          </div>
        </div>

        {/* Findings Summary Stats */}
        <div className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Governance Audit Findings Summary
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
            <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200">
              <div className="text-slate-500 text-[11px]">Flagged Findings</div>
              <div className="text-base font-bold text-slate-800">{cert.findingsSummary?.kept || 0}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-emerald-700 text-[11px]">Accepted Fixes</div>
              <div className="text-base font-bold text-emerald-800">{cert.findingsSummary?.accepted || 0}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-blue-700 text-[11px]">Edited Fixes</div>
              <div className="text-base font-bold text-blue-800">{cert.findingsSummary?.edited || 0}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200">
              <div className="text-slate-500 text-[11px]">Rejected Findings</div>
              <div className="text-base font-bold text-slate-800">{cert.findingsSummary?.rejected || 0}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 col-span-2 sm:col-span-1">
              <div className="text-amber-700 text-[11px]">Validator Filtered</div>
              <div className="text-base font-bold text-amber-800">{cert.findingsSummary?.dropped_by_validator || 0}</div>
            </div>
          </div>
        </div>

        {/* Redline Diff Section (Original vs Final Approved Copy) */}
        <div className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Redline Diff (Original Submission vs Final Approved Copy)
          </h2>
          <div className="border border-slate-300 rounded-xl overflow-hidden bg-slate-50 text-slate-900">
            <RedlineDiff
              originalText={draft?.originalText || cert.finalText}
              finalText={cert.finalText}
              findings={draft?.findings || []}
              title="Approved Changes & Policy Links"
              defaultMode="inline"
              showToggle={false}
              className="bg-transparent border-0 text-slate-900"
            />
          </div>
        </div>

        {/* Final Approved Copy Full Display */}
        <div className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Final Approved Publication Copy
          </h2>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-900 whitespace-pre-wrap font-sans leading-relaxed">
            {cert.finalText}
          </div>
        </div>

        {/* Reviewer Note */}
        {cert.reviewerNote && (
          <div className="mb-6 p-4 rounded-xl bg-blue-50/60 border border-blue-200 text-xs">
            <span className="font-bold text-blue-900 block mb-1">Reviewer Sign-off Note:</span>
            <p className="italic text-blue-950">&ldquo;{cert.reviewerNote}&rdquo;</p>
          </div>
        )}

        {/* Audited Policies & Facts */}
        <div className="mb-6 text-xs">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Policies & Approved Facts Verified
          </h2>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-slate-500 font-medium">Rules Evaluated:</span>
              {(cert.rulesChecked || []).map(r => (
                <span key={r.id} className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[11px] font-semibold" title={r.text}>
                  {r.id}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-slate-500 font-medium">Facts Cross-Referenced:</span>
              {(cert.factsChecked || []).map(fId => (
                <span key={fId} className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono text-[11px] font-semibold">
                  {fId}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Cryptographic Verification & QR Section */}
        <div className="cert-signed-box p-5 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 mb-6 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="space-y-3 flex-1 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-wider text-[11px]">
              <FileCheck className="w-4 h-4" />
              <span>Tamper-Evident Server Signed Record</span>
            </div>

            {/* SHA-256 Content Hash */}
            <div>
              <span className="text-slate-400 block text-[11px] mb-0.5">Payload Content Hash (SHA-256)</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-[11px] text-slate-300 bg-slate-950 px-2 py-1 rounded border border-slate-800 break-all select-all">
                  {cert.contentHash}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(cert.contentHash, "hash")}
                  className="no-print p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="Copy SHA-256 Hash"
                >
                  {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* HMAC-SHA256 Server Signature */}
            <div>
              <span className="text-slate-400 block text-[11px] mb-0.5">Server Signature (HMAC-SHA256)</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-[11px] text-emerald-400 bg-slate-950 px-2 py-1 rounded border border-slate-800 break-all select-all">
                  {cert.signature}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(cert.signature, "sig")}
                  className="no-print p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="Copy HMAC-SHA256 Signature"
                >
                  {copiedSig ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Public Link */}
            <div className="pt-1">
              <span className="text-slate-400 text-[11px]">Public Verification URL: </span>
              <a
                href={verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline hover:text-blue-300 break-all text-[11px]"
              >
                {verifyUrl}
              </a>
            </div>
          </div>

          {/* QR Code */}
          {qrDataUrl && (
            <div className="cert-qr-box flex flex-col items-center bg-white p-2.5 rounded-xl shadow border border-slate-300 text-slate-900">
              <img src={qrDataUrl} alt="Verify QR Code" className="w-28 h-28" />
              <span className="text-[10px] font-semibold text-slate-700 mt-1 uppercase tracking-wider">
                Scan to Verify
              </span>
            </div>
          )}
        </div>

        {/* AI Tools Disclosure */}
        <div className="text-[11px] text-slate-500 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-start gap-2">
          <Cpu className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-bold text-slate-700">AI & Governance Tools Disclosure: </span>
            <span>{cert.aiToolsDisclosure} Model: {cert.aiModel}.</span>
          </div>
        </div>

        {/* Mandatory Footnote */}
        <div className="border-t border-slate-300 pt-4 text-center">
          <p className="text-[11px] text-slate-500 italic">
            &ldquo;{cert.footnote}&rdquo;
          </p>
        </div>

      </div>
    </div>
  );
}
