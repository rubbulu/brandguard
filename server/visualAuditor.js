import sharp from "sharp";
import path from "path";
import fs from "fs";
import { callGeminiReview, ACTIVE_MODEL, CANDIDATE_MODELS } from "./geminiService.js";
import { validateFindings, mergeFindings } from "./validator.js";
import { getWorkspaceImagesDir } from "./workspaceStore.js";
import { detectPromptInjection } from "./securityScanner.js";

// --- Color Math Helpers (CIE Lab & WCAG) ---

function hexToRgb(hex) {
  const clean = hex.replace("#", "").trim();
  const num = parseInt(clean, 16);
  if (clean.length === 3) {
    const r = ((num >> 8) & 0xf) * 17;
    const g = ((num >> 4) & 0xf) * 17;
    const b = (num & 0xf) * 17;
    return [r, g, b];
  }
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map(x => {
        const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
      .toUpperCase()
  );
}

function rgbToXyz(r, g, b) {
  const [rL, gL, bL] = [r / 255, g / 255, b / 255].map(v =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  const x = (rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375) / 0.95047;
  const y = (rL * 0.2126729 + gL * 0.7151522 + bL * 0.072175) / 1.0;
  const z = (rL * 0.0193339 + gL * 0.119192 + bL * 0.9503041) / 1.08883;
  return [x, y, z];
}

function xyzToLab(x, y, z) {
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function labDistance(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1[0] - lab2[0], 2) +
      Math.pow(lab1[1] - lab2[1], 2) +
      Math.pow(lab1[2] - lab2[2], 2)
  );
}

function getRelativeLuminance(r, g, b) {
  const [rL, gL, bL] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

function getContrastRatio(rgb1, rgb2) {
  const l1 = getRelativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const l2 = getRelativeLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Item 2: Median colour of pixels in the padded box, ignore anti-aliased pixels,
// text colour as the cluster farthest from background
function estimateTextAndBgWithMedian(sampledPixels) {
  if (!sampledPixels || sampledPixels.length < 2) return null;

  // 1. Initial 2-cluster separation by luminance
  let c1 = 0.1, c2 = 0.9;
  for (let iter = 0; iter < 4; iter++) {
    const g1 = [], g2 = [];
    for (const p of sampledPixels) {
      if (Math.abs(p.lum - c1) <= Math.abs(p.lum - c2)) g1.push(p.lum);
      else g2.push(p.lum);
    }
    if (g1.length) c1 = g1.reduce((s, v) => s + v, 0) / g1.length;
    if (g2.length) c2 = g2.reduce((s, v) => s + v, 0) / g2.length;
  }

  const group1 = sampledPixels.filter(p => Math.abs(p.lum - c1) <= Math.abs(p.lum - c2));
  const group2 = sampledPixels.filter(p => Math.abs(p.lum - c1) > Math.abs(p.lum - c2));
  const bgGroup = group1.length >= group2.length ? group1 : group2;

  // Background is median of majority pixels in padded box
  const bgR = median(bgGroup.map(p => p.r));
  const bgG = median(bgGroup.map(p => p.g));
  const bgB = median(bgGroup.map(p => p.b));
  const bgHex = rgbToHex(bgR, bgG, bgB);
  const bgLum = getRelativeLuminance(bgR, bgG, bgB);

  // Ignore anti-aliased pixels: calculate distance of each pixel from median background
  const withDist = sampledPixels.map(p => ({
    ...p,
    dist: Math.abs(p.lum - bgLum)
  })).sort((a, b) => b.dist - a.dist);

  const maxDist = withDist[0]?.dist || 0;
  if (maxDist < 0.08) {
    // Monochrome box
    return {
      textRgb: [bgR, bgG, bgB],
      bgRgb: [bgR, bgG, bgB],
      textHex: bgHex,
      bgHex: bgHex
    };
  }

  // Text pixels: top cluster farthest from background (distance >= 0.45 * maxDist, ignores edge anti-aliasing)
  const textPixels = withDist.filter(p => p.dist >= 0.45 * maxDist);
  const textR = median(textPixels.map(p => p.r));
  const textG = median(textPixels.map(p => p.g));
  const textB = median(textPixels.map(p => p.b));
  const textHex = rgbToHex(textR, textG, textB);

  return {
    textRgb: [textR, textG, textB],
    bgRgb: [bgR, bgG, bgB],
    textHex,
    bgHex
  };
}

// Item 3: Extend box to true text extent using column pixel analysis
function extendRegionToTextExtent(region, rawImageBuffer, imgWidth, imgHeight, bgLum) {
  const left = Math.max(0, Math.floor((region.x || 0) * imgWidth));
  const top = Math.max(0, Math.floor((region.y || 0) * imgHeight));
  const width = Math.min(imgWidth - left, Math.max(1, Math.floor((region.w || 0.1) * imgWidth)));
  const height = Math.min(imgHeight - top, Math.max(1, Math.floor((region.h || 0.1) * imgHeight)));

  let lastTextCol = left + width;
  let spaceGap = 0;
  const maxSpaceGap = Math.round(imgWidth * 0.04); // ~32px space gap allowed for words
  const maxScanCol = Math.min(imgWidth - 2, left + Math.round(width * 2.2));

  for (let col = left + width; col < maxScanCol; col++) {
    let hasTextInCol = false;
    for (let y = top; y < top + height; y++) {
      const idx = (y * imgWidth + col) * 3;
      if (idx + 2 < rawImageBuffer.length) {
        const r = rawImageBuffer[idx];
        const g = rawImageBuffer[idx + 1];
        const b = rawImageBuffer[idx + 2];
        const lum = getRelativeLuminance(r, g, b);
        if (Math.abs(lum - bgLum) > 0.14) {
          hasTextInCol = true;
          break;
        }
      }
    }

    if (hasTextInCol) {
      lastTextCol = col;
      spaceGap = 0;
    } else {
      spaceGap++;
      if (spaceGap > maxSpaceGap) break;
    }
  }

  if (lastTextCol > left + width) {
    const extendedW = Math.min(imgWidth - left, (lastTextCol + 4 - left));
    region.w = Number((extendedW / imgWidth).toFixed(4));
  }
}

// --- Gemini Vision Output Parser (handles arrays, box_2d, objects, and normalized coordinates) ---
export function formatAutoAltText(rawText, maxLen = 125) {
  if (!rawText || typeof rawText !== "string") {
    return "Marketing banner image.";
  }

  // 1. Normalize whitespace
  let text = rawText.replace(/\s+/g, " ").trim();

  // 2. Skip single-letter text such as a logo mark (e.g. stray "C")
  text = text.replace(/^(Marketing banner:\s*)?[A-Za-z]\s+(?=[A-Z])/i, (match, prefix) => {
    return prefix || "";
  });

  text = text.replace(/(^|[.!?:]\s+)[A-Za-z]\s+(?=[A-Z])/g, "$1");
  text = text.replace(/\s+/g, " ").trim();

  // 3. If within maxLen, return as is
  if (text.length <= maxLen) {
    return text;
  }

  // 4. Shorten at a word boundary within maxLen
  const sub = text.slice(0, maxLen);
  const lastSpace = sub.lastIndexOf(" ");
  let shortened = (lastSpace > 0) ? sub.slice(0, lastSpace) : sub;

  // 5. Clean trailing punctuation at word boundary
  shortened = shortened.replace(/[\s,;:–—\-\\\/]+$/, "").trim();

  return shortened;
}

function parseVisionOutput(rawText) {
  let parsed = null;
  try {
    let clean = (rawText || "").trim();
    if (clean.startsWith("```json")) clean = clean.slice(7);
    if (clean.startsWith("```")) clean = clean.slice(3);
    if (clean.endsWith("```")) clean = clean.slice(0, -3);
    parsed = JSON.parse(clean.trim());
  } catch (e) {
    console.warn("[parseVisionOutput] JSON parse failed:", e.message);
    return { extracted_text: "", text_regions: [], alt_text: "", has_logo: false };
  }

  let extracted_text = "";
  const text_regions = [];
  const nonLogoTexts = [];

  if (Array.isArray(parsed)) {
    const texts = [];
    for (const item of parsed) {
      if (!item || !item.text) continue;
      const t = item.text.trim();
      texts.push(item.text);
      // Skip single-letter text such as a logo mark (e.g. "C")
      if (t.length > 1 || !/^[A-Za-z]$/.test(t)) {
        nonLogoTexts.push(t);
      }
      let x = 0.05, y = 0.05, w = 0.8, h = 0.08;
      const b2d = item.box_2d || (Array.isArray(item.boxes) && item.boxes[0]) || item.box;
      if (Array.isArray(b2d) && b2d.length === 4) {
        const [ymin, xmin, ymax, xmax] = b2d.map(v => (v > 1 ? v / 1000 : v));
        x = xmin;
        y = ymin;
        w = Math.max(0.01, xmax - xmin);
        h = Math.max(0.01, ymax - ymin);
      } else if (b2d && typeof b2d === "object" && b2d.xmin_normalized !== undefined) {
        x = b2d.xmin_normalized;
        y = b2d.ymin_normalized;
        w = Math.max(0.01, b2d.xmax_normalized - b2d.xmin_normalized);
        h = Math.max(0.01, b2d.ymax_normalized - b2d.ymin_normalized);
      } else if (item.x !== undefined) {
        x = item.x > 1 ? item.x / 1000 : item.x;
        y = item.y > 1 ? item.y / 1000 : item.y;
        w = item.w > 1 ? item.w / 1000 : item.w;
        h = item.h > 1 ? item.h / 1000 : item.h;
      }
      text_regions.push({ text: item.text, x, y, w, h });
    }
    extracted_text = texts.join("\n");
  } else if (typeof parsed === "object" && parsed !== null) {
    extracted_text = (parsed.extracted_text || parsed.text || "").trim();
    const rawRegions = parsed.text_regions || parsed.boxes || [];
    for (const r of rawRegions) {
      if (!r || !r.text) continue;
      const t = r.text.trim();
      if (t.length > 1 || !/^[A-Za-z]$/.test(t)) {
        nonLogoTexts.push(t);
      }
      let x = 0.05, y = 0.05, w = 0.8, h = 0.08;
      const b2d = r.box_2d || (Array.isArray(r.boxes) && r.boxes[0]) || r.box;
      if (Array.isArray(b2d) && b2d.length === 4) {
        const [ymin, xmin, ymax, xmax] = b2d.map(v => (v > 1 ? v / 1000 : v));
        x = xmin;
        y = ymin;
        w = Math.max(0.01, xmax - xmin);
        h = Math.max(0.01, ymax - ymin);
      } else if (b2d && typeof b2d === "object" && b2d.xmin_normalized !== undefined) {
        x = b2d.xmin_normalized;
        y = b2d.ymin_normalized;
        w = Math.max(0.01, b2d.xmax_normalized - b2d.xmin_normalized);
        h = Math.max(0.01, b2d.ymax_normalized - b2d.ymin_normalized);
      } else if (r.x !== undefined) {
        x = r.x > 1 ? r.x / 1000 : r.x;
        y = r.y > 1 ? r.y / 1000 : r.y;
        w = r.w > 1 ? r.w / 1000 : r.w;
        h = r.h > 1 ? r.h / 1000 : r.h;
      }
      text_regions.push({ text: r.text, x, y, w, h });
    }
  }

  const baseForAlt = nonLogoTexts.length > 0
    ? nonLogoTexts.join(" ")
    : extracted_text.split(/\n+/).filter(line => line.trim().length > 1 || !/^[A-Za-z]$/.test(line.trim())).join(" ");

  const rawAlt = parsed?.alt_text || parsed?.alt || (baseForAlt ? `Marketing banner: ${baseForAlt}` : "Marketing banner image.");
  const alt_text = formatAutoAltText(rawAlt, 125);
  const has_logo = Boolean(parsed?.has_logo || parsed?.logo || /CampusPro/i.test(extracted_text));

  return { extracted_text, text_regions, alt_text, has_logo };
}

import crypto from "crypto";

// --- In-Memory Cache (SHA-256) ---
const visualAuditCache = new Map();

export function clearVisualAuditCache() {
  visualAuditCache.clear();
}

export async function runVisualAudit({
  imageBuffer,
  visualSettings = {},
  rules = [],
  facts = [],
  apiKey,
  workspaceId,
  onStage
}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const tOverall0 = Date.now();

  // 1. SHA-256 Cache Check
  const sha256 = crypto.createHash("sha256").update(imageBuffer).digest("hex");
  const cacheKey = `${workspaceId}_${sha256}_${(visualSettings?.palette || []).join("")}_${visualSettings?.minContrastRatio || 4.5}_${visualSettings?.disclaimerPhrase || ""}`;

  if (visualAuditCache.has(cacheKey)) {
    const cached = JSON.parse(JSON.stringify(visualAuditCache.get(cacheKey)));
    cached.timings_ms = {
      upload: 1,
      resize: 0,
      gemini_ocr: 0,
      review: 0,
      validator: 0,
      contrast: 0,
      palette: 0,
      total: 1,
      cached: true
    };
    if (onStage) {
      onStage("upload", "Image verified (cached)", 1);
      onStage("resize", "Downscaled (cached)", 0);
      onStage("gemini_ocr", "Gemini OCR (cached)", 0);
      onStage("palette", "Palette compliance (cached)", 0);
      onStage("contrast", "Typography contrast (cached)", 0);
      onStage("review", "Brand rules review (cached)", 0);
      onStage("validator", "Validation & deduplication (cached)", 0);
    }
    return cached;
  }

  // 2. STAGE: UPLOAD & FORMAT VALIDATION
  const tUpload0 = Date.now();
  let metadata;
  try {
    metadata = await sharp(imageBuffer).metadata();
  } catch (err) {
    throw new Error("Unreadable image file. Please provide a valid PNG, JPG, or WebP image.");
  }

  const validFormats = ["png", "jpeg", "webp"];
  if (!metadata || !validFormats.includes(metadata.format)) {
    throw new Error(
      `Unsupported image format "${metadata?.format || "unknown"}". Allowed formats: PNG, JPG, WebP.`
    );
  }
  const uploadTime = Math.max(1, Date.now() - tUpload0);
  if (onStage) onStage("upload", "Image uploaded & format validated", uploadTime);

  // 3. STAGE: RESIZE (downscale to max 1024px and create ~200px copy)
  const tResize0 = Date.now();
  const downscaledBuffer = await sharp(imageBuffer)
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .toFormat("jpeg", { quality: 85 })
    .toBuffer();

  const dsMeta = await sharp(downscaledBuffer).metadata();
  const imgWidth = dsMeta.width || 800;
  const imgHeight = dsMeta.height || 600;

  // ~200px copy for fast pixel analysis
  const thumb200Buffer = await sharp(downscaledBuffer)
    .resize(200, 200, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const thumb200Meta = await sharp(downscaledBuffer)
    .resize(200, 200, { fit: "inside" })
    .metadata();

  // Store compressed copy (max 1200 px JPEG quality 80) in workspace directory
  const imageDir = getWorkspaceImagesDir(workspaceId);
  const imageId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const compressedFileName = `${imageId}.jpg`;
  const compressedFilePath = path.join(imageDir, compressedFileName);

  await sharp(imageBuffer)
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(compressedFilePath);

  const imageUrl = `/api/workspaces/images/${workspaceId}/${compressedFileName}`;
  const resizeTime = Math.max(1, Date.now() - tResize0);
  if (onStage) onStage("resize", "Downscaled to 1024px and thumbnail generated", resizeTime);

  // 4. PARALLEL STAGE 1: Gemini Vision OCR + CIE Lab Palette Analysis
  const base64Image = downscaledBuffer.toString("base64");
  const brandPalette = (visualSettings.palette && visualSettings.palette.length > 0)
    ? visualSettings.palette
    : ["#1D4ED8", "#0F172A", "#FFFFFF", "#F59E0B"];

  const runOcrTask = async () => {
    const t0 = Date.now();
    let visionData = null;
    let lastVisionError = null;

    const genConfig = {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 512
    };

    const promptText = 'Extract text from this image and bounding boxes as JSON: {"text": "all extracted text exactly as written", "boxes": [{"text": "phrase", "x": 0.1, "y": 0.2, "w": 0.8, "h": 0.1}]}';

    const buildPayload = (cfg) => ({
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: "image/jpeg", data: base64Image } },
            { text: promptText }
          ]
        }
      ],
      generationConfig: cfg
    });

    for (const model of CANDIDATE_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(genConfig)),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
          const rawJson = await response.json();
          let rawText = rawJson.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          visionData = parseVisionOutput(rawText);
          break;
        } else {
          const errBody = await response.text();
          console.warn(`[Visual Gemini ${model}] ${response.status}: ${errBody.slice(0, 100)}`);
          lastVisionError = new Error(`Vision model returned ${response.status}`);
        }
      } catch (err) {
        console.warn(`[Visual Gemini ${model}] failed: ${err.message}`);
        lastVisionError = err;
      }
    }

    if (!visionData) {
      console.warn("[Visual Review] Gemini Vision failed across all models:", lastVisionError?.message);
      visionData = {
        extracted_text: "",
        text_regions: [],
        alt_text: "Marketing banner image.",
        has_logo: false
      };
    }

    const dur = Math.max(1, Date.now() - t0);
    if (onStage) onStage("gemini_ocr", "Gemini Vision OCR text extracted", dur);
    return { visionData, dur };
  };

  const runPaletteTask = async () => {
    const t0 = Date.now();
    let paletteSummary = {
      brand_palette: brandPalette,
      measured: false,
      off_palette_percentage: null,
      on_palette_percentage: null,
      top_off_palette_hex: [],
      status: "not_measured"
    };

    try {
      // Item 1: Downscale to ~100px and obtain exact raw dimensions and buffer
      const { data: thumbBuffer, info } = await sharp(downscaledBuffer)
        .removeAlpha()
        .resize(100, 100, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const totalPixels = info.width * info.height; // exactly 10,000 pixels

      if (thumbBuffer && thumbBuffer.length >= totalPixels * 3) {
        const brandLabs = brandPalette.map(hex => rgbToLab(...hexToRgb(hex)));
        let onPaletteCount = 0;
        let offPaletteCount = 0;
        const offColorCounts = new Map();

        for (let i = 0; i < totalPixels; i++) {
          const offset = i * 3;
          const r = thumbBuffer[offset];
          const g = thumbBuffer[offset + 1];
          const b = thumbBuffer[offset + 2];

          const pLab = rgbToLab(r, g, b);

          let minDistance = Infinity;
          for (const bLab of brandLabs) {
            const d = labDistance(pLab, bLab);
            if (d < minDistance) minDistance = d;
          }

          // delta-E threshold 22 for brand palette match
          if (minDistance <= 22) {
            onPaletteCount++;
          } else {
            offPaletteCount++;
            // Quantize off-palette color (step of 32)
            const qR = Math.round(r / 32) * 32;
            const qG = Math.round(g / 32) * 32;
            const qB = Math.round(b / 32) * 32;
            const qHex = rgbToHex(qR, qG, qB);
            offColorCounts.set(qHex, (offColorCounts.get(qHex) || 0) + 1);
          }
        }

        const onPalettePct = Math.round((onPaletteCount / totalPixels) * 100);
        const offPalettePct = 100 - onPalettePct;
        const topOffColors = [...offColorCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([hex]) => hex);

        const isNonCompliant = onPalettePct < 75; // Brand requires >= 75% on-palette

        paletteSummary = {
          brand_palette: brandPalette,
          measured: true,
          flagged: isNonCompliant,
          off_palette_percentage: offPalettePct,
          on_palette_percentage: onPalettePct,
          top_off_palette_hex: topOffColors,
          status: isNonCompliant ? "non_compliant" : "compliant"
        };
      }
    } catch (palErr) {
      console.error("[Palette Computation Error]:", palErr);
      paletteSummary.measured = false;
      paletteSummary.status = "not_measured";
    }

    const dur = Math.max(1, Date.now() - t0);
    if (onStage) onStage("palette", "CIE Lab palette compliance computed", dur);
    return { paletteSummary, dur };
  };

  // Launch OCR and Palette in parallel
  const [ocrOutcome, paletteOutcome] = await Promise.all([runOcrTask(), runPaletteTask()]);
  const visionData = ocrOutcome.visionData;
  const geminiOcrTime = ocrOutcome.dur;
  const paletteSummary = paletteOutcome.paletteSummary;
  const paletteTime = paletteOutcome.dur;

  const extractedText = (visionData.extracted_text || visionData.text || "").trim();
  const textRegions = Array.isArray(visionData.text_regions || visionData.boxes)
    ? (visionData.text_regions || visionData.boxes)
    : [];
  let altText = formatAutoAltText(visionData.alt_text || visionData.alt || extractedText, 125);
  const hasLogo = Boolean(visionData.has_logo || visionData.logo || visionData.campuspro_logo_detected);

  const allFindings = [];

  // Prompt injection scanner on extracted text
  const injectionFindings = detectPromptInjection(extractedText);
  for (const inj of injectionFindings) {
    allFindings.push(inj);
  }

  // 5. PARALLEL STAGE 2: Text Review + Typography WCAG Contrast Analysis
  const minContrastRatio = Number(visualSettings.minContrastRatio) || 4.5;

  const runTextReviewTask = async () => {
    const t0 = Date.now();
    let rawAiFindings = [];
    if (extractedText !== "") {
      try {
        const activeRules = [...rules, ...(visualSettings?.rules || [])];
        const reviewResult = await callGeminiReview({
          apiKey,
          draftText: extractedText,
          rules: activeRules,
          facts
        });
        rawAiFindings = Array.isArray(reviewResult) ? reviewResult : (reviewResult.findings || []);
      } catch (textErr) {
        console.warn("[Visual Text Review Error]:", textErr.message);
      }
    }
    const dur = Math.max(1, Date.now() - t0);
    if (onStage) onStage("review", "Brand rules & fact review completed", dur);
    return { rawAiFindings, dur };
  };

  const runContrastTask = async () => {
    const t0 = Date.now();
    const contrastResults = [];
    const contrastFindings = [];

    // Extract raw image buffer for column scanning / box width extension
    let rawImageBuffer = null;
    try {
      rawImageBuffer = await sharp(downscaledBuffer).removeAlpha().raw().toBuffer();
    } catch (e) {
      console.warn("[Contrast Raw Buffer Error]:", e.message);
    }

    for (let i = 0; i < textRegions.length; i++) {
      const region = textRegions[i];
      let left = Math.max(0, Math.floor((region.x || 0) * imgWidth));
      let top = Math.max(0, Math.floor((region.y || 0) * imgHeight));
      let width = Math.min(imgWidth - left, Math.max(1, Math.floor((region.w || 0.1) * imgWidth)));
      let height = Math.min(imgHeight - top, Math.max(1, Math.floor((region.h || 0.1) * imgHeight)));

      if (width < 4 || height < 4 || left + width > imgWidth || top + height > imgHeight) {
        region.contrastRatio = null;
        region.calculationType = "estimated";
        region.passesContrast = null;
        contrastResults.push({
          text: region.text,
          measured: false,
          calculationType: "estimated",
          reason: "could not measure (region bounds invalid)",
          needs_human_judgement: true
        });
        continue;
      }

      // Item 2: Padded box sampling for stable background
      const padX = Math.max(4, Math.round(width * 0.08));
      const padY = Math.max(3, Math.round(height * 0.12));
      const leftPad = Math.max(0, left - padX);
      const topPad = Math.max(0, top - padY);
      const rightPad = Math.min(imgWidth, left + width + padX);
      const bottomPad = Math.min(imgHeight, top + height + padY);
      const padW = rightPad - leftPad;
      const padH = bottomPad - topPad;

      try {
        const regionBuffer = await sharp(downscaledBuffer)
          .removeAlpha()
          .extract({ left: leftPad, top: topPad, width: padW, height: padH })
          .raw()
          .toBuffer();

        const numPixels = padW * padH;
        const sampledPixels = [];
        const step = Math.max(1, Math.floor(numPixels / 800));
        for (let p = 0; p < numPixels; p += step) {
          const offset = p * 3;
          if (offset + 2 < regionBuffer.length) {
            const r = regionBuffer[offset];
            const g = regionBuffer[offset + 1];
            const b = regionBuffer[offset + 2];
            const lum = getRelativeLuminance(r, g, b);
            sampledPixels.push({ r, g, b, lum });
          }
        }

        if (sampledPixels.length < 2) {
          region.contrastRatio = null;
          region.calculationType = "estimated";
          region.passesContrast = null;
          contrastResults.push({
            text: region.text,
            measured: false,
            calculationType: "estimated",
            reason: "could not measure",
            needs_human_judgement: true
          });
          continue;
        }

        // Item 2: Estimate text and background with median in padded box
        const clusters = estimateTextAndBgWithMedian(sampledPixels);
        if (!clusters) {
          region.contrastRatio = null;
          region.calculationType = "estimated";
          region.passesContrast = null;
          contrastResults.push({
            text: region.text,
            measured: false,
            calculationType: "estimated",
            reason: "could not measure",
            needs_human_judgement: true
          });
          continue;
        }

        const fgHex = clusters.textHex;
        const bgHex = clusters.bgHex;
        const bgLum = getRelativeLuminance(...clusters.bgRgb);

        // Item 3: Extend box width using column pixel analysis
        if (rawImageBuffer) {
          extendRegionToTextExtent(region, rawImageBuffer, imgWidth, imgHeight, bgLum);
        }

        const ratio = getContrastRatio(clusters.textRgb, clusters.bgRgb);
        const ratioNum = Number(ratio.toFixed(2));
        const passesContrast = ratioNum >= minContrastRatio;

        region.contrastRatio = ratioNum;
        region.fgColor = fgHex;
        region.bgColor = bgHex;
        region.calculationType = "computed";
        region.passesContrast = passesContrast;

        contrastResults.push({
          text: region.text,
          measured: true,
          calculationType: "computed",
          ratio: ratioNum,
          requiredRatio: minContrastRatio,
          foregroundHex: fgHex,
          backgroundHex: bgHex,
          passes: passesContrast
        });

        if (ratio < minContrastRatio) {
          contrastFindings.push({
            id: `finding-contrast-${Date.now()}-${i}`,
            rule_id: "V-01",
            quote: region.text,
            category: "accessibility",
            severity: "high",
            explanation: `Text contrast ratio is ${ratio.toFixed(2)}:1 (foreground ${fgHex}, background ${bgHex}), which fails the minimum required ${minContrastRatio}:1 (WCAG AA). [computed]`,
            suggested_fix: `Change text colour (${fgHex}) to meet at least ${minContrastRatio}:1 minimum contrast ratio against background (${bgHex}).`,
            needs_human_judgement: true,
            source: "contrast",
            measured_ratio: ratioNum,
            foreground_hex: fgHex,
            background_hex: bgHex,
            status: "pending"
          });
        }
      } catch (contrastErr) {
        console.warn(`[Contrast Sampling Error on "${region.text}"]:`, contrastErr.message);
        region.contrastRatio = null;
        region.calculationType = "estimated";
        region.passesContrast = null;
        contrastResults.push({
          text: region.text,
          measured: false,
          calculationType: "estimated",
          reason: "could not measure",
          needs_human_judgement: true
        });
      }
    }

    const dur = Math.max(1, Date.now() - t0);
    if (onStage) onStage("contrast", "Typography WCAG contrast ratios computed", dur);
    return { contrastResults, contrastFindings, dur };
  };

  // Launch Review and Contrast tasks in parallel
  const [reviewOutcome, contrastOutcome] = await Promise.all([runTextReviewTask(), runContrastTask()]);
  const rawAiFindings = reviewOutcome.rawAiFindings;
  const reviewTime = reviewOutcome.dur;
  const contrastResults = contrastOutcome.contrastResults;
  const contrastTime = contrastOutcome.dur;

  for (const cf of contrastOutcome.contrastFindings) {
    allFindings.push(cf);
  }

  // Add palette finding if non-compliant
  if (paletteSummary.flagged) {
    allFindings.push({
      id: `finding-palette-${Date.now()}`,
      rule_id: "V-02",
      quote: "(Image color palette)",
      category: "brand",
      severity: "medium",
      explanation: `Only ${paletteSummary.on_palette_percentage}% of image pixels match the brand palette (required >= 75%). Top off-palette colours: ${paletteSummary.top_off_palette_hex.join(", ")}. [computed]`,
      suggested_fix: `Adjust banner background and accents (${paletteSummary.top_off_palette_hex.join(", ")}) to adhere to approved brand colours (${brandPalette.join(", ")}).`,
      needs_human_judgement: true,
      source: "palette",
      status: "pending"
    });
  }

  // 6. DISCLAIMER & ALT TEXT CHECKS
  const disclaimerPhrase = (visualSettings.disclaimerPhrase || "").trim();
  if (disclaimerPhrase !== "") {
    const found = extractedText.toLowerCase().includes(disclaimerPhrase.toLowerCase());
    if (!found) {
      allFindings.push({
        id: `finding-disclaimer-${Date.now()}`,
        rule_id: "V-04",
        quote: "(Missing disclaimer)",
        category: "claim",
        severity: "high",
        explanation: `The required disclaimer phrase "${disclaimerPhrase}" was not found in the image text.`,
        suggested_fix: `Add the required disclaimer: "${disclaimerPhrase}"`,
        needs_human_judgement: false,
        source: "disclaimer",
        status: "pending"
      });
    }
  }

  if (!altText || altText.trim() === "") {
    allFindings.push({
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

  // 7. STAGE: VALIDATOR (Only call validator / retry when a finding fails rule-based checks, max 1 retry)
  const tValidator0 = Date.now();
  let droppedTextCount = 0;
  const activeRules = [...rules, ...(visualSettings?.rules || [])];

  if (rawAiFindings.length > 0 && extractedText !== "") {
    // Check if any finding fails rule-based checks
    const validRuleIds = new Set([
      ...activeRules.map(r => r.id.trim().toUpperCase()),
      ...facts.map(f => f.id.trim().toUpperCase())
    ]);

    const needsFullValidation = rawAiFindings.some(f => {
      const q = (f.quote || "").trim();
      const rId = (f.rule_id || "").trim().toUpperCase();
      const fix = (f.suggested_fix || "").trim();
      const exp = (f.explanation || "").trim();
      return (
        !q ||
        !extractedText.includes(q) ||
        !validRuleIds.has(rId) ||
        (fix && q && fix.toLowerCase() === q.toLowerCase()) ||
        /\bwait\b/i.test(exp) ||
        /\bhowever\b/i.test(exp)
      );
    });

    let rejectedList = [];
    if (needsFullValidation) {
      const validated = validateFindings(extractedText, rawAiFindings, activeRules, facts);
      droppedTextCount = validated.rejected.length;
      rejectedList = [...validated.rejected];
      for (const f of validated.accepted) {
        allFindings.push({ ...f, source: "text" });
      }
    } else {
      // Direct pass - all findings adhere to rule checks
      for (let i = 0; i < rawAiFindings.length; i++) {
        const f = rawAiFindings[i];
        allFindings.push({
          id: `finding-text-${Date.now()}-${i}`,
          quote: (f.quote || "").trim(),
          rule_id: (f.rule_id || "").trim().toUpperCase(),
          category: (f.category || "claim").toLowerCase(),
          severity: ["high", "medium", "low"].includes((f.severity || "").toLowerCase()) ? f.severity.toLowerCase() : "medium",
          explanation: (f.explanation || "").trim(),
          suggested_fix: (f.suggested_fix || "").trim(),
          action: "replace",
          needs_human_judgement: Boolean(f.needs_human_judgement),
          status: "pending",
          source: "text"
        });
      }
    }

    // Deduplication & merge overlapping / nested findings
    const { mergedFindings, mergedCount, mergedList } = mergeFindings(allFindings, extractedText);
    const severityRank = { high: 3, medium: 2, low: 1 };
    const finalFindings = [];
    const quoteMap = new Map();

    for (const f of mergedFindings) {
      const key = (f.quote || "").trim().toLowerCase();
      if (!key || key.startsWith("(") || key.startsWith("[")) {
        finalFindings.push(f);
        continue;
      }
      if (!quoteMap.has(key)) {
        quoteMap.set(key, []);
      }
      quoteMap.get(key).push(f);
    }

    for (const [key, group] of quoteMap.entries()) {
      if (group.length === 1) {
        finalFindings.push(group[0]);
      } else {
        group.sort((a, b) => {
          const diff = (severityRank[b.severity] || 1) - (severityRank[a.severity] || 1);
          if (diff !== 0) return diff;
          const aIsFact = a.rule_id.startsWith("F-") ? 1 : 0;
          const bIsFact = b.rule_id.startsWith("F-") ? 1 : 0;
          if (bIsFact !== aIsFact) return bIsFact - aIsFact;
          return (b.suggested_fix ? 1 : 0) - (a.suggested_fix ? 1 : 0);
        });
        finalFindings.push(group[0]);
        for (let k = 1; k < group.length; k++) {
          const dropped = group[k];
          droppedTextCount++;
          rejectedList.push({
            quote: dropped.quote,
            rule_id: dropped.rule_id,
            reasons: [`Duplicate finding on identical quote dropped in favor of higher priority ${group[0].rule_id} (${group[0].severity})`]
          });
        }
      }
    }

    const validatorTime = Math.max(1, Date.now() - tValidator0);
    if (onStage) onStage("validator", "Finding validation & deduplication verified", validatorTime);

    const totalTime = Math.max(1, Date.now() - tOverall0);

    const timings_ms = {
      upload: uploadTime,
      resize: resizeTime,
      gemini_ocr: geminiOcrTime,
      review: reviewTime,
      validator: validatorTime,
      contrast: contrastTime,
      palette: paletteTime,
      total: totalTime,
      cached: false
    };

    const finalResult = {
      extracted_text: extractedText,
      regions: textRegions,
      alt_text: altText,
      has_logo: hasLogo,
      findings: finalFindings,
      contrast_results: contrastResults,
      palette_summary: paletteSummary,
      validatorRejected: rejectedList,
      validatorMerged: mergedList || [],
      stats: {
        kept: finalFindings.length,
        dropped_by_validator: droppedTextCount,
        merged: mergedCount
      },
      imageUrl,
      timings_ms
    };

    // Cache in-memory by SHA-256
    visualAuditCache.set(cacheKey, finalResult);

    return finalResult;
  }

  // Deduplication & merge overlapping / nested findings when rawAiFindings is empty
  const { mergedFindings, mergedCount, mergedList } = mergeFindings(allFindings, extractedText);
  const validatorTime = Math.max(1, Date.now() - tValidator0);
  if (onStage) onStage("validator", "Finding validation & deduplication verified", validatorTime);

  const totalTime = Math.max(1, Date.now() - tOverall0);

  const timings_ms = {
    upload: uploadTime,
    resize: resizeTime,
    gemini_ocr: geminiOcrTime,
    review: reviewTime,
    validator: validatorTime,
    contrast: contrastTime,
    palette: paletteTime,
    total: totalTime,
    cached: false
  };

  const finalResult = {
    extracted_text: extractedText,
    regions: textRegions,
    alt_text: altText,
    has_logo: hasLogo,
    findings: mergedFindings,
    contrast_results: contrastResults,
    palette_summary: paletteSummary,
    validatorRejected: [],
    validatorMerged: mergedList || [],
    stats: {
      kept: mergedFindings.length,
      dropped_by_validator: 0,
      merged: mergedCount
    },
    imageUrl,
    timings_ms
  };

  visualAuditCache.set(cacheKey, finalResult);
  return finalResult;
}
