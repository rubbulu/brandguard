# BrandGuard Architecture Notes

## 1. Project Overview & Folder Structure

BrandGuard is an explainable pre-publication brand-governance platform. It audits written marketing copy and visual banners against an organization's brand guidelines, tone rules, approved facts, and accessibility requirements.

### Repository Layout

```text
brandguard/
├── .env.example                     # Example environment variable template (5 runtime variables)
├── .gitignore                       # Git ignore rules for node_modules, dist, data, .env, etc.
├── ARCHITECTURE_NOTES.md            # System architecture, API catalog, and data flow documentation
├── BrandGuard_Round2_Submission.pdf # Round 2 submission documentation
├── package.json                     # Root orchestrator scripts (install:all, build, server, client, test, start)
├── README.md                        # Project summary, quickstart, demo access, limitations, and roadmap
├── render.yaml                      # Render Blueprint deployment definition
│
├── docs/
│   └── ROUND3_CHANGES.md            # Detailed documentation of Round 3 features, hardening, and test suites
│
├── client/                          # React + Vite Single Page Application (SPA)
│   ├── index.html                   # HTML entry point with Tailwind CDN and typography fonts
│   ├── package.json                 # Client dependencies (React 18, Lucide React, Diff, QRCode, Vite)
│   ├── vite.config.js               # Vite config with development reverse proxy (/api -> :5000)
│   └── src/
│       ├── main.jsx                 # React root renderer
│       ├── index.css                # Global stylesheet, animations, custom scrollbars
│       ├── App.jsx                  # Main SPA controller: Workspace state, Demo Access, Manager, Creator, Reviewer, Insights
│       ├── components/
│       │   ├── ComplianceCertificate.jsx # Modal displaying signed certificate, SHA-256 hash, QR code & in-memory tamper test
│       │   ├── ErrorBoundary.jsx        # Fallback UI handling React rendering errors gracefully
│       │   ├── PublicVerifyPage.jsx     # Standalone public verification view (/verify/:id)
│       │   └── RedlineDiff.jsx          # Token-level and phrase-level redline diff renderer
│       └── utils/
│           └── redlineUtils.js          # One-chunk phrase-level redline diff chunking and rule tagging
│
└── server/                          # Node.js + Express backend service
    ├── certificateService.js        # Canonical JSON serialization, SHA-256 hashing, HMAC signing, self-contained verification
    ├── clarificationService.js      # Round 3: Self-healing guideline clarification (dispute detection, Gemini/fallback questions, version bump, re-check)
    ├── demoData.js                  # Initial brand rules (R-), tone rules (T-), approved facts (F-), visual settings (V-), tone profiles, brand terms
    ├── geminiService.js             # Google Gemini API client (GEMINI_MODEL alias, structured prompts, JSON parsing)
    ├── generateSampleBanners.js     # Script generating synthetic sample test banners using Sharp and SVG
    ├── guidelineService.js          # Round 3: Guideline text extraction (.pdf, .docx, .txt, .md), SEC-01 scanning, verbatim quote verification
    ├── index.js                     # Express API server, workspace routing, rate limiting, and static file serving
    ├── lruCache.js                  # ExpiringLRUCache, writeFileSyncAtomic, enqueueFileOperation
    ├── package.json                 # Server dependencies (Express, Cors, Dotenv, Sharp, Mammoth, Pdf-parse)
    ├── securityScanner.js           # Deterministic SEC-01 prompt-injection and adversarial instruction scanner
    ├── validator.js                 # Rule validation engine: verbatim quote check, T-03/T-05/T-06 tone checks, channel profiles, deduplication
    ├── visualAuditor.js             # Visual banner auditor: Sharp image processing, Gemini OCR, WCAG contrast, CIE Lab palette, alt-text
    ├── workspaceStore.js            # Workspace filesystem persistence layer (load, save, reset, sanitize workspace IDs)
    │
    ├── test/                        # Automated unit & integration tests (60 tests across 6 suites)
    │   ├── toneProfiles.test.js     # Channel tone profile resolution, T-03, T-05, T-06 checks, multi-channel comparison
    │   ├── guidelineImport.test.js  # Document extraction, verbatim checks, SEC-01 filtering, review queue operations
    │   ├── clarification.test.js    # Clarification threshold detection, AI validation, version history, draft re-checking
    │   ├── fixesAndCertificates.test.js # Removal fixes, tidy spacing, SEC-01 lines, certificate verification, idempotency
    │   ├── storageReliability.test.js   # Lost workspace reset, self-contained certificates, atomic writes, LRU cache bounds
    │   └── demoAccess.test.js       # Demo access accounts, role switcher integration, skip login
    │
    └── data/                        # Persistent JSON storage on disk (git-ignored)
        ├── certificates/            # Stored compliance certificates (*.json)
        └── workspaces/              # Visitor workspace files (*.json) and uploaded images (/images/:workspaceId/)
```

