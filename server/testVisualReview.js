import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testBanner(filename, label) {
  console.log(`\n========================================`);
  console.log(`TESTING BANNER: ${label} (${filename})`);
  console.log(`========================================`);

  const filePath = path.join(__dirname, "../client/public/samples", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const base64Image = fs.readFileSync(filePath).toString("base64");
  const t0 = Date.now();

  const res = await fetch("http://localhost:5000/api/visual-review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": `test-ws-${Date.now()}`
    },
    body: JSON.stringify({
      image: base64Image,
      draftTitle: `${label} Visual Audit`,
      channel: "Social / Ad Banner"
    })
  });

  const elapsed = Date.now() - t0;
  console.log(`Status: ${res.status} (${elapsed}ms)`);
  const data = await res.json();

  if (!res.ok) {
    console.error("Error response:", data);
    return;
  }

  console.log(`Extracted text: "${data.extracted_text}"`);
  console.log(`Text regions detected: ${data.regions?.length || 0}`);
  console.log(`Alt-text: "${data.alt_text}"`);
  console.log(`Has logo: ${data.has_logo}`);
  console.log(`Findings count: ${data.findings?.length || 0}`);
  
  console.log("\nFindings breakdown:");
  (data.findings || []).forEach((f, i) => {
    console.log(` [${i+1}] ${f.rule_id} (${f.source}): "${f.quote}" -> ${f.explanation.slice(0, 90)}...`);
  });

  console.log("\nContrast results:", data.contrast_results);
  console.log("Palette summary:", data.palette_summary);
  console.log("Stats (kept / dropped):", data.stats);

  return data;
}

async function runAll() {
  await testBanner("bad-banner.png", "1. BAD BANNER");
  await testBanner("clean-banner.png", "2. CLEAN BANNER");
  await testBanner("injection-banner.png", "3. INJECTION BANNER");
}

runAll().catch(console.error);
