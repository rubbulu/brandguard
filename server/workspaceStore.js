import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { INITIAL_RULES, INITIAL_FACTS, INITIAL_VISUAL_SETTINGS } from "./demoData.js";

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

export function sanitizeWorkspaceId(id) {
  if (!id || typeof id !== "string") return "default";
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
}

function getFilePath(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  return path.join(WORKSPACES_DIR, `${safeId}.json`);
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
    drafts: [] // Fresh visitor starts with NO drafts, NO comments, empty audit trail
  };
}

export function loadWorkspace(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  const filePath = getFilePath(safeId);

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      // Ensure required collections exist
      if (!Array.isArray(data.rules)) data.rules = JSON.parse(JSON.stringify(INITIAL_RULES));
      if (!Array.isArray(data.facts)) data.facts = JSON.parse(JSON.stringify(INITIAL_FACTS));
      if (!Array.isArray(data.drafts)) data.drafts = [];
      if (!data.visualSettings) data.visualSettings = JSON.parse(JSON.stringify(INITIAL_VISUAL_SETTINGS));
      return data;
    }
  } catch (err) {
    console.warn(`[WorkspaceStore] Error reading workspace ${safeId}, re-seeding:`, err.message);
  }

  // Create new seeded workspace
  const newWs = getInitialWorkspaceData(safeId);
  saveWorkspace(safeId, newWs);
  return newWs;
}

export function saveWorkspace(workspaceId, data) {
  const safeId = sanitizeWorkspaceId(workspaceId);
  const filePath = getFilePath(safeId);
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[WorkspaceStore] Failed to save workspace ${safeId}:`, err.message);
  }
}

export function resetWorkspace(workspaceId) {
  const safeId = sanitizeWorkspaceId(workspaceId);
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
