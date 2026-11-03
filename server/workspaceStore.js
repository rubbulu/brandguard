import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ExpiringLRUCache } from "./lruCache.js";
import {
  INITIAL_RULES,
  INITIAL_FACTS,
  INITIAL_VISUAL_SETTINGS,
  INITIAL_TONE_PROFILES,
  INITIAL_BRAND_TERMS
} from "./demoData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACES_DIR = path.join(__dirname, "data", "workspaces");
const WORKSPACE_IMAGES_DIR = path.join(WORKSPACES_DIR, "images");

// Ensure directories exist
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}
if (!fs.existsSync(WORKSPACE_IMAGES_DIR)) {
  fs.mkdirSync(WORKSPACE_IMAGES_DIR, { recursive: true });
}

// Bounded in-memory workspace cache (LRU, max 100 workspaces, 20m expiry)
export const workspaceCache = new ExpiringLRUCache({ maxSize: 100, ttlMs: 20 * 60 * 1000 });

// Per-file operation queue to serialize concurrent writes and prevent race conditions
const fileQueues = new Map();

export function enqueueFileOperation(filePath, op) {
  const currentOp = fileQueues.get(filePath) || Promise.resolve();
  const nextOp = currentOp
    .catch(() => {}) // Don't let previous failures break the queue
    .then(() => op());
  fileQueues.set(filePath, nextOp);
  return nextOp;
}

export function sanitizeWorkspaceId(id) {
  if (!id || typeof id !== "string") return "default";
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
}

function getFilePath(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  return path.join(WORKSPACES_DIR, `${safeId}.json`);
}

/**
 * Safe atomic file write: writes content to a unique temp file in the same directory,
 * then atomically renames it over the target file.
 */
export function writeFileSyncAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );

  try {
    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // If temp file remains on error, attempt cleanup
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
    throw err;
  }
}

export function getWorkspaceImagesDir(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  const dir = path.join(WORKSPACE_IMAGES_DIR, safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getInitialWorkspaceData(workspaceId) {
  return {
    id: sanitizeWorkspaceId(workspaceId),
    createdAt: new Date().toISOString(),
    rules: JSON.parse(JSON.stringify(INITIAL_RULES)),
    facts: JSON.parse(JSON.stringify(INITIAL_FACTS)),
    visualSettings: JSON.parse(JSON.stringify(INITIAL_VISUAL_SETTINGS)),
    toneProfiles: JSON.parse(JSON.stringify(INITIAL_TONE_PROFILES)),
    brandTerms: [...INITIAL_BRAND_TERMS],
    proposals: [],
    auditTrail: [],
    clarificationRequests: [],
    dismissedClarifications: {},
    drafts: [] // Fresh visitor starts with NO drafts, NO comments, empty audit trail
  };
}

export function loadWorkspace(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  const filePath = getFilePath(safeId);

  // Return from in-memory cache if valid and unexpired
  if (workspaceCache.has(safeId)) {
    return workspaceCache.get(safeId);
  }

  let fileExisted = false;
  try {
    if (fs.existsSync(filePath)) {
      fileExisted = true;
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      // Ensure required collections exist
      if (!Array.isArray(data.rules)) data.rules = JSON.parse(JSON.stringify(INITIAL_RULES));
      // Ensure T-06 is present in rules if not already
      if (!data.rules.some(r => r.id === "T-06")) {
        const t06Rule = INITIAL_RULES.find(r => r.id === "T-06");
        if (t06Rule) data.rules.push({ ...t06Rule });
      }
      // Ensure bannedTerms are populated from INITIAL_RULES if missing
      for (const rule of data.rules) {
        if (!rule.bannedTerms) {
          const initRule = INITIAL_RULES.find(r => r.id === rule.id);
          if (initRule && initRule.bannedTerms) {
            rule.bannedTerms = [...initRule.bannedTerms];
          }
        }
      }
      if (!Array.isArray(data.facts)) data.facts = JSON.parse(JSON.stringify(INITIAL_FACTS));
      if (!Array.isArray(data.drafts)) data.drafts = [];
      if (!data.visualSettings) data.visualSettings = JSON.parse(JSON.stringify(INITIAL_VISUAL_SETTINGS));

      // Migration for existing workspaces lacking toneProfiles or brandTerms
      if (!data.toneProfiles || typeof data.toneProfiles !== "object") {
        data.toneProfiles = JSON.parse(JSON.stringify(INITIAL_TONE_PROFILES));
      } else {
        for (const [ch, prof] of Object.entries(INITIAL_TONE_PROFILES)) {
          if (!data.toneProfiles[ch]) {
            data.toneProfiles[ch] = { ...prof };
          }
        }
      }
      if (!Array.isArray(data.brandTerms)) {
        data.brandTerms = [...INITIAL_BRAND_TERMS];
      }
      if (!Array.isArray(data.proposals)) {
        data.proposals = [];
      }
      if (!Array.isArray(data.auditTrail)) {
        data.auditTrail = [];
      }
      if (!Array.isArray(data.clarificationRequests)) {
        data.clarificationRequests = [];
      }
      if (!data.dismissedClarifications || typeof data.dismissedClarifications !== "object") {
        data.dismissedClarifications = {};
      }

      data._wasReset = false;
      data._wasMissing = false;
      workspaceCache.set(safeId, data);
      return data;
    }
  } catch (err) {
    console.warn(`[WorkspaceStore] Error reading workspace ${safeId}, re-seeding:`, err.message);
  }

  // Create new seeded workspace (file was missing or reset after disk wipe)
  const newWs = getInitialWorkspaceData(safeId);
  newWs._wasReset = true;
  newWs._wasMissing = !fileExisted;
  saveWorkspace(safeId, newWs);
  return newWs;
}

export function saveWorkspace(workspaceId, data) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  const filePath = getFilePath(safeId);
  try {
    data.updatedAt = new Date().toISOString();
    const content = JSON.stringify(data, null, 2);
    writeFileSyncAtomic(filePath, content);
    workspaceCache.set(safeId, data);
  } catch (err) {
    console.error(`[WorkspaceStore] Failed to save workspace ${safeId}:`, err.message);
  }
}

/**
 * Serialized async workspace updater that guards against race conditions
 * by acquiring the per-file lock before read-modify-write.
 */
export async function updateWorkspace(workspaceId, updater) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  const filePath = getFilePath(safeId);

  return enqueueFileOperation(filePath, async () => {
    // Invalidate in-memory cache to ensure latest state is read from disk
    workspaceCache.delete(safeId);
    const ws = loadWorkspace(safeId);
    await updater(ws);
    saveWorkspace(safeId, ws);
    return ws;
  });
}

export function resetWorkspace(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  workspaceCache.delete(safeId);
  const fresh = getInitialWorkspaceData(safeId);
  saveWorkspace(safeId, fresh);

  // Delete all stored compressed images for this workspace
  try {
    const imagesDir = path.join(WORKSPACE_IMAGES_DIR, safeId);
    if (fs.existsSync(imagesDir)) {
      fs.rmSync(imagesDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[WorkspaceStore] Failed to clear images for ${safeId}:`, err.message);
  }

  return fresh;
}
