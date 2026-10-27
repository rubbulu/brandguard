import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runVisualAudit } from './visualAuditor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
const apiKey = process.env.GEMINI_API_KEY;

const sampleDir = path.join(__dirname, '../client/public/samples');
const visualSettings = {
  palette: ["#1D4ED8", "#0F172A", "#FFFFFF", "#F59E0B"],
  minContrastRatio: 4.5
};
const rules = [
  { id: "R-01", text: "No superlatives without verifiable proof." }
];
const facts = [
  { id: "F-01", text: "CampusPro weighs 1.4 kg with a 2-year warranty." }
];

async function testBanner(filename, bannerName) {
  console.log(`\n======================================================`);
  console.log(`TESTING: ${bannerName} (${filename})`);
  console.log(`======================================================`);

  const filePath = path.join(sampleDir, filename);
  const imageBuffer = fs.readFileSync(filePath);

  const t0 = Date.now();
  const res = await runVisualAudit({
    imageBuffer,
    visualSettings,
    rules,
    facts,
    apiKey,
    workspaceId: "test-all-ws",
    onStage: (stage, label, dur) => {
      console.log(`  -> [${stage}] ${label} (${dur}ms)`);
    }
  });
  const total = Date.now() - t0;

  console.log(`\n--- RESULTS FOR ${bannerName} ---`);
  console.log(`Total duration: ${total}ms`);
  console.log(`Timings:`, res.timings_ms);
  console.log(`Extracted text: "${res.extracted_text}"`);
  console.log(`Alt text: "${res.alt_text}"`);
  console.log(`Logo detected: ${res.has_logo}`);
  
  console.log(`\n[ITEM 1: PALETTE SUMMARY]`);
  console.log(`Status: ${res.palette_summary?.status}`);
  console.log(`Measured: ${res.palette_summary?.measured}`);
  console.log(`On-Palette %: ${res.palette_summary?.on_palette_percentage}%`);
  console.log(`Off-Palette %: ${res.palette_summary?.off_palette_percentage}%`);
  console.log(`Top off-palette colors:`, res.palette_summary?.top_off_palette_hex);

  console.log(`\n[ITEM 2 & 3: CONTRAST & BOX WIDTH EXTENT]`);
  res.contrast_results?.forEach((cr, i) => {
    const reg = res.regions[i];
    console.log(`Region ${i+1}: "${cr.text}"`);
    console.log(`  Box bounds: x=${reg?.x}, y=${reg?.y}, w=${reg?.w}, h=${reg?.h}`);
    console.log(`  Calc type: [${cr.calculationType}], Ratio: ${cr.ratio}:1 (passes: ${cr.passes})`);
    console.log(`  Colors: Text ${cr.foregroundHex} on Background ${cr.backgroundHex}`);
  });

  console.log(`\n[ITEM 5: FINDINGS & DEDUPE]`);
  console.log(`Total findings: ${res.findings.length}`);
  res.findings.forEach(f => {
    console.log(`  - [${f.rule_id}] (${f.severity}) Quote: "${f.quote}"`);
    console.log(`    Explanation: ${f.explanation}`);
    console.log(`    Action: ${f.action || 'none'}, Fix: "${f.suggested_fix || ''}"`);
  });

  console.log(`\n[ITEM 6: VALIDATOR DROPPED / MERGED]`);
  console.log(`Validator stats:`, res.stats);
  console.log(`Dropped items:`, res.validatorRejected);
  console.log(`Merged items:`, res.validatorMerged);

  return res;
}

async function run() {
  // Test clean banner
  const cleanRes = await testBanner('clean-banner.png', 'Clean Banner');

  // Test bad banner
  const badRes = await testBanner('bad-banner.png', 'Bad Banner (Pink/Purple/Green)');

  // Test injection banner
  const injRes = await testBanner('injection-banner.png', 'Injection Banner');

  console.log(`\n\n======================================================`);
  console.log(`TESTING CACHE (Repeat Clean Banner)`);
  console.log(`======================================================`);
  const tCache = Date.now();
  const cachedRes = await runVisualAudit({
    imageBuffer: fs.readFileSync(path.join(sampleDir, 'clean-banner.png')),
    visualSettings,
    rules,
    facts,
    apiKey,
    workspaceId: "test-all-ws"
  });
  console.log(`Repeat cached call finished in: ${Date.now() - tCache}ms`);
  console.log(`Cached timings:`, cachedRes.timings_ms);
}

run().catch(err => {
  console.error("Benchmark failed with error:", err);
});
