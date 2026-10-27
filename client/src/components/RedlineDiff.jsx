import React, { useState, useMemo } from "react";
import { diffWordsWithSpace } from "diff";
import { Columns, AlignLeft, Info, CheckCircle2 } from "lucide-react";

/**
 * Associates diff changes with causing Rule IDs from findings
 */
function matchRuleIdForChunk(chunkValue, isRemoved, findings = []) {
  if (!chunkValue || typeof chunkValue !== "string" || !chunkValue.trim()) return null;
  const cleanChunk = chunkValue.trim().toLowerCase();
  if (!Array.isArray(findings)) return null;

  for (const f of findings) {
    if (!f || !f.rule_id) continue;
    if (isRemoved) {
      const q = typeof f.quote === "string" ? f.quote.trim().toLowerCase() : "";
      if (q && !q.startsWith("(") && (q.includes(cleanChunk) || cleanChunk.includes(q))) {
        return f.rule_id;
      }
    } else {
      const fix = typeof f.suggested_fix === "string" ? f.suggested_fix.trim().toLowerCase() : "";
      if (fix && (fix.includes(cleanChunk) || cleanChunk.includes(fix))) {
        return f.rule_id;
      }
    }
  }
  return null;
}

export default function RedlineDiff({
  originalText = "",
  finalText = "",
  findings = [],
  defaultMode = "inline",
  showToggle = true,
  title = "Redline Revision Diff",
  className = ""
}) {
  const [diffMode, setDiffMode] = useState(defaultMode); // 'inline' | 'side-by-side'

  const diffChunks = useMemo(() => {
    try {
      const orig = typeof originalText === "string" ? originalText : String(originalText || "");
      const fin = typeof finalText === "string" ? finalText : String(finalText || "");
      if (!orig && !fin) return [];
      const chunks = diffWordsWithSpace(orig, fin);
      const safeFindings = Array.isArray(findings) ? findings : [];
      return chunks.map(chunk => {
        const ruleId = chunk.removed
          ? matchRuleIdForChunk(chunk.value, true, safeFindings)
          : chunk.added
          ? matchRuleIdForChunk(chunk.value, false, safeFindings)
          : null;
        return { ...chunk, ruleId };
      });
    } catch (err) {
      console.warn("[RedlineDiff Computation Warning]:", err);
      return [];
    }
  }, [originalText, finalText, findings]);

  const hasChanges = useMemo(() => {
    return diffChunks.some(c => c.added || c.removed);
  }, [diffChunks]);

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${className}`}>
      {/* Header bar with Mode Toggle & Legend */}
      <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200 text-sm">{title}</span>
          {hasChanges ? (
            <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium">
              Modifications Applied
            </span>
          ) : (
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Identical Copy
            </span>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="inline-block w-2.5 h-2.5 rounded bg-red-500/30 border border-red-500/50"></span>
            <span className="line-through text-red-300">Original Removed</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="inline-block w-2.5 h-2.5 rounded bg-emerald-500/30 border border-emerald-500/50"></span>
            <span className="underline decoration-emerald-400 text-emerald-300">Fix Inserted</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-mono border border-indigo-500/30">
              [RULE-ID]
            </span>
            <span>Causing Policy</span>
          </span>

          {showToggle && (
            <div className="flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-slate-700 ml-2">
              <button
                type="button"
                onClick={() => setDiffMode("inline")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  diffMode === "inline"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Inline unified redline view"
              >
                <AlignLeft className="w-3.5 h-3.5" />
                <span>Inline</span>
              </button>
              <button
                type="button"
                onClick={() => setDiffMode("side-by-side")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  diffMode === "side-by-side"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Side by side comparison"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Side by Side</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Diff Content Body */}
      <div className="p-4 text-sm leading-relaxed font-sans">
        {diffMode === "inline" ? (
          /* Inline View */
          <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800/80 text-slate-300 whitespace-pre-wrap select-text">
            {diffChunks.map((part, index) => {
              if (part.removed) {
                return (
                  <span
                    key={`rem-${index}`}
                    className="bg-red-950/60 text-red-300 line-through decoration-red-500/80 px-1 py-0.5 rounded mx-0.5 border border-red-800/40 inline-flex items-center gap-1"
                  >
                    <span>{part.value}</span>
                    {part.ruleId && (
                      <span className="not-italic inline-block text-[10px] font-mono font-bold bg-red-900/80 text-red-200 px-1 py-0.2 rounded border border-red-700/50">
                        [{part.ruleId}]
                      </span>
                    )}
                  </span>
                );
              }
              if (part.added) {
                return (
                  <span
                    key={`add-${index}`}
                    className="bg-emerald-950/60 text-emerald-200 underline decoration-emerald-500 decoration-2 px-1 py-0.5 rounded mx-0.5 border border-emerald-800/40 inline-flex items-center gap-1 font-medium"
                  >
                    <span>{part.value}</span>
                    {part.ruleId && (
                      <span className="inline-block text-[10px] font-mono font-bold bg-emerald-900/80 text-emerald-200 px-1 py-0.2 rounded border border-emerald-700/50">
                        [{part.ruleId}]
                      </span>
                    )}
                  </span>
                );
              }
              return <span key={`norm-${index}`}>{part.value}</span>;
            })}
          </div>
        ) : (
          /* Side by Side View */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Original Copy */}
            <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800/80">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 pb-1.5 border-b border-slate-800 flex items-center justify-between">
                <span>Original Submitted Copy</span>
                <span className="text-[10px] text-red-400 font-mono">Deletions highlighted</span>
              </div>
              <div className="text-slate-300 whitespace-pre-wrap select-text leading-relaxed">
                {diffChunks.map((part, index) => {
                  if (part.removed) {
                    return (
                      <span
                        key={`sb-rem-${index}`}
                        className="bg-red-950/60 text-red-300 line-through decoration-red-500 px-1 py-0.5 rounded mx-0.5 border border-red-800/40"
                      >
                        {part.value}
                        {part.ruleId && (
                          <span className="ml-1 text-[10px] font-mono font-bold text-red-400">
                            [{part.ruleId}]
                          </span>
                        )}
                      </span>
                    );
                  }
                  if (part.added) {
                    // Omit added chunks in original view
                    return null;
                  }
                  return <span key={`sb-norm-orig-${index}`}>{part.value}</span>;
                })}
              </div>
            </div>

            {/* Right: Final Approved Copy */}
            <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800/80">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 pb-1.5 border-b border-slate-800 flex items-center justify-between">
                <span>Final Compliant Copy</span>
                <span className="text-[10px] text-emerald-400 font-mono">Additions highlighted</span>
              </div>
              <div className="text-slate-300 whitespace-pre-wrap select-text leading-relaxed">
                {diffChunks.map((part, index) => {
                  if (part.added) {
                    return (
                      <span
                        key={`sb-add-${index}`}
                        className="bg-emerald-950/60 text-emerald-200 underline decoration-emerald-500 px-1 py-0.5 rounded mx-0.5 border border-emerald-800/40 font-medium"
                      >
                        {part.value}
                        {part.ruleId && (
                          <span className="ml-1 text-[10px] font-mono font-bold text-emerald-300">
                            [{part.ruleId}]
                          </span>
                        )}
                      </span>
                    );
                  }
                  if (part.removed) {
                    // Omit removed chunks in final view
                    return null;
                  }
                  return <span key={`sb-norm-final-${index}`}>{part.value}</span>;
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
