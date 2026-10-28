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

function extractBoundingBox(item, fallbackIdx = 0, total = 1) {
  let b2d = item.box_2d ?? item.box ?? (Array.isArray(item.boxes) ? item.boxes[0] : null) ?? item.bounding_box;
  while (Array.isArray(b2d) && b2d.length === 1 && (Array.isArray(b2d[0]) || typeof b2d[0] === "string")) {
    b2d = b2d[0];
  }
  if (typeof b2d === "string") {
    try {
      const p = JSON.parse(b2d);
      if (Array.isArray(p)) b2d = p;
    } catch {
      b2d = b2d.replace(/[\[\]]/g, "").split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    }
  }

  if (Array.isArray(b2d) && b2d.length >= 4) {
    const yminRaw = Number(b2d[0]);
    const xminRaw = Number(b2d[1]);
    const ymaxRaw = Number(b2d[2]);
    const xmaxRaw = Number(b2d[3]);
    const ymin = yminRaw > 1 ? yminRaw / 1000 : yminRaw;
    const xmin = xminRaw > 1 ? xminRaw / 1000 : xminRaw;
    const ymax = ymaxRaw > 1 ? ymaxRaw / 1000 : ymaxRaw;
    const xmax = xmaxRaw > 1 ? xmaxRaw / 1000 : xmaxRaw;

    const x = Math.max(0, Math.min(1, Math.min(xmin, xmax)));
    const y = Math.max(0, Math.min(1, Math.min(ymin, ymax)));
    const w = Math.max(0.01, Math.min(1 - x, Math.abs(xmax - xmin)));
    const h = Math.max(0.01, Math.min(1 - y, Math.abs(ymax - ymin)));
    return { x, y, w, h };
  }

  if (b2d && typeof b2d === "object" && b2d.xmin_normalized !== undefined) {
    const x = Math.max(0, Math.min(1, b2d.xmin_normalized));
    const y = Math.max(0, Math.min(1, b2d.ymin_normalized));
    const w = Math.max(0.01, Math.min(1 - x, b2d.xmax_normalized - b2d.xmin_normalized));
    const h = Math.max(0.01, Math.min(1 - y, b2d.ymax_normalized - b2d.ymin_normalized));
    return { x, y, w, h };
  }

  if (item.x !== undefined && item.y !== undefined) {
    const xRaw = Number(item.x);
    const yRaw = Number(item.y);
    const wRaw = Number(item.w ?? 0.8);
    const hRaw = Number(item.h ?? 0.08);
    const x = Math.max(0, Math.min(1, xRaw > 1 ? xRaw / 1000 : xRaw));
    const y = Math.max(0, Math.min(1, yRaw > 1 ? yRaw / 1000 : yRaw));
    const w = Math.max(0.01, Math.min(1 - x, wRaw > 1 ? wRaw / 1000 : wRaw));
    const h = Math.max(0.01, Math.min(1 - y, hRaw > 1 ? hRaw / 1000 : hRaw));
    return { x, y, w, h };
  }

  // Stagger fallback vertically across the canvas
  const step = Math.min(0.18, 0.85 / Math.max(1, total));
  const y = Math.min(0.85, 0.08 + fallbackIdx * step);
  return { x: 0.08, y, w: 0.75, h: 0.08 };
}

export const PLACEHOLDER_STRINGS = new Set([
  "text",
  "text line",
  "exact line text",
  "phrase",
  "detected text",
  "sample text",
  "placeholder",
  "the line text exactly as shown",
  "line text",
  "exact text",
  "line"
]);

