# BrandGuard Architecture Notes

## 1. Project Overview & Folder Structure

BrandGuard is an explainable pre-publication brand-governance platform. It audits written marketing copy and visual banners against an organization's brand guidelines, tone rules, approved facts, and accessibility requirements.

### Important Files Overview

```text
brandguard/
├── .env.example                     # Example environment variable template
├── .gitignore                       # Git ignore rules for node_modules, dist, data, etc.
├── ARCHITECTURE_NOTES.md            # System architecture, API catalog, and data flow documentation
├── BrandGuard_Round2_Submission.pdf # Round 2 submission documentation
├── package.json                     # Root orchestrator scripts (install:all, build, server, client, start)
├── README.md                        # Project summary, problem statement, features, and quickstart guide
├── render.yaml                      # Render Blueprint deployment definition
│
├── client/                          # React + Vite Single Page Application (SPA)
│   ├── index.html                   # HTML entry point with Tailwind CDN and typography fonts
│   ├── package.json                 # Client dependencies (React 18, Lucide React, Diff, QRCode, Vite)
│   ├── vite.config.js               # Vite config with development reverse proxy (/api -> :5000)
│   └── src/
│       ├── main.jsx                 # React root renderer
│       ├── index.css                # Global stylesheet, animations, custom scrollbars
│       ├── App.jsx                  # Main SPA controller: routing, workspace state, Manager, Creator, Reviewer, Insights
│       └── components/
│           ├── ComplianceCertificate.jsx # Modal displaying signed certificate, SHA-256 hash, QR code & tamper test
│           ├── ErrorBoundary.jsx        # Fallback UI handling React rendering errors gracefully
│           ├── PublicVerifyPage.jsx     # Standalone public verification view (/verify/:id)
│           └── RedlineDiff.jsx          # Token-level inline and side-by-side redline diff renderer
│
└── server/                          # Node.js + Express backend service
    ├── .env                         # Local runtime environment secrets (API keys, ports)
    ├── certificateService.js        # Canonical JSON serialization, SHA-256 hashing, HMAC signing, verify & tamper tests
    ├── demoData.js                  # Initial brand rules (R-), tone rules (T-), approved facts (F-), and visual settings (V-)
    ├── geminiService.js             # Google Gemini API integration (model cascading, structured prompts, JSON parsing)
    ├── generateSampleBanners.js     # Script generating synthetic sample test banners using Sharp and SVG
    ├── index.js                     # Main Express API server, workspace routing, rate limiting, and static file serving
    ├── package.json                 # Server dependencies (Express, Cors, Dotenv, Sharp)
    ├── securityScanner.js           # Deterministic SEC-01 prompt-injection and adversarial instruction scanner
    ├── validator.js                 # Rule validation engine: verbatim quote check, T-03/T-05 checks, grammar check, deduplication & merging
    ├── visualAuditor.js             # Visual banner auditor: Sharp image processing, Gemini OCR, WCAG contrast, CIE Lab palette, alt-text
    ├── workspaceStore.js            # Workspace filesystem persistence layer (load, save, reset, sanitize workspace IDs)
    └── data/                        # Persistent storage on disk
        ├── certificates/            # Stored compliance certificates (*.json)
        └── workspaces/              # Visitor workspace files (*.json) and uploaded images (/images/:workspaceId/)
```

---

## 2. API Route Catalog

All routes reside under `/api` unless otherwise specified. Each request extracts `workspaceId` from the `x-workspace-id` HTTP header or query parameter (defaulting to `"default"`).