---

## 2. API Route Catalog

All endpoints reside under `/api` unless otherwise noted. Each request resolves `workspaceId` from the `x-workspace-id` HTTP header or query parameter (defaulting to `"default"`).

| Method | Route Path | Description |
|---|---|---|
| `GET` | `/api/health`, `/health` | Health check returning service status, version, Gemini API key presence, active model alias, workspace ID, and timestamp. |
| `GET` | `/api/workspace/status` | Reports whether the requesting workspace exists on disk or was reset after server sleep/restart. |
| `GET` | `/api/rules` | Retrieves all active brand rules (R- and T-) for the current workspace. |
| `POST` | `/api/rules` | Creates a new rule in the workspace (`id`, `category`, `text`, `severity`). |
| `PUT` | `/api/rules/:id` | Updates an existing rule's category, text, or severity by ID. |
| `DELETE` | `/api/rules/:id` | Deletes a rule from the workspace by ID. |
| `GET` | `/api/facts` | Retrieves all approved benchmark facts (F-) for the current workspace. |
| `POST` | `/api/facts` | Creates a new approved fact (`id`, `text`). |
| `PUT` | `/api/facts/:id` | Updates an existing approved fact by ID. |
| `DELETE` | `/api/facts/:id` | Deletes an approved fact from the workspace by ID. |
| `GET` | `/api/visual-settings` | Retrieves brand visual settings (brand palette hex codes, minContrastRatio, disclaimerPhrase, visual rules V-01 to V-04). |
| `PUT` | `/api/visual-settings` | Updates brand palette, contrast threshold, disclaimer phrase, or visual rules. |
| `POST` | `/api/reset-workspace` | Clears all drafts, audit history, and uploaded images for the workspace; restores default rules, facts, and settings. |
| `GET` | `/api/sample-drafts` | Returns predefined sample drafts for quick testing. |
| `GET` | `/api/drafts` | Lists all text and visual drafts belonging to the workspace. |
| `GET` | `/api/drafts/:id` | Returns a specific draft by its ID. |
| `POST` | `/api/drafts` | Creates a new draft record (`title`, `channel`, `content`, `creator`) with version v1 and status `"submitted"`. |
| `POST` | `/api/review`, `/review` | Runs the AI text governance pipeline. Scans SEC-01 prompt injection, calls Gemini for copy analysis, applies deterministic T-03/T-05/T-06 checks, and runs the validator for quote verification, grammar checks, and deduplication. |
| `POST` | `/api/visual-review` | Audits an uploaded banner image (PNG, JPG, WebP $\le$ 4 MB). Resizes/compresses image via Sharp, runs Gemini OCR, samples pixel colors, computes WCAG AA contrast ratio (V-01), checks CIE Lab palette distance (V-02), inspects alt-text (V-03), and checks disclaimers (V-04). |
| `PATCH` | `/api/drafts/:id/alt-text` | Updates alt-text for a visual banner draft and updates V-03 finding state accordingly. |
| `PATCH` | `/api/drafts/:id/finding` | Applies a human decision to a finding (`"accept"`, `"edit"`, `"reject"`, or `"undo"`). Recomputes copy text for copy rules with tidy spacing while preserving design rules as designer notes. Increments draft version if already approved. |
| `POST` | `/api/drafts/:id/decision` | Records reviewer action: `"approve"` (generates signed compliance certificate), `"request_changes"`, `"submit_for_review"`, or `"save_note"`. Logs action and author to draft audit history. Idempotent against double clicks. |
| `POST` | `/api/guidelines/extract` | Round 3: Extracts brand rules and facts from uploaded document (.txt, .md, .docx, .pdf) or pasted text. Enforces 2 MB file and 15,000 char limits, deterministic SEC-01 scan, and Gemini proposals with verbatim quote verification. |
| `GET` | `/api/guidelines/proposals` | Retrieves active guideline proposals and last import stats. |
| `POST` | `/api/guidelines/proposals/:id/decide` | Decides proposal (`"approve"`, `"edit_and_approve"`, `"reject"`). Sequential ID assignment, audit logging, and double-decision prevention. |
| `POST` | `/api/guidelines/proposals/:id/undo` | Undoes proposal approval, removes item from active library, and restores proposal to pending. |
| `DELETE` | `/api/guidelines/proposals` | Clears all proposals from the human review queue. |
| `GET` | `/api/clarifications` | Round 3: Evaluates rules against dispute threshold ($\ge$ 3 flags, $\ge$ 40% disputes), generates clarifying questions & wordings via Gemini (or fallback), and returns active clarification requests. |
| `POST` | `/api/clarifications/demo` | Seeds 1-minute clarification demo: 5 flags, 3 disputes for rule R-07 ("kids"), and 1 stored draft. |
| `POST` | `/api/clarifications/:id/decide` | Decides clarification (`"apply"`, `"edit_and_apply"`, `"dismiss"`). Increments rule version, archives prior text in `versionHistory`, updates audit trail. Idempotent against double clicks. |
| `POST` | `/api/clarifications/:id/retry` | Re-runs AI suggestion generation for a clarification request. Stores plain failure reasons if unsuccessful. |
| `POST` | `/api/clarifications/:id/recheck` | Re-checks stored workspace drafts against clarified rule wording; returns before/after finding counts and resolved findings. |
| `POST` | `/api/clarifications/:id/reopen` | Reopens a previously dismissed clarification request. |
| `GET` | `/api/tone-settings` | Retrieves channel tone profiles and configured brand terms. |
| `PUT` | `/api/tone-settings` | Updates channel tone profiles and brand terms. |
| `POST` | `/api/tone-settings/reset` | Resets channel tone profiles and brand terms to default values. |
| `POST` | `/api/compare-channels` | Audits copy across Social Media / Twitter, Marketing Email, Landing Page, and Ad Copy / Banner simultaneously. |
| `GET` | `/api/insights` | Aggregates real governance statistics from stored drafts: total drafts, findings count, fix acceptance rate, validator drop statistics, top violated rules, and detects unclear guidelines. |
| `GET` | `/api/verify/:certificateId`, `/verify/:certificateId` | Public verification endpoint. Serves SPA if requested by browser (`Accept: text/html`); returns cryptographic verification result when called as JSON. |
| `POST` | `/api/verify` | Direct verification endpoint accepting a complete exported certificate JSON object, allowing verification even if disk files were reset. |
| `GET` | `/api/certificates/:certificateId` | Retrieves raw stored certificate record by certificate ID. |
| `POST` | `/api/certificates/:certificateId/tamper` | Demo test endpoint: mutates 1 character in the certificate payload in memory to demonstrate tamper detection. Persisted disk record is not corrupted. |
| `POST` | `/api/certificates/:certificateId/restore` | Demo test endpoint: restores the unmutated in-memory test state. |
| `GET` | `/api/workspaces/images/*` | Static file handler serving compressed uploaded workspace images from disk. |
| `GET` | `*` | Catch-all SPA route returning `client/dist/index.html` with `no-cache` headers. |