export function validateOcrResult(visionData) {
  if (!visionData) return false;
  const regions = visionData.text_regions || visionData.lines || [];
  if (!Array.isArray(regions) || regions.length === 0) {
    return false;
  }

  const lines = [];
  for (const r of regions) {
    const text = (typeof r === "string" ? r : r.text || r.label || "").trim().toLowerCase();
    if (!text) continue;
    if (
      PLACEHOLDER_STRINGS.has(text) ||
      /^exact\s*line\s*text$/i.test(text) ||
      /^text\s*line$/i.test(text) ||
      /^sample\s*text$/i.test(text)
    ) {
      console.warn(`[validateOcrResult] Rejected placeholder string in OCR output: "${text}"`);
      return false;
    }
    lines.push(text);
  }

  if (lines.length === 0) {
    return false;
  }

  // Check if the lines are all identical
  if (lines.length > 1 && new Set(lines).size === 1) {
    console.warn(`[validateOcrResult] Rejected OCR output: all ${lines.length} lines are identical ("${lines[0]}")`);
    return false;
  }

  // If only a single line was returned and it's 1-2 characters (e.g. just a logo mark 'C'), reject so it retries
  if (lines.length === 1 && lines[0].length <= 2) {
    console.warn(`[validateOcrResult] Rejected OCR output: only single-letter mark detected ("${lines[0]}")`);
    return false;
  }

  return true;
}

const ocrResponseSchema = {
  type: "OBJECT",
  description: "Text detection and logo recognition results",
  properties: {
    has_logo: {
      type: "BOOLEAN",
      description: "True if the brand logo, emblem, or mark is visually present in the image"
    },
    lines: {
      type: "ARRAY",
      description: "Array containing every single text line or element visible in the image",
      items: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "The verbatim text transcribed from the image"
          },
          box_2d: {
            type: "ARRAY",
            description: "Bounding box coordinates [ymin, xmin, ymax, xmax] as integers from 0 to 1000",
            items: {
              type: "INTEGER"
            }
          }
        },
        required: ["text", "box_2d"]
      }
    }
  },
  required: ["has_logo", "lines"]
};

