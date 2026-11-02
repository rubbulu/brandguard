# BrandGuard
### Explainable Pre-Publication Brand Governance Platform

BrandGuard audits marketing copy and visual banners against an organization's brand guidelines, tone rules, approved facts, and accessibility requirements **before** publication. It combines deterministic code checks with Google Gemini to identify violations, explain why they matter, suggest actionable human-in-the-loop fixes, and issue tamper-evident compliance certificates upon sign-off.

---

## Live Demo & Instant Access

* **Live Demo:** [https://brandguard-kbw7.onrender.com](https://brandguard-kbw7.onrender.com)
* **Wake-Up Note:** The demo is hosted on Render's free tier. If the instance has been idle, it may take about a minute to spin up on first load.

### How to Test Without a Login

BrandGuard requires **no registration or password setup** to test:
1. **Quick Role Switcher:** Click the **Viewing as** buttons in the top navigation bar to switch instantly between **Brand Manager**, **Content Creator**, and **Reviewer**.
2. **Demo Access Panel:** Click the **Guide** button or use the first-load welcome panel to access 3 pre-configured demo credentials:
   * **Brand Manager:** `manager@demo` (password: `demo`)
   * **Content Creator:** `creator@demo` (password: `demo`)
   * **Reviewer:** `reviewer@demo` (password: `demo`)
3. **Guest Access:** Click *"Skip, no login needed"* at any time to explore with a private guest workspace.

> **Notice:** Demo accounts are client-side conveniences to simplify role exploration. There is no real authentication, session tracking, or password storage. Please do not submit confidential or personal data.

---

## Key Features

### Round 3 Improvements
1. **Guideline Document Import & Proposal Review Queue:**
   * Import guidelines from `.pdf`, `.docx`, `.txt`, `.md`, or pasted text.
   * Scans for adversarial prompt-injection (SEC-01) and enforces a 2 MB / 15,000 character extraction cutoff.
   * Proposes candidate rules (`R-`) and approved facts (`F-`) with verbatim source sentence quotes.
   * Structured human review queue with Approve, Edit & Approve, Reject, and Undo capabilities.
2. **Self-Healing Guideline Clarification:**
   * Identifies ambiguous or controversial rules flagged $\ge$ 3 times with a dispute rate $\ge$ 40%.
   * Synthesizes 1 plain-language clarifying question and 2–3 clearer wordings using real creator disputes as context.
   * Deterministic fallbacks with plain failure reasons if Gemini is unavailable or rate-limited.
   * Approving a clarification bumps the rule version (v1 $\rightarrow$ v2) and archives version history for compliance auditing.
   * Automatically re-checks stored drafts against clarified wording to demonstrate resolution.
3. **Channel-Specific Tone Profiles & Multi-Channel Comparison:**
   * Custom tone rules per venue: Twitter/Social Media, Marketing Email, Landing Page, Ad Copy/Banner, Blog/Article.
   * Deterministic checks in code: exclamation mark limits (T-03 with run-position highlighting), all-caps word limits (T-05, exempting brand terms), and length boundaries (T-06).
   * Cross-channel audit tool (`/api/compare-channels`) evaluates copy across all venues simultaneously.

### Core Governance & Verification
* **Human-in-the-Loop Decision Board:** Creators can Accept, Edit, or Reject each suggested fix with inline undo.
* **Tidy Spacing on Removal:** Accepting removal fixes ("Remove this phrase") automatically cleans up spacing and punctuation.
* **Visual Banner Auditor:** Analyzes uploaded banners (PNG, JPG, WebP) for WCAG AA contrast (V-01), brand palette alignment (V-02), editable alt-text (V-03), and required disclaimers (V-04).
* **Adversarial Injection Scanner (SEC-01):** Blocks prompt injections designed to hijack review systems. Reviewers receive a 3-state alert banner blocking unverified sign-offs.
* **Tamper-Evident Compliance Certificate:** Reviewer approvals generate a signed certificate with a canonical SHA-256 hash and HMAC-SHA256 signature, QR code, public verification page, and interactive in-memory tamper demonstration.
* **Actionable Insights:** Tracks real-time governance metrics, validator drop statistics, dispute rates, and top-violated guidelines.

---

## Architecture Overview

BrandGuard is built as a lightweight, auditable two-tier web application:
* **Frontend:** React 18 single-page application built with Vite and styled with Tailwind CSS. It communicates with the backend via REST endpoints and features interactive diff rendering and QR code generation.
* **Backend:** Node.js and Express REST API service orchestrating deterministic rule validation, image processing with Sharp, and Gemini model calls.
* **AI Engine:** Google Gemini via Google AI Studio (`GEMINI_MODEL`, defaulting to `gemini-flash-lite-latest`) for copy analysis, banner OCR, and guideline proposal extraction. Deterministic checks (T-03, T-05, T-06, SEC-01, contrast, palette) execute purely in native code.
* **Storage:** JSON file persistence on disk per workspace (`server/data/workspaces/`) and certificate (`server/data/certificates/`) with atomic writes (`writeFileSyncAtomic`), per-file serializing lock queues, and bounded LRU caches (`ExpiringLRUCache`).

For complete technical specifications, see [ARCHITECTURE_NOTES.md](file:///ARCHITECTURE_NOTES.md) and [docs/ROUND3_CHANGES.md](file:///docs/ROUND3_CHANGES.md).

---

## Project Structure

```text
brandguard/
├── .env.example              # Template environment variables
├── ARCHITECTURE_NOTES.md     # In-depth architectural blueprint and API catalog
├── package.json              # Monorepo scripts (build, test, start)
├── README.md                 # Project guide and overview
├── render.yaml               # Cloud deployment blueprint
│
├── docs/
│   └── ROUND3_CHANGES.md     # Detailed documentation of Round 3 changes
│
├── client/                   # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx           # Main workspace application controller
│   │   ├── components/       # Modals, certificates, verify page, redline diff
│   │   └── utils/            # Phrase-level redline diffing utilities
│   └── package.json
│
└── server/                   # Node.js + Express backend
    ├── index.js              # REST endpoints & server lifecycle
    ├── validator.js          # Deterministic rules, tone profiles & deduplication
    ├── securityScanner.js    # SEC-01 prompt-injection detection
    ├── guidelineService.js   # Document import & proposal queue
    ├── clarificationService.js # Dispute detection & clarification generator
    ├── certificateService.js # Canonical JSON, SHA-256 & HMAC signing
    ├── visualAuditor.js      # Sharp image processing & WCAG contrast
    ├── lruCache.js           # Atomic file writes, serializing queue & LRU cache
    ├── test/                 # 60 automated unit & integration tests
    └── package.json
```

---

## Prerequisites

* **Node.js:** v18.0.0 or higher (v20+ recommended)
* **npm:** v9.0.0 or higher
* **Google Gemini API Key:** (Optional for deterministic tests; required for live AI reviews and document extraction). Obtain one at [Google AI Studio](https://aistudio.google.com/).

---

## Installation & Local Setup

### 1. Clone the Repository
```bash
git clone https://github.com/rubbulu/brandguard.git
cd brandguard
```

### 2. Install Dependencies
Install dependencies for both client and server from the root directory:
```bash
npm run install:all
```

### 3. Configure Environment Variables
Copy `.env.example` to `server/.env`:
```bash
# On Linux / macOS
cp .env.example server/.env

# On Windows PowerShell
copy .env.example server\.env
```

Edit `server/.env` with your preferred settings:
```ini
PORT=5000
NODE_ENV=development
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-lite-latest
CERT_SECRET=your_custom_secret_key_here
```

---

## Running the Application

### Option A: Development Mode (Two Terminals)
Run client and server concurrently with hot reload:

**Terminal 1 (Backend):**
```bash
npm run server
# Server listening on http://localhost:5000
```

**Terminal 2 (Frontend):**
```bash
npm run client
# Vite client running on http://localhost:3000 (proxies /api to :5000)
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Option B: Production Build & Start (Single Unified Service)
Build the frontend and run the production Express server:
```bash
npm run build
npm start
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5000` | Port for the Express backend server. |
| `NODE_ENV` | No | `development` | Set to `production` for production environments. |
| `GEMINI_API_KEY` | Yes (for AI) | `""` | Google AI Studio API key used for copy review, OCR, and document proposals. |
| `GEMINI_MODEL` | No | `gemini-flash-lite-latest` | Model alias for Gemini API requests. |
| `CERT_SECRET` | Production | Dev fallback | Cryptographic secret for signing HMAC-SHA256 compliance certificates. Required when `NODE_ENV=production`. |

---

## Running Tests

BrandGuard includes a comprehensive test suite of **60 automated tests across 6 suites**, covering deterministic tone checks, document imports, guideline clarification, removal fixes, storage reliability, and demo access:

```bash
npm test
```

### Test Suite Summary
```text
▶ Channel-Specific Tone Profiles & Checks (8 tests)
▶ Guideline Document Import & Proposal Processing (12 tests)
▶ Self-Healing Guideline Clarification (19 tests)
▶ Round 3: Removal, Security, Design Fixes & Certificate Verification (12 tests)
▶ Storage and Reliability Hardening (6 tests)
▶ Demo Access Panel & Role Selection (3 tests)

Total: 60 passed, 0 failed
```

---

## Deploying on Render

BrandGuard deploys to Render as a unified Web Service using `render.yaml`:

1. Fork or push this repository to GitHub.
2. In the Render Dashboard, click **New +** $\rightarrow$ **Blueprint** and connect your repository.
3. Configure the following environment settings:
   * **Build Command:** `npm run build`
   * **Start Command:** `npm start`
4. Set required Environment Variables in Render:
   * `NODE_ENV`: `production`
   * `GEMINI_API_KEY`: *(Your Google AI Studio API key)*
   * `GEMINI_MODEL`: `gemini-flash-lite-latest`
   * `CERT_SECRET`: *(A long, random cryptographic string)*
   * `PORT`: `5000`

---

## Known Limitations

* **Ephemeral Disk on Free Hosting:** On Render's free tier, the container disk is ephemeral. Server sleep or redeployment clears stored workspace JSON files. BrandGuard detects missing workspaces, displays a reset notification, and provisions a clean workspace.
* **Certificate Verification After Reset:** Compliance certificates can be verified through the exported JSON payload (`POST /api/verify`) even if ephemeral server files were cleared.
* **API Response Time Variance:** Analysis duration depends on Google Gemini API response latency (typically 3–8 seconds; may occasionally take longer under heavy API load).
* **Dense Diagrams & Small Text:** Banner OCR performs reliably on marketing headlines, body copy, and disclaimers, but dense diagrams or tiny footnotes may not always be extracted.
* **Model-Assisted Logo Detection:** Logo bounding box and presence detection rely on multi-modal Gemini estimates, which can occasionally misclassify stylized icons.
* **Alt-Text Preservation:** Accepting copy fixes updates the written text, but does not automatically rewrite visual alt-text; content creators can edit alt-text directly in the Banner Review tab.
* **Scanned Image PDFs:** Guideline import extracts text from digital PDFs and Word documents (`.pdf`, `.docx`, `.txt`, `.md`). Scanned PDFs (pure bitmap images without a selectable text layer) require OCR and are not extracted by standard text parsers.

---

## Product Roadmap

1. **OCR for Scanned Document Guidelines:** Add multi-modal OCR ingestion for scanned print PDF brand guideline booklets.
2. **Multi-Tenant SSO & Role-Based Access Control:** Implement enterprise OAuth2 / SAML authentication (Okta, Google Workspace, Azure AD) with granular role permissions.
3. **Figma & Adobe Creative Cloud Plugins:** Direct integrations to flag brand violations directly inside design canvases before exporting assets.
4. **CMS & Social Media Webhook Automation:** Pre-publication gating webhooks for WordPress, Contentful, HubSpot, and Hootsuite to prevent uncertified publishing.
5. **Multi-Language Brand Rules:** Extend rule and tone validation to multilingual copy with locale-specific brand terminology.
6. **Custom LLM Fine-Tuning & Vector Store:** Supplement Gemini prompt guidelines with vector embeddings (RAG) for enterprise libraries containing hundreds of localized rules.

---

## AI Tools Disclosure

* **Google Gemini (Google AI Studio):** Powers runtime features: text copy review, visual banner OCR, guideline proposal extraction, and clarification question generation.
* **AI Coding Assistants:** Built with the assistance of Antigravity (Google DeepMind) and Claude (Anthropic) for code implementation, test suite generation, architecture planning, and documentation drafting. All code, design decisions, and test results were verified, audited, and tested by the author.

---

## License

This project is licensed under the [MIT License](file:///LICENSE).
