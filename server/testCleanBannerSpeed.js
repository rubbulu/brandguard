import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runVisualAudit } from './visualAuditor.js';

dotenv.config();
const apiKey = process.env.GEMINI_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cleanBannerPath = path.join(__dirname, '../client/public/samples/clean-banner.png');
const imageBuffer = fs.readFileSync(cleanBannerPath);

console.log("=== RUNNING BENCHMARK ON clean-banner.png ===");

// Run 1: Cold Run
console.log("\n--- RUN 1: Cold Run ---");
const t0 = Date.now();
const res1 = await runVisualAudit({
  imageBuffer,
  visualSettings: {
    palette: ["#1D4ED8", "#0F172A", "#FFFFFF", "#F59E0B"],
    minContrastRatio: 4.5
  },
  rules: [
    { id: "R-01", text: "No superlatives without verifiable proof." }
  ],
  facts: [
    { id: "F-01", text: "CampusPro weighs 1.4 kg with a 2-year warranty." }
  ],
  apiKey,
  workspaceId: "bench-ws",
  onStage: (stage, label, dur) => {
    console.log(`  ✓ Stage [${stage}]: ${label} (${dur}ms)`);
  }
});
const totalElapsed1 = Date.now() - t0;
console.log("Run 1 Finished in:", totalElapsed1, "ms");
console.log("Run 1 timings_ms:", res1.timings_ms);
console.log("Extracted text:", res1.extracted_text);
console.log("Findings count:", res1.findings.length);

// Run 2: Cached Run
console.log("\n--- RUN 2: Cached Run (Instant SHA-256) ---");
const t1 = Date.now();
const res2 = await runVisualAudit({
  imageBuffer,
  visualSettings: {
    palette: ["#1D4ED8", "#0F172A", "#FFFFFF", "#F59E0B"],
    minContrastRatio: 4.5
  },
  rules: [
    { id: "R-01", text: "No superlatives without verifiable proof." }
  ],
  facts: [
    { id: "F-01", text: "CampusPro weighs 1.4 kg with a 2-year warranty." }
  ],
  apiKey,
  workspaceId: "bench-ws",
  onStage: (stage, label, dur) => {
    console.log(`  ✓ Stage [${stage}]: ${label} (${dur}ms)`);
  }
});
const totalElapsed2 = Date.now() - t1;
console.log("Run 2 Finished in:", totalElapsed2, "ms");
console.log("Run 2 timings_ms:", res2.timings_ms);
