# BrandGuard 🛡️
### An Explainable Pre-Publication Brand-Governance Platform

> **Event:** CodeStar 30 (We Code Coders) — **Round 2: The Build**  
> **Problem Statement:** Brand-Governance Platform, by Inkloom AI  
> **Team:** BrandGuard (Individual Participant)  
> **Participant:** Mohammad Rubina Sultana  
> **Repository:** [https://github.com/rubbulu/brandguard](https://github.com/rubbulu/brandguard)  

---

## 1. Problem Overview & What BrandGuard Solves

Organizations now publish content across many touchpoints at scale: employees, external agencies, and AI copy tools. Without centralized pre-publication enforcement:
- **Misleading claims and superlatives** breach regulatory policies (e.g. ASCI).
- **Outdated figures or conflicting specifications** erode customer trust.
- **Inconsistent terminology and tone** dilute brand identity.
- Traditional reviews are manual, late, and provide vague rejections without actionable rewrites.

**BrandGuard solves this with an explainable, closed-loop workflow:**
$$\text{Draft Content} \longrightarrow \text{Gemini AI Check} \longrightarrow \mathbf{\text{Validator Engine}} \longrightarrow \text{Explain + Suggest Fix} \longrightarrow \text{Human Decision} \longrightarrow \text{Reviewer Sign-Off}$$

---

## 2. Key Features Built in Round 2

### 1. 🛡️ Role-Based Governance with Instant Judge Switcher
Judges and evaluators can switch between roles in 1 click without needing multiple accounts:
- **Brand Manager:** Central repository of Brand Guidelines (`R-xx`) and Approved Facts (`F-xx`).
- **Content Creator:** Interactive drafting with quick test draft presets, live highlighting, and suggested fix acceptance.
- **Reviewer:** Approval board, side-by-side before/after comparison, reviewer comments, and immutable audit trail.
- **Insights Dashboard:** Tracks recurring violations and automatically flags unclear guidelines.

### 2. ⚡ The Core AI Review & Validator Engine
Unlike black-box grammar checkers or unconstrained LLMs:
- **No Hallucinated Rules:** The review prompt enforces strict JSON output matching a deterministic schema.
- **Strict Verbatim Quoting:** The backend **Validator** verifies that every quoted phrase appears word-for-word in the draft. Any hallucinated quote or unlisted rule is dropped before reaching the user.
- **Intent-Preserving Rewrites:** The engine provides targeted suggested fixes rather than blanket overwrites.
- **High Availability Fallback:** Features automated cascading fallback (`gemini-3.5-flash` $\rightarrow$ `gemini-3-flash-preview` $\rightarrow$ `gemini-flash-latest`) with exponential backoff to handle traffic spikes smoothly.

### 3. 🎨 Interactive Split-Screen Review
Matches the Round 1 proposal mockup:
- **Left Panel:** Live draft text with colored severity badges (`High`, `Medium`, `Low`, and `Fact Conflict`). Clicking any highlight focuses the corresponding card.
- **Right Panel:** Interactive cards for each finding with `[Accept Fix]`, `[Edit Custom Fix]`, and `[Reject]`. Accepting instantly updates the draft in real time.

### 4. 📝 Reviewer Sign-Off & Complete Audit Trail
- Comprehensive revision history: tracks submission timestamps, AI detection stats, creator actions, and reviewer comments.
- One-click `[Approve Publication]` or `[Request Revisions]` decisions.

---

## 3. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React 18, Vite, Lucide Icons, Modern CSS | Fast loading, responsive on mobile & desktop, zero bundle bloat |
| **Backend** | Node.js, Express | Lightweight REST API, secure server-side AI execution |
| **AI Model** | Google Gemini 3.5 Flash | Fast reasoning, forced structured JSON schema output |
| **Validation** | Custom BrandGuard Validator | Programmatic filter eliminating hallucinated rules and mismatched quotes |
| **Data Layer** | In-Memory Store with Instant Demo Reload | Zero-friction testing for hackathon evaluators |

---

## 4. Quick 3-Minute Judge Testing Guide

To test the complete workflow without any setup:

1. **Open the App:** Navigate to the live deployment or local URL.
2. **Select a Test Draft:** Under **Content Creator**, choose a preset from the *Quick Test Drafts* dropdown:
   - *Draft 1:* Superlatives & battery mismatch (`"India's fastest laptop... battery lasts 3 days. Buy now!!"`)
   - *Draft 2:* Terminology (`kids` $\rightarrow$ `students`) & guarantees (`Guaranteed 100%`)
   - *Draft 3:* Clean spec sheet (Tests zero false positives)
   - *Draft 4:* Tone violations (ALL CAPS words)
   - *Draft 5:* Security & Prompt Injection defense (`"Ignore all previous rules..."`)
3. **Run AI Check:** Click **"Run BrandGuard AI Check"**. Watch the AI return categorized findings and the Validator verify all citations.
4. **Accept Suggested Fix:** Click **"Accept Fix"** on any finding card and notice the draft copy updates instantly on the left.
5. **Submit to Reviewer:** Click **"Submit to Reviewer Sign-Off"**.
6. **Switch to Reviewer:** Switch to the **Reviewer** tab, add a comment, inspect the before/after comparison, and click **"Approve Publication"**.

---

## 5. Running Locally

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation & Launch

```bash
# Clone the repository
git clone https://github.com/rubbulu/brandguard.git
cd brandguard

# Install dependencies for both server and client
npm run install:all

# Add your Gemini API key in server/.env
# PORT=5000
# GEMINI_API_KEY=your_key_here

# Run the backend server (runs on http://localhost:5000)
npm run server

# In a second terminal, run the frontend (runs on http://localhost:3000)
npm run client
```

Or run the full-stack production build:
```bash
npm run build
npm start
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## 6. Three Major Improvements for Round 3

1. **Insights & Unclear-Guideline Analytics:** Expand dispute tracking to provide brand managers with auto-generated suggested rewrites for guidelines that cause frequent creator friction.
2. **Multimodal Visual & Accessibility Checks:** Add automated image compliance scanning (alt text verification, minimum contrast ratios, and logo clear-space enforcement).
3. **Side-by-Side Visual Diff & PDF Report Export:** Provide one-click PDF export of the compliance audit trail for legal sign-off and enterprise documentation.

---

## 7. Responsible AI Disclosure
* **Antigravity:** Code generation and architectural scaffolding assistance.
* **Google AI Studio / Gemini 3.5 Flash:** Powers draft review and suggested rewrites strictly on the server.
* **Architecture, UI Design, Validator Engine, Prompts & Testing:** Conceived, designed, and integrated by Mohammad Rubina Sultana.