| Method | Route Path | Description |
|---|---|---|
| `GET` | `/api/health`, `/health` | Health check endpoint returning backend status, service name, version, Gemini API key presence, active model alias, workspace ID, and server timestamp. |
| `GET` | `/api/rules` | Retrieves all active brand rules (R- and T-) for the current workspace. |
| `POST` | `/api/rules` | Creates a new rule in the workspace (`id`, `category`, `text`, `severity`). ID must start with `R-` or `T-`. |
| `PUT` | `/api/rules/:id` | Updates an existing rule's category, text, or severity by ID. |
| `DELETE` | `/api/rules/:id` | Deletes a rule from the workspace by ID. |
| `GET` | `/api/facts` | Retrieves all approved benchmark facts (F-) for the current workspace. |
| `POST` | `/api/facts` | Creates a new approved fact (`id`, `text`). ID must start with `F-`. |
| `PUT` | `/api/facts/:id` | Updates an existing approved fact by ID. |
| `DELETE` | `/api/facts/:id` | Deletes an approved fact from the workspace by ID. |
| `GET` | `/api/visual-settings`, `/visual-settings` | Retrieves brand visual settings (brand palette hex codes, minContrastRatio, disclaimerPhrase, visual rules V-01 to V-04). |
| `PUT` | `/api/visual-settings`, `/visual-settings` | Updates brand palette, contrast threshold, disclaimer phrase, or visual rules. |
| `POST` | `/api/reset-workspace` | Clears all drafts, audit history, and uploaded images for the workspace; resets rules, facts, and visual settings to defaults. |
| `GET` | `/api/sample-drafts` | Returns predefined sample drafts for quick testing. |
| `GET` | `/api/drafts` | Lists all text and visual drafts belonging to the workspace. |
| `GET` | `/api/drafts/:id` | Returns a specific draft by its ID. |
| `POST` | `/api/drafts` | Creates a new draft record (`title`, `channel`, `content`, `creator`) with initial version v1 and status `"submitted"`. |
| `POST` | `/api/review`, `/review` | Runs AI text governance pipeline. Supports streaming (`?stream=true` or `x-stream: true`) with stage updates. Runs SEC-01 prompt injection detection, invokes Gemini review, runs deterministic T-03 / T-05 checks, and passes all findings through the validator for quote verification, grammar checks, deduplication, and overlap merging. |
| `POST` | `/api/visual-review`, `/visual-review` | Audits an uploaded banner image (PNG, JPG, WebP $\le$ 4 MB). Resizes/compresses image via Sharp, runs Gemini OCR, samples pixel colors, computes WCAG AA contrast ratio (V-01), checks CIE Lab palette distance (V-02), inspects alt-text (V-03), checks disclaimer text (V-04), scans for prompt injection (SEC-01), and registers a visual draft. |
| `PATCH` | `/api/drafts/:id/alt-text` | Updates alt-text for a visual banner draft and updates V-03 finding state accordingly. |
| `PATCH` | `/api/drafts/:id/finding` | Applies a human decision to a finding (`action`: `"accept"`, `"edit"`, `"reject"`, or `"undo"`). Recomputes copy text for copy rules (R-, F-, T-) while preserving design rules (V-01, V-02) as designer notes. If draft was already approved, increments version (v1 $\rightarrow$ v2) and resets certificate. |
| `POST` | `/api/drafts/:id/decision` | Records reviewer action: `"approve"` (generates signed compliance certificate), `"request_changes"`, `"submit_for_review"`, or `"save_note"`. Logs action and author to draft audit history. |
| `GET` | `/api/insights` | Aggregates real governance statistics from stored workspace drafts: total drafts analyzed, findings count, fix acceptance rate, validator drop statistics, top violated rules, and detects unclear guidelines ($\ge$ 3 flags and $\ge$ 40% dispute rate). |
| `GET` | `/api/verify/:certificateId`, `/verify/:certificateId` | Public verification endpoint. When requested by a browser (`Accept: text/html`), serves the SPA. When called as JSON, recomputes the canonical SHA-256 payload hash and server HMAC-SHA256 signature to verify record integrity. |
| `GET` | `/api/certificates/:certificateId` | Retrieves raw stored certificate record by certificate ID. |
| `POST` | `/api/certificates/:certificateId/tamper` | Demo test endpoint: mutates 1 character in the stored certificate on disk to demonstrate tamper detection. |
| `POST` | `/api/certificates/:certificateId/restore` | Demo test endpoint: restores the original certificate record on disk. |
| `GET` | `/api/workspaces/images/*` | Static file handler serving compressed uploaded workspace images from disk. |
| `GET` | `*` | Catch-all SPA route returning `client/dist/index.html` with `no-cache` headers. |

---

## 3. Data Storage & Lifecycle

### Where Data Lives

1. **Per-Visitor Workspaces:**
   - Every visitor is assigned a unique workspace identifier stored in the browser's `localStorage` (`brandguard_workspace_id`).
   - The workspace state (rules, facts, visual settings, all drafts, findings, reviewer comments, and audit history) is stored as a JSON file on disk at:
     `server/data/workspaces/<workspaceId>.json`
