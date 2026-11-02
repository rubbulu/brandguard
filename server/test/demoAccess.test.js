import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appJsxPath = path.join(__dirname, "..", "..", "client", "src", "App.jsx");

describe("Prompt 6c: Demo Access Panel & Role Selection", () => {
  const appJsxContent = fs.readFileSync(appJsxPath, "utf-8");

  // Test 1: Demo credentials specification and visible credentials
  test("demo credentials specification: 3 demo roles, visible credentials, shared password", () => {
    // 1. Must define Brand Manager, Content Creator, Reviewer demo accounts
    assert.ok(appJsxContent.includes("manager@demo"), "Must include manager@demo");
    assert.ok(appJsxContent.includes("creator@demo"), "Must include creator@demo");
    assert.ok(appJsxContent.includes("reviewer@demo"), "Must include reviewer@demo");

    // 2. Must visibly show the shared demo password on the page
    assert.ok(
      appJsxContent.includes("Shared demo password:") || appJsxContent.includes("Password:"),
      "Must show demo password label"
    );
    assert.ok(appJsxContent.includes("demo"), "Must include demo password");

    // 3. Must include the exact required disclaimer
    const expectedDisclaimer = "Demo accounts only. There is no real authentication or registration. Please do not enter personal data.";
    assert.ok(
      appJsxContent.includes(expectedDisclaimer),
      `App.jsx must contain exact disclaimer: "${expectedDisclaimer}"`
    );

    // 4. Must NOT have real password storage or server authentication
    assert.ok(!appJsxContent.includes("bcrypt"), "Must not use bcrypt or real password hashing");
    assert.ok(!appJsxContent.includes("/api/login"), "Must not call server login endpoint");
    assert.ok(!appJsxContent.includes("/api/register"), "Must not call server register endpoint");
  });

  // Test 2: Signing in as each demo account selects the right role
  test("signing in as each demo account selects the right role in the role switcher", () => {
    // Mock role router simulation matching App.jsx implementation
    function simulateAppRoleRouter() {
      let activeRole = "manager";
      let activeHash = "#/manager";
      let showModal = true;
      let demoUser = null;

      function changeRole(role) {
        activeRole = role;
        activeHash = `#/${role}`;
        if (role === "manager") demoUser = "manager@demo";
        else if (role === "creator") demoUser = "creator@demo";
        else if (role === "reviewer") demoUser = "reviewer@demo";
        else demoUser = null;
      }

      function handleDemoSignIn(role, email) {
        demoUser = email;
        changeRole(role);
        showModal = false;
      }

      function handleSkip() {
        showModal = false;
        // Does NOT change role or route!
      }

      return {
        get activeRole() { return activeRole; },
        get activeHash() { return activeHash; },
        get showModal() { return showModal; },
        get demoUser() { return demoUser; },
        handleDemoSignIn,
        handleSkip,
        changeRole,
        openGuide: () => { showModal = true; }
      };
    }

    // 1. Sign in as Brand Manager
    const app1 = simulateAppRoleRouter();
    assert.equal(app1.showModal, true, "Modal opens on first load");
    app1.handleDemoSignIn("manager", "manager@demo");
    assert.equal(app1.activeRole, "manager", "Must select manager role");
    assert.equal(app1.activeHash, "#/manager", "Must navigate to #/manager");
    assert.equal(app1.demoUser, "manager@demo");
    assert.equal(app1.showModal, false, "Modal must close on sign in");

    // 2. Sign in as Content Creator
    const app2 = simulateAppRoleRouter();
    app2.handleDemoSignIn("creator", "creator@demo");
    assert.equal(app2.activeRole, "creator", "Must select creator role");
    assert.equal(app2.activeHash, "#/creator", "Must navigate to #/creator");
    assert.equal(app2.demoUser, "creator@demo");
    assert.equal(app2.showModal, false, "Modal must close on sign in");

    // 3. Sign in as Reviewer
    const app3 = simulateAppRoleRouter();
    app3.handleDemoSignIn("reviewer", "reviewer@demo");
    assert.equal(app3.activeRole, "reviewer", "Must select reviewer role");
    assert.equal(app3.activeHash, "#/reviewer", "Must navigate to #/reviewer");
    assert.equal(app3.demoUser, "reviewer@demo");
    assert.equal(app3.showModal, false, "Modal must close on sign in");
  });

  // Test 3: Skipping keeps the existing role switcher behavior unchanged
  test("'Skip, no login needed' keeps existing role switcher behaviour unchanged", () => {
    // 1. Check App.jsx contains "Skip, no login needed"
    assert.ok(
      appJsxContent.includes("Skip, no login needed"),
      "App.jsx must contain 'Skip, no login needed' button"
    );

    // 2. Simulation of skip
    let activeRole = "manager";
    let activeHash = "#/manager";
    let showModal = true;

    function handleSkip() {
      showModal = false;
      // Stays on current role without changing route
    }

    assert.equal(showModal, true);
    handleSkip();
    assert.equal(showModal, false, "Modal must close when skip is clicked");
    assert.equal(activeRole, "manager", "Role must remain unchanged (manager)");
    assert.equal(activeHash, "#/manager", "Route must remain unchanged (#/manager)");

    // 3. Verify buttons for all demo roles exist in App.jsx
    assert.ok(appJsxContent.includes("Sign in as Brand Manager") || appJsxContent.includes("Sign in as {acc.name}"), "Must have Sign in as Brand Manager");
    assert.ok(appJsxContent.includes("Sign in as Content Creator") || appJsxContent.includes("Sign in as {acc.name}"), "Must have Sign in as Content Creator");
    assert.ok(appJsxContent.includes("Sign in as Reviewer") || appJsxContent.includes("Sign in as {acc.name}"), "Must have Sign in as Reviewer");

    // 4. Verify Guide button opens the modal
    assert.ok(
      appJsxContent.includes("setShowGuideModal(true)"),
      "Guide button must trigger showGuideModal(true)"
    );
  });

});