---

## 3. Data Storage, Concurrency & Lifecycle

### Where Data Lives

1. **Per-Visitor Workspaces:**
   * Every visitor is assigned a unique workspace identifier stored in the browser's `localStorage` (`brandguard_workspace_id`).
   * State is stored as a JSON file at `server/data/workspaces/<workspaceId>.json`.
2. **Uploaded Images:**
   * Compressed banner images are saved at `server/data/workspaces/images/<workspaceId>/<filename>.webp`.
3. **Compliance Certificates:**
   * Approved certificates are saved at `server/data/certificates/<certificateId>.json`.
   * A full copy of the certificate is also embedded directly inside the draft record (`draft.certificate` and `draft.certificates`).
4. **Bounded Caches & In-Memory Stores (`server/lruCache.js`):**
   * Rate limiting timestamps use an `ExpiringLRUCache` (max 200 entries, 60s TTL).
   * Banner OCR results use an `ExpiringLRUCache` (max 50 entries, 1-hour TTL).
   * Workspace session locks use an `ExpiringLRUCache` (max 100 entries, 24-hour TTL).
   * All caches enforce strict upper bounds to avoid node process memory leaks.

### Concurrency & Atomic File Operations

To prevent data corruption during simultaneous requests:
* **Atomic Writes:** `writeFileSyncAtomic(filepath, data)` writes serialized JSON to a temporary file (`.tmp.<timestamp>.<rand>`) before atomically renaming it over the destination file.
* **Per-File Serializing Lock Queue:** `enqueueFileOperation(filepath, asyncOperation)` chains read/modify/write sequences for the same file path through a promise queue, preventing write-after-read race conditions.

### Server Lifecycle & Ephemeral Restarts