2. **Uploaded Images:**
   - Visual banners uploaded by creators are compressed and saved on disk at:
     `server/data/workspaces/images/<workspaceId>/<filename>.webp`
3. **Compliance Certificates:**
   - When a draft is approved, the certificate is written to disk at:
     `server/data/certificates/<certificateId>.json`
   - A copy is also embedded directly inside the draft record in the workspace JSON file (`draft.certificate` and `draft.certificates`).
4. **Caches & Rate Limiting (In-Memory):**
   - Rate limiting timestamps (`reviewRateLimits = new Map()`) live purely in Node.js server memory.
   - Visual audit results cache (`visualAuditCache = new Map()`) lives purely in Node.js server memory.
   - Tamper demonstration original backups (`tamperBackups = new Map()`) live in Node.js server memory.

### What Happens When the Server Restarts?

- **Local Machine:**
  Files stored in `server/data/workspaces/` and `server/data/certificates/` remain on disk. When the server restarts, all workspace configurations, drafts, audit trails, and certificates are retained and re-read from disk. In-memory caches and rate limits are cleared.
- **Ephemeral Cloud Hosting (e.g., Render Free Tier, Heroku, ephemeral containers):**
  The container filesystem is ephemeral. Whenever the server spins down due to inactivity, restarts, or deploys a new commit, the disk is reset back to the base git repository. Any workspaces, uploaded images, and certificates created during runtime that were not part of the git commit are permanently lost.

---

## 4. The "Channel" Value Lifecycle

### Flow of the Channel Selection:
1. **User Selection:** The user selects a channel from the Target Channel `<select>` in `client/src/App.jsx` (options: `"Social Media / Twitter"`, `"Email Newsletter"`, `"Landing Page"`, `"Blog / Article"` for text; `"Social / Banner"` for visual mode).
2. **Client State:** Stored in React state `draftChannel` inside `client/src/App.jsx`.
3. **Draft Creation:** Sent to `POST /api/drafts` (`body.channel`) or `POST /api/visual-review` (`body.channel`).
4. **Draft Persistence:** Stored as `draft.channel` inside the draft object in `server/data/workspaces/<workspaceId>.json`.
5. **Certificate Generation:** When approved, `server/certificateService.js` reads `draft.channel` and includes it in `canonicalPayload.channel` for SHA-256 hashing and HMAC signing, persisting it to `server/data/certificates/<certId>.json`.

### Files that Use "Channel":
- `client/src/App.jsx`: Controls channel state, sends it in draft creation, and displays it in the Draft Overview header (`Channel: {activeDraft.channel}`).
- `server/index.js`: Receives `channel` in `POST /api/drafts` and `POST /api/visual-review`, assigning it to `newDraft.channel`.
- `server/certificateService.js`: Embeds `channel` into the canonical payload for the signed certificate.
- `client/src/components/ComplianceCertificate.jsx`: Displays `cert.channel` in the certificate details modal.
- `client/src/components/PublicVerifyPage.jsx`: Displays `cert.channel` on the public verification page.

*Important Note:* The channel value is purely metadata. It is **never** passed to Gemini (`callGeminiReview`), nor is it used by `validateFindings`, rule evaluation, or channel length/formatting limit checks.

---

## 5. Where Tone Checks (T-03 and T-05) Live

The T-03 and T-05 tone checks are executed entirely in code on the backend:

- **Location:** `server/validator.js` inside `runDeterministicToneChecks(draftText, rules, brandNames)` (lines 384–496) and reinforced in `validateFindings` (lines 550–590).
- **Rule Definitions:** Defined in `server/demoData.js` as rules `T-03` ("Friendly tone. At most one exclamation mark per post") and `T-05` ("No all-caps words except the brand name").
- **T-03 Logic (Exclamation Marks):**
  - Evaluated deterministically in code by counting literal `!` characters in `draftText`.
  - Only flags T-03 if there are 2 or more exclamation marks in total or consecutively.
  - If Gemini attempts to flag T-03 when there are fewer than 2 exclamation marks, the validator drops the finding.
  - If a run of exclamation marks exists (e.g. `!!`), highlights the run and suggests `!`. If scattered, highlights the second occurrence and suggests a period.