function extractTextValue(item) {
  if (!item) return "";
  const candidates = [item.text, item.label, item.phrase, item.content, item.line, item.name];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !/^(text|exact line text|phrase|detected text|the line text exactly as shown|sample text|placeholder)$/i.test(c.trim())) {
      return c.trim();
    }
  }
  return (typeof item.text === "string" ? item.text : typeof item.label === "string" ? item.label : "").trim();
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

  const rawRegions = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object")
    ? (parsed.lines || parsed.text_regions || parsed.boxes || [])
    : [];

  const total = rawRegions.length;
  const texts = [];

  for (let i = 0; i < rawRegions.length; i++) {
    const item = rawRegions[i];
    const textVal = extractTextValue(item);
    if (!textVal) continue;
    texts.push(textVal);
    // Skip single-letter text such as a logo mark (e.g. "C")
    if (textVal.length > 1 || !/^[A-Za-z]$/.test(textVal)) {
      nonLogoTexts.push(textVal);
    }
    const coords = extractBoundingBox(item, i, total);
    text_regions.push({ text: textVal, ...coords });
  }

  if (typeof parsed === "object" && parsed !== null && typeof parsed.extracted_text === "string" && parsed.extracted_text.trim()) {
    extracted_text = parsed.extracted_text.trim();
  } else {
    extracted_text = texts.join("\n");
  }

  const baseForAlt = nonLogoTexts.length > 0
    ? nonLogoTexts.join(" ")
    : extracted_text.split(/\n+/).filter(line => line.trim().length > 1 || !/^[A-Za-z]$/.test(line.trim())).join(" ");

  const rawAlt = (parsed && typeof parsed === "object" && (parsed.alt_text || parsed.alt))
    ? (parsed.alt_text || parsed.alt)
    : (baseForAlt ? `Marketing banner: ${baseForAlt}` : "Marketing banner image.");

  const alt_text = formatAutoAltText(rawAlt, 125);
  const has_logo = Boolean(
    (parsed && typeof parsed === "object" && (parsed.has_logo || parsed.logo)) ||
    /CampusPro/i.test(extracted_text)
  );

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
    const cachedText = (cached.extracted_text || "").trim();
    const hasPlaceholders = (cached.regions || []).some(r =>
      PLACEHOLDER_STRINGS.has((r.text || "").trim().toLowerCase())
    );
    if (cachedText === "Text could not be read, please retry" || hasPlaceholders) {
      visualAuditCache.delete(cacheKey);
    } else {
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

    const genConfig = {
      responseMimeType: "application/json",
      responseSchema: ocrResponseSchema,
      temperature: 0,
      maxOutputTokens: 1024
    };

    const promptText = "Detect and transcribe all text in this image. Include all headings, body text, bullet points, button labels, and brand names with 2D bounding box coordinates.";

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

    const executeCall = async () => {
      let lastVisionError = null;
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
            return parseVisionOutput(rawText);
          } else {
            const errBody = await response.text();
            console.warn(`[Visual Gemini ${model}] ${response.status}: ${errBody.slice(0, 100)}`);
            lastVisionError = new Error(`Vision model returned ${response.status}`);
          }
        } catch (err) {
          console.warn(`[Visual Gemini ${model}] failed: ${err.message}`, err.cause || "");
          lastVisionError = err;
        }
      }
      return null;
    };

    let visionData = await executeCall();
    let isValid = validateOcrResult(visionData);

    // If validation fails (placeholder string, all lines identical, or empty), retry once
    if (!isValid) {
      console.warn("[Visual OCR] Initial OCR result failed validation. Retrying once...");
      visionData = await executeCall();
      isValid = validateOcrResult(visionData);
    }

    const dur = Math.max(1, Date.now() - t0);

    if (!isValid || !visionData) {
      console.warn("[Visual OCR] OCR failed after retry. Marking as unreadable.");
      visionData = {
        extracted_text: "Text could not be read, please retry",
        text_regions: [],
        alt_text: "",
        has_logo: false,
        ocr_failed: true
      };
      if (onStage) onStage("gemini_ocr", "OCR text could not be read (retried)", dur);
    } else {
      if (onStage) onStage("gemini_ocr", "Gemini Vision OCR completed", dur);
    }

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

  const isOcrFailed = Boolean(visionData.ocr_failed || visionData.extracted_text === "Text could not be read, please retry");
  const extractedText = isOcrFailed ? "Text could not be read, please retry" : (visionData.extracted_text || visionData.text || "").trim();
  const textRegions = isOcrFailed ? [] : (Array.isArray(visionData.text_regions || visionData.boxes)
    ? (visionData.text_regions || visionData.boxes)
    : []);
  let altText = isOcrFailed ? "" : formatAutoAltText(visionData.alt_text || visionData.alt || extractedText, 125);
  const hasLogo = isOcrFailed ? false : Boolean(visionData.has_logo || visionData.logo || /CampusPro/i.test(extractedText));

  const allFindings = [];

  // Prompt injection scanner on extracted text
  if (!isOcrFailed) {
    const injectionFindings = detectPromptInjection(extractedText);
    for (const inj of injectionFindings) {
      allFindings.push(inj);
    }
  }

  // 5. PARALLEL STAGE 2: Text Review + Typography WCAG Contrast Analysis
  const minContrastRatio = Number(visualSettings.minContrastRatio) || 4.5;

  const runTextReviewTask = async () => {
    const t0 = Date.now();
    let rawAiFindings = [];
    if (!isOcrFailed && extractedText !== "") {
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

    if (isOcrFailed || textRegions.length === 0) {
      const dur = Math.max(1, Date.now() - t0);
      if (onStage) onStage("contrast", "Typography contrast skipped", dur);
      return { contrastResults, contrastFindings, dur };
    }

    // Extract uncompressed raw image buffer at original resolution for exact pixel sampling
    let origRawBuffer = null;
    let origWidth = metadata?.width || 800;
    let origHeight = metadata?.height || 600;
    try {
      origRawBuffer = await sharp(imageBuffer).removeAlpha().raw().toBuffer();
    } catch (e) {
      console.warn("[Contrast Raw Buffer Error]:", e.message);
    }

    for (let i = 0; i < textRegions.length; i++) {
      const region = textRegions[i];
      // Map normalized coordinates directly to original image resolution
      const left = Math.max(0, Math.min(origWidth - 1, Math.round((region.x || 0) * origWidth)));
      const top = Math.max(0, Math.min(origHeight - 1, Math.round((region.y || 0) * origHeight)));
      const width = Math.max(4, Math.min(origWidth - left, Math.round((region.w || 0.1) * origWidth)));
      const height = Math.max(4, Math.min(origHeight - top, Math.round((region.h || 0.05) * origHeight)));

      if (!origRawBuffer || width < 4 || height < 4) {
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

      try {
        const padX = Math.max(3, Math.min(20, Math.round(width * 0.05)));
        const padY = Math.max(3, Math.min(16, Math.round(height * 0.15)));
        const minX = Math.max(0, left - padX);
        const maxX = Math.min(origWidth - 1, left + width + padX);
        const minY = Math.max(0, top - padY);
        const maxY = Math.min(origHeight - 1, top + height + padY);

        function getPixel(px, py) {
          const cx = Math.max(0, Math.min(origWidth - 1, px));
          const cy = Math.max(0, Math.min(origHeight - 1, py));
          const idx = (cy * origWidth + cx) * 3;
          const r = origRawBuffer[idx];
          const g = origRawBuffer[idx + 1];
          const b = origRawBuffer[idx + 2];
          return { r, g, b, lum: getRelativeLuminance(r, g, b), x: cx, y: cy };
        }

        // 1. Perimeter pixels around the text box
        const perimPixels = [];
        for (let px = minX; px <= maxX; px += 2) {
          for (let py = minY; py < top; py++) perimPixels.push(getPixel(px, py));
          for (let py = top + height; py <= maxY; py++) perimPixels.push(getPixel(px, py));
        }
        for (let py = top; py < top + height; py += 2) {
          for (let px = minX; px < left; px++) perimPixels.push(getPixel(px, py));
          for (let px = left + width; px <= maxX; px++) perimPixels.push(getPixel(px, py));
        }

        // 2. Inside pixels
        const insidePixels = [];
        const stepX = Math.max(1, Math.floor(width / 120));
        const stepY = Math.max(1, Math.floor(height / 30));
        for (let py = top; py < top + height; py += stepY) {
          for (let px = left; px < left + width; px += stepX) {
            insidePixels.push(getPixel(px, py));
          }
        }

        if (insidePixels.length === 0) {
          region.contrastRatio = null;
          region.calculationType = "estimated";
          region.passesContrast = null;
          contrastResults.push({
            text: region.text,
            measured: false,
            calculationType: "estimated",
            reason: "no inside pixels sampled",
            needs_human_judgement: true
          });
          continue;
        }

        // 3. Determine background polarity (light vs dark) from perimeter and majority pixels
        const allPixels = [...insidePixels, ...perimPixels];
        const sortedByLum = [...allPixels].sort((a, b) => a.lum - b.lum);
        const medianLum = sortedByLum[Math.floor(sortedByLum.length / 2)].lum;
        const bgIsLight = medianLum > 0.45;

        // 4. Extract text colour from darkest or lightest cluster inside box
        const insideSorted = [...insidePixels].sort((a, b) => a.lum - b.lum);
        const textClusterSize = Math.max(2, Math.floor(insideSorted.length * 0.10));
        const textCluster = bgIsLight
          ? insideSorted.slice(0, textClusterSize)
          : insideSorted.slice(Math.max(0, insideSorted.length - textClusterSize));

        const textR = median(textCluster.map(p => p.r));
        const textG = median(textCluster.map(p => p.g));
        const textB = median(textCluster.map(p => p.b));
        const textHex = rgbToHex(textR, textG, textB);
        const textLum = getRelativeLuminance(textR, textG, textB);

        // 5. Extract background colour separately for each box
        const bgCluster = bgIsLight
          ? [...perimPixels, ...insideSorted.slice(Math.floor(insideSorted.length * 0.6))]
          : [...perimPixels, ...insideSorted.slice(0, Math.floor(insideSorted.length * 0.4))];

        const bgR = median(bgCluster.map(p => p.r));
        const bgG = median(bgCluster.map(p => p.g));
        const bgB = median(bgCluster.map(p => p.b));
        const bgHex = rgbToHex(bgR, bgG, bgB);
        const bgLum = getRelativeLuminance(bgR, bgG, bgB);

        // 6. Check if background varies a lot inside / around box (e.g. gradient)
        const numSections = 3;
        const sectionBgLums = [];
        const sectionWidth = Math.floor(width / numSections);
        for (let s = 0; s < numSections; s++) {
          const sLeft = left + s * sectionWidth;
          const sRight = (s === numSections - 1) ? (left + width) : (sLeft + sectionWidth);
          const sPixels = insidePixels.filter(p => p.x >= sLeft && p.x < sRight);
          const sSorted = [...sPixels].sort((a, b) => a.lum - b.lum);
          const sBg = bgIsLight
            ? sSorted.slice(Math.floor(sSorted.length * 0.7))
            : sSorted.slice(0, Math.max(1, Math.floor(sSorted.length * 0.3)));
          if (sBg.length) {
            const sBgR = median(sBg.map(p => p.r));
            const sBgG = median(sBg.map(p => p.g));
            const sBgB = median(sBg.map(p => p.b));
            sectionBgLums.push(getRelativeLuminance(sBgR, sBgG, sBgB));
          }
        }
        const bgSectionDiff = sectionBgLums.length > 1
          ? Math.max(...sectionBgLums) - Math.min(...sectionBgLums)
          : 0;

        const perimLums = perimPixels.map(p => p.lum);
        const perimMean = perimLums.reduce((s, v) => s + v, 0) / (perimLums.length || 1);
        const perimStdDev = Math.sqrt(perimLums.reduce((s, v) => s + Math.pow(v - perimMean, 2), 0) / (perimLums.length || 1));

        const isApproximate = bgSectionDiff > 0.15 || perimStdDev > 0.12;

        const lighter = Math.max(textLum, bgLum);
        const darker = Math.min(textLum, bgLum);
        const ratio = (lighter + 0.05) / (darker + 0.05);
        const ratioNum = Number(ratio.toFixed(2));
        const passesContrast = isApproximate ? null : (ratioNum >= minContrastRatio);

        region.contrastRatio = ratioNum;
        region.fgColor = textHex;
        region.bgColor = bgHex;
        region.calculationType = isApproximate ? "approximate" : "computed";
        region.isApproximate = isApproximate;
        region.passesContrast = passesContrast;

        contrastResults.push({
          text: region.text,
          measured: true,
          calculationType: isApproximate ? "approximate" : "computed",
          isApproximate,
          ratio: ratioNum,
          requiredRatio: minContrastRatio,
          foregroundHex: textHex,
          backgroundHex: bgHex,
          passes: passesContrast
        });

        if (!isApproximate && ratioNum < minContrastRatio) {
          contrastFindings.push({
            id: `finding-contrast-${Date.now()}-${i}`,
            rule_id: "V-01",
            quote: region.text,
            category: "accessibility",
            severity: "high",
            explanation: `Text contrast ratio is ${ratioNum}:1 (foreground ${textHex}, background ${bgHex}), which fails the minimum required ${minContrastRatio}:1 (WCAG AA). [computed]`,
            suggested_fix: `Change text colour (${textHex}) to meet at least ${minContrastRatio}:1 minimum contrast ratio against background (${bgHex}).`,
            needs_human_judgement: true,
            source: "contrast",
            measured_ratio: ratioNum,
            foreground_hex: textHex,
            background_hex: bgHex,
            status: "pending"
          });
        } else if (isApproximate && ratioNum < minContrastRatio) {
          contrastFindings.push({
            id: `finding-contrast-${Date.now()}-${i}`,
            rule_id: "V-01",
            quote: region.text,
            category: "accessibility",
            severity: "medium",
            explanation: `Text contrast ratio is approximately ${ratioNum}:1 (foreground ${textHex}, background ${bgHex}) over a variable or gradient background. [approximate]`,
            suggested_fix: `Ensure text colour (${textHex}) maintains sufficient contrast across the gradient background.`,
            needs_human_judgement: true,
            source: "contrast",
            measured_ratio: ratioNum,
            foreground_hex: textHex,
            background_hex: bgHex,
            is_approximate: true,
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
  if (!isOcrFailed) {
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

    // Cache in-memory by SHA-256 only if OCR succeeded
    if (!isOcrFailed && extractedText !== "Text could not be read, please retry") {
      visualAuditCache.set(cacheKey, finalResult);
    }

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

  if (!isOcrFailed && extractedText !== "Text could not be read, please retry") {
    visualAuditCache.set(cacheKey, finalResult);
  }
  return finalResult;
}
