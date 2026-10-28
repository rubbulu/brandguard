import React, { useState, useMemo } from "react";
import { diffWordsWithSpace } from "diff";
import { Columns, AlignLeft, Info, CheckCircle2 } from "lucide-react";

/**
 * Visual-only or security rule IDs that must never be tagged on text redline diffs.
 */
function isVisualOrSecRule(ruleId) {
  if (!ruleId || typeof ruleId !== "string") return true;
  const upper = ruleId.trim().toUpperCase();
  if (upper.startsWith("V-") || upper.startsWith("SEC-") || upper === "SEC-01") return true;
  return ["V-01", "V-02", "V-03", "V-04", "SEC-01"].includes(upper);
}

/**
 * Normalizes leading and trailing whitespace from a change block
 * so that common whitespace is preserved in the baseline flow
 * rather than wrapped inside struck-through or inserted badges.
 */
function normalizeChangeBlock(change) {
  let rem = change.removed || "";
  let add = change.added || "";
  let leadSpace = "";
  let trailSpace = "";

  const leadMatch = rem.match(/^\s+/) && add.match(/^\s+/);
  if (leadMatch) {
    const commonLead = rem.match(/^\s+/)[0].length <= add.match(/^\s+/)[0].length
      ? rem.match(/^\s+/)[0]
      : add.match(/^\s+/)[0];
    leadSpace = commonLead;
    rem = rem.slice(commonLead.length);
    add = add.slice(commonLead.length);
  }

  const remTrail = rem.match(/\s+$/);
  const addTrail = add.match(/\s+$/);
  if (remTrail && addTrail) {
    const commonTrail = remTrail[0].length <= addTrail[0].length ? remTrail[0] : addTrail[0];
    trailSpace = commonTrail;
    rem = rem.slice(0, rem.length - commonTrail.length);
    add = add.slice(0, add.length - commonTrail.length);
  }

  return { leadSpace, rem, add, trailSpace };
}

/**
 * Merges consecutive or whitespace-interleaved diff tokens into
 * single whole phrase changes instead of word-by-word interleaving.
 */
function mergeDiffChunks(rawChunks) {
  const blocks = [];
  let currentChange = null;

  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];
    if (chunk.added || chunk.removed) {
      if (!currentChange) {
        currentChange = { removed: "", added: "" };
      }
      if (chunk.removed) currentChange.removed += chunk.value;
      if (chunk.added) currentChange.added += chunk.value;
    } else {
      const isWhitespace = /^\s+$/.test(chunk.value);
      const nextIsChange = i + 1 < rawChunks.length && (rawChunks[i + 1].added || rawChunks[i + 1].removed);

      if (currentChange && isWhitespace && nextIsChange) {
        currentChange.removed += chunk.value;
        currentChange.added += chunk.value;
      } else {
        if (currentChange) {
          blocks.push(currentChange);
          currentChange = null;
        }
        blocks.push({ value: chunk.value });
      }
    }
  }

  if (currentChange) {
    blocks.push(currentChange);
  }

  return blocks;
}

/**
 * Tags a changed block only with the rule ID of the accepted fix that caused it (e.g. R-12 or F-01).
 * Never tags text changes with visual-only rule IDs (V-01, V-02, V-03, SEC-01).
 */
function matchRuleForBlock(remText, addText, findings = []) {
  const accepted = (Array.isArray(findings) ? findings : []).filter(
    f => f && (f.status === "accepted" || f.status === "edited") && !isVisualOrSecRule(f.rule_id)
  );

  const cleanRem = (remText || "").trim().toLowerCase();
  const cleanAdd = (addText || "").trim().toLowerCase();

  // 1. Exact match on quote or suggested_fix
  for (const f of accepted) {
    const q = typeof f.quote === "string" ? f.quote.trim().toLowerCase() : "";
    const fix = typeof f.suggested_fix === "string" ? f.suggested_fix.trim().toLowerCase() : "";

    if (q && cleanRem && q === cleanRem) return f.rule_id;
    if (fix && cleanAdd && fix === cleanAdd) return f.rule_id;
  }

  // 2. Substring containment match
  for (const f of accepted) {
    const q = typeof f.quote === "string" ? f.quote.trim().toLowerCase() : "";
    const fix = typeof f.suggested_fix === "string" ? f.suggested_fix.trim().toLowerCase() : "";

    if (q && cleanRem && (cleanRem.includes(q) || q.includes(cleanRem))) return f.rule_id;
    if (fix && cleanAdd && (cleanAdd.includes(fix) || fix.includes(cleanAdd))) return f.rule_id;
  }

  return null;
}

/**
 * Computes phrase-level redline diff chunks between originalText and finalText.
 */
function computeRedlineChunks(originalText, finalText, findings) {
  const orig = typeof originalText === "string" ? originalText : String(originalText || "");
  const fin = typeof finalText === "string" ? finalText : String(finalText || "");

  if (!orig && !fin) return [];
  if (orig === fin) return [{ value: orig }];

  const rawChunks = diffWordsWithSpace(orig, fin);
  const mergedBlocks = mergeDiffChunks(rawChunks);

  const result = [];
  for (const block of mergedBlocks) {
    if (block.removed !== undefined || block.added !== undefined) {
      const norm = normalizeChangeBlock(block);
      if (norm.leadSpace) {
        if (result.length > 0 && !result[result.length - 1].added && !result[result.length - 1].removed) {
          result[result.length - 1].value += norm.leadSpace;
        } else {
          result.push({ value: norm.leadSpace });
        }
      }

      const ruleId = matchRuleForBlock(norm.rem, norm.add, findings);
      if (norm.rem) {
        result.push({ removed: true, value: norm.rem, ruleId });
      }
      if (norm.add) {
        result.push({ added: true, value: norm.add, ruleId });
      }

      if (norm.trailSpace) {
        result.push({ value: norm.trailSpace });
      }
    } else {
      if (result.length > 0 && !result[result.length - 1].added && !result[result.length - 1].removed) {
        result[result.length - 1].value += block.value;
      } else {
        result.push(block);
      }
    }
  }
  return result;
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
      return computeRedlineChunks(originalText, finalText, findings);
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