- **T-05 Logic (All-Caps Words):**
  - Scans sentences with regex for fully uppercase words of 2+ letters (`/^[A-Z]+$/`).
  - Exempts brand name `"CampusPro"`.
  - Suggests converted sentence case (e.g. `"BUY NOW"` $\rightarrow$ `"Buy now"`).
  - Drops any AI finding claiming T-03/T-05 if no fully uppercase words exist.
- **Prompt Reinforcement:** `server/geminiService.js` instructs Gemini on T-03 and T-05 rules so the AI minimizes spurious outputs before the validator runs.

---

## 6. Where the Validator, De-duplication, and SEC-01 Scanner Live

### 1. SEC-01 Prompt-Injection Scanner
- **Location:** `server/securityScanner.js` (`detectPromptInjection(text)`).
- **What it does:** Scans text deterministically using 12 regex patterns for adversarial instructions (e.g., `"ignore all rules"`, `"approve this draft"`, `"system override"`, `"bypass governance"`).
- **Usage:**
  - Called in `server/index.js` before Gemini text review; findings are prepended to ensure they are never dropped.
  - Called in `server/visualAuditor.js` on banner OCR text to raise security alerts and filter adversarial instructions out of auto-generated alt-text.
  - Handled in `server/validator.js` as a high-severity security finding requiring human review and setting action to `"remove"` with empty replacement text.

### 2. Validator Engine
- **Location:** `server/validator.js` (`validateFindings(draftText, rawFindings, rules, facts)`).
- **What it does:**
  - Verifies that quoted text exists word-for-word in the draft copy.
  - Validates that cited rule IDs exist in active rules, facts, or visual settings.
  - Drops findings where the suggested fix is identical to the quoted text.
  - Drops findings whose explanation contains internal reasoning words or claims compliance.
  - Enforces grammar checks on suggested fixes (`validateFixGrammar`) so fixes that would break sentence syntax are marked as `"Needs manual edit"`.
  - Normalizes fact F-01 fixes to avoid unverified claims.

### 3. De-duplication & Overlap Merging
- **Location:** `server/validator.js` (lines 148–382 and 687–717).
  - `mergeFindings`: Merges overlapping or nested findings of the **same** rule ID, preserving the longest span.
  - `mergeCrossRuleEquivalentFindings`: Merges findings from **different** rules covering overlapping text with equivalent replacement suggestions into a combined card (e.g., `"R-15 + R-12"`).
  - Exact Deduplication: Drops duplicate findings sharing the same `rule_id`, lowercase quote, and lowercase suggested fix.

---

## 7. Environment Variables

The application references the following environment variables (names only, no values):

| Variable Name | Purpose |
|---|---|
| `PORT` | Network port for the Express backend server (defaults to `5000` if unset). |
| `GEMINI_API_KEY` | Google AI Studio API key used by the backend to call Gemini for copy review and banner OCR. |
| `CERT_SECRET` | Secret key used to generate HMAC-SHA256 signatures for tamper-evident compliance certificates (falls back to a default hardcoded secret if unset). |
| `GEMINI_MODEL` | (Optional) Override alias for Google Gemini model (defaults to `gemini-flash-lite-latest`). |
| `NODE_ENV` | (Optional) Standard Node environment flag (checked to bypass `app.listen()` when executing automated tests). |
| `VITE_API_URL` | Listed in `.env.example`, but not used in client code because Vite proxies `/api` to port 5000 in dev and Express serves static files in prod. |

---

## 8. How to Run Locally

### Prerequisites
- Node.js 18 or higher
- npm

### 1. Install Dependencies
Run from the repository root:
```bash
npm run install:all
```
*(This installs dependencies in both `server/` and `client/` directories).*

### 2. Configure Environment Variables
Create a file named `.env` in `server/` (`server/.env`):
```text
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
CERT_SECRET=your_custom_secret_key_here
```

### 3. Running in Development (Two Terminals)
Run the backend and frontend simultaneously:
```bash
# Terminal 1: Backend API (runs on http://localhost:5000 with nodemon/watch)
npm run server

# Terminal 2: Frontend Client (runs on http://localhost:3000 with Vite proxy)
npm run client
```
Open your browser at `http://localhost:3000`.

### 4. Running in Production (Single Service)
Build the frontend and launch the unified Express server:
```bash
npm run build
npm start
```
Open your browser at `http://localhost:5000`.