* **Local Machine:** Files in `server/data/` persist between server restarts.
* **Ephemeral Hosting (Render Free Tier):**
  * Containers clear temporary disk state upon redeployment or when waking from idle sleep.
  * **Lost Workspace Handling:** `GET /api/workspace/status` detects when an existing browser workspace has been cleared on the server. The client shows a clear banner notifying the user that the free demo server cleared temporary data, and smoothly provisions a fresh workspace.
  * **Self-Contained Verification:** Because certificates contain the canonical payload and HMAC signature, `POST /api/verify` can verify any exported certificate file even after the server disk has been cleared.

---

## 4. Compliance Certificate Architecture & Signing Flow

BrandGuard produces tamper-evident certificates upon reviewer approval:

```
[Draft Copy & Metadata]
         │
         ▼
[Canonical Payload Assembly]
  (Sorted keys, trimmed whitespace, normalized timestamps)
         │
         ├─────────────────────────────────────────┐
         ▼                                         ▼
   [SHA-256 Hash]                          [HMAC-SHA256 Sign]
         │                                   (using CERT_SECRET)
         ▼                                         │
   "contentHash"                                   ▼
         │                                    "signature"
         └─────────────────┬───────────────────────┘
                           ▼
              [Compliance Certificate]
      (ID, Content Hash, Signature, Canonical Payload)
```

1. **Canonical JSON Serialization:** Keys are serialized in deterministic order, stripping non-deterministic fields.
2. **SHA-256 Content Hashing:** Creates an immutable digest of the approved content, rule IDs, and decision metadata.
3. **HMAC-SHA256 Server Signature:** Signs the digest using `CERT_SECRET`. If any character in the content or certificate metadata changes, the calculated signature will not match.
4. **Production Security Check:** In production (`NODE_ENV=production`), `CERT_SECRET` must be set via environment variable. If omitted, certificate issuance is blocked to prevent weak default keys.

---

## 5. Channel Tone Profiles Architecture

Channel tone profiles configure tonal rules per publishing venue:

* **Location:** Initial profiles reside in `server/demoData.js`; resolution and deterministic auditing functions reside in `server/validator.js` (`resolveChannelProfile`, `runDeterministicToneChecks`, `compareChannelTones`).
* **Profile Configuration:**
  * `maxExclamationMarks`: Threshold for rule T-03.
  * `maxAllCapsWords`: Threshold for rule T-05 (exempting brand terms).
  * `maxCharacters`: Threshold for rule T-06 (channel copy length).
* **Multi-Channel Comparison:**
  * The `/api/compare-channels` endpoint evaluates the same draft across Twitter, Email, Landing Page, and Banner, returning a consolidated breakdown of which channels pass or flag tone rules.

---

## 6. Validator, De-duplication, and SEC-01 Scanner

### 1. SEC-01 Adversarial Instruction Scanner (`server/securityScanner.js`)
* Deterministic scanner using 12 regex patterns to detect prompt injection (e.g. `"ignore all rules"`, `"bypass governance"`, `"approve this draft"`).
* Scans text copy before AI review, banner OCR text, and imported guideline documents.
* In review, SEC-01 findings are prepended to ensure they are never dropped.
* In the Reviewer board, unresolved SEC-01 findings present a critical red alert blocking certificate approval.

### 2. Rule Validator (`server/validator.js`)
* Verifies quoted text exists word-for-word in draft copy.
* Confirms rule and fact IDs exist in the active workspace.
* Drops findings where the fix is identical to the quoted text or contains internal reasoning leaks.
* Performs grammar checks on replacement text.
* Dynamically derives fact fixes from active library facts.

### 3. De-duplication & Overlap Merging
* Merges overlapping findings of the same rule ID, preserving the longest span.
* Combines cross-rule overlapping findings into multi-rule citations (e.g. `"R-15 + R-12"`).
* Drops exact duplicate findings.

---

## 7. Environment Variables

The application relies on 5 environment variables:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Network port for the backend server | `5000` |
| `NODE_ENV` | Environment flag (`development` or `production`) | `development` |
| `GEMINI_API_KEY` | Google AI Studio API key for Gemini calls | (Empty / Required for AI) |
| `GEMINI_MODEL` | Gemini model alias | `gemini-flash-lite-latest` |
| `CERT_SECRET` | Cryptographic secret for HMAC-SHA256 certificate signing | Required in production |

---

## 8. Automated Testing

BrandGuard includes 60 unit and integration tests across 6 suites:
* `server/test/toneProfiles.test.js`
* `server/test/guidelineImport.test.js`
* `server/test/clarification.test.js`
* `server/test/fixesAndCertificates.test.js`
* `server/test/storageReliability.test.js`
* `server/test/demoAccess.test.js`

Run tests from the repository root:
```bash
npm test
```
All tests use Node.js's native test runner (`node --test`) and require no external test framework dependencies.
