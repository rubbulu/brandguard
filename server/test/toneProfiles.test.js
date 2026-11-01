import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runDeterministicToneChecks,
  getAllCapsWords,
  compareChannelTones,
  resolveChannelProfile
} from "../validator.js";
import { INITIAL_TONE_PROFILES, INITIAL_BRAND_TERMS } from "../demoData.js";

describe("Channel-Specific Tone Profiles & Checks", () => {
  it("resolves default profiles correctly for channels", () => {
    const twitter = resolveChannelProfile("Social Media / Twitter");
    assert.equal(twitter.channelName, "Social Media / Twitter");
    assert.equal(twitter.profile.maxExclamationMarks, 1);
    assert.equal(twitter.profile.maxAllCapsWords, 0);
    assert.equal(twitter.profile.maxCharacters, 280);

    const email = resolveChannelProfile("Marketing Email");
    assert.equal(email.channelName, "Marketing Email");
    assert.equal(email.profile.maxExclamationMarks, 2);
    assert.equal(email.profile.maxAllCapsWords, 2);
    assert.equal(email.profile.maxCharacters, 0);

    const banner = resolveChannelProfile("Ad Copy / Banner");
    assert.equal(banner.channelName, "Ad Copy / Banner");
    assert.equal(banner.profile.maxCharacters, 120);
  });

  it("differentiates Twitter vs Email on exclamation marks (T-03): 'Meet CampusPro today!! Save big.'", () => {
    const text = "Meet CampusPro today!! Save big.";

    // Twitter (max 1 exclamation) -> flags T-03
    const twitterFindings = runDeterministicToneChecks(
      text,
      [],
      INITIAL_BRAND_TERMS,
      "Social Media / Twitter",
      INITIAL_TONE_PROFILES["Social Media / Twitter"]
    );
    const twitterT03 = twitterFindings.find((f) => f.rule_id === "T-03");
    assert.ok(twitterT03, "Twitter must flag T-03 for 2 exclamation marks");
    assert.equal(twitterT03.quote, "!!", "Highlight must be the exact run of '!!'");
    assert.equal(twitterT03.suggested_fix, "!");
    assert.match(twitterT03.explanation, /Social Media \/ Twitter allows at most 1 exclamation mark; found 2/);

    // Email (max 2 exclamations) -> no T-03
    const emailFindings = runDeterministicToneChecks(
      text,
      [],
      INITIAL_BRAND_TERMS,
      "Marketing Email",
      INITIAL_TONE_PROFILES["Marketing Email"]
    );
    const emailT03 = emailFindings.find((f) => f.rule_id === "T-03");
    assert.equal(emailT03, undefined, "Email allows 2 exclamations, so it must not flag T-03");
  });

  it("correctly highlights '!!' run position for T-03", () => {
    const text = "Buy now!!";
    const findings = runDeterministicToneChecks(
      text,
      [],
      INITIAL_BRAND_TERMS,
      "Social Media / Twitter",
      INITIAL_TONE_PROFILES["Social Media / Twitter"]
    );
    const t03 = findings.find((f) => f.rule_id === "T-03");
    assert.ok(t03);
    assert.equal(t03.quote, "!!");
    assert.equal(t03.suggested_fix, "!");
  });

  it("differentiates Twitter vs Email on all-caps words (T-05): 'BUY NOW before it SELLS OUT!'", () => {
    const text = "BUY NOW before it SELLS OUT!";

    // Twitter: max 0 all-caps words -> flags T-05
    const twitterFindings = runDeterministicToneChecks(
      text,
      [],
      INITIAL_BRAND_TERMS,
      "Social Media / Twitter",
      INITIAL_TONE_PROFILES["Social Media / Twitter"]
    );
    const twitterT05 = twitterFindings.find((f) => f.rule_id === "T-05");
    assert.ok(twitterT05, "Twitter must flag T-05");
    assert.match(twitterT05.explanation, /Social Media \/ Twitter allows at most 0 all-caps words; found 4/);

    // Email with default limit (2 all-caps): 4 > 2 -> flags T-05
    const emailFindings = runDeterministicToneChecks(
      text,
      [],
      INITIAL_BRAND_TERMS,
      "Marketing Email",
      INITIAL_TONE_PROFILES["Marketing Email"]
    );
    const emailT05 = emailFindings.find((f) => f.rule_id === "T-05");
    assert.ok(emailT05, "Email with limit 2 flags T-05 because 4 > 2");
    assert.match(emailT05.explanation, /Marketing Email allows at most 2 all-caps words; found 4/);

    // Email when limit is raised to 4 -> does NOT flag T-05
    const customEmailProfile = { maxExclamationMarks: 2, maxAllCapsWords: 4, maxCharacters: 0 };
    const customEmailFindings = runDeterministicToneChecks(
      text,
      [],
      INITIAL_BRAND_TERMS,
      "Marketing Email",
      customEmailProfile
    );
    assert.equal(customEmailFindings.find((f) => f.rule_id === "T-05"), undefined);

    // Draft with only 2 all-caps words: Twitter flags T-05, Email does NOT
    const textTwoCaps = "BUY NOW before it sells out!";
    const twitterTwoCaps = runDeterministicToneChecks(
      textTwoCaps,
      [],
      INITIAL_BRAND_TERMS,
      "Social Media / Twitter",
      INITIAL_TONE_PROFILES["Social Media / Twitter"]
    );
    assert.ok(twitterTwoCaps.find((f) => f.rule_id === "T-05"));

    const emailTwoCaps = runDeterministicToneChecks(
      textTwoCaps,
      [],
      INITIAL_BRAND_TERMS,
      "Marketing Email",
      INITIAL_TONE_PROFILES["Marketing Email"]
    );
    assert.equal(emailTwoCaps.find((f) => f.rule_id === "T-05"), undefined, "Email with limit 2 allows 2 all-caps words");
  });

  it("respects workspace brandTerms and ignores single letters ('A', 'I')", () => {
    // Single letters 'A' and 'I' are not counted as all-caps words
    const singleLetters = getAllCapsWords("CampusPro is A great laptop and I love it.", ["CampusPro"]);
    assert.deepEqual(singleLetters, []);

    // Brand term is exempt
    const brandCheck = getAllCapsWords("CAMPUSPRO is amazing.", ["CampusPro"]);
    assert.deepEqual(brandCheck, []);

    // Custom brand terms and acronyms
    const textWithAcronym = "NEW AI features with 16GB RAM for all users.";
    // With only default brandTerms, 'NEW', 'AI', 'RAM' are counted
    const withoutAcronyms = getAllCapsWords(textWithAcronym, ["CampusPro"]);
    assert.ok(withoutAcronyms.includes("NEW"));
    assert.ok(withoutAcronyms.includes("AI"));
    assert.ok(withoutAcronyms.includes("RAM"));

    // When 'AI' and 'RAM' are added to brandTerms, they are exempt
    const withAcronyms = getAllCapsWords(textWithAcronym, ["CampusPro", "AI", "RAM"]);
    assert.deepEqual(withAcronyms, ["NEW"]);
  });

  it("enforces channel character length limit (T-06)", () => {
    // 150-character text
    const text150 = "A".repeat(150);

    // Banner (limit 120) -> flags T-06
    const bannerFindings = runDeterministicToneChecks(
      text150,
      [],
      INITIAL_BRAND_TERMS,
      "Ad Copy / Banner",
      INITIAL_TONE_PROFILES["Ad Copy / Banner"]
    );
    const bannerT06 = bannerFindings.find((f) => f.rule_id === "T-06");
    assert.ok(bannerT06, "Banner must flag T-06 when length exceeds 120");
    assert.match(bannerT06.explanation, /Ad Copy \/ Banner allows at most 120 characters; found 150/);
    assert.equal(bannerT06.quote.length, 30, "Quote is the excess text beyond 120 characters");

    // Twitter (limit 280) -> no T-06
    const twitterFindings = runDeterministicToneChecks(
      text150,
      [],
      INITIAL_BRAND_TERMS,
      "Social Media / Twitter",
      INITIAL_TONE_PROFILES["Social Media / Twitter"]
    );
    assert.equal(twitterFindings.find((f) => f.rule_id === "T-06"), undefined);

    // Email (limit 0 = no limit) -> no T-06
    const emailFindings = runDeterministicToneChecks(
      text150,
      [],
      INITIAL_BRAND_TERMS,
      "Marketing Email",
      INITIAL_TONE_PROFILES["Marketing Email"]
    );
    assert.equal(emailFindings.find((f) => f.rule_id === "T-06"), undefined);

    // Twitter with 300 characters -> flags T-06
    const text300 = "B".repeat(300);
    const twitter300Findings = runDeterministicToneChecks(
      text300,
      [],
      INITIAL_BRAND_TERMS,
      "Social Media / Twitter",
      INITIAL_TONE_PROFILES["Social Media / Twitter"]
    );
    const twitterT06 = twitter300Findings.find((f) => f.rule_id === "T-06");
    assert.ok(twitterT06);
    assert.match(twitterT06.explanation, /Social Media \/ Twitter allows at most 280 characters; found 300/);
  });

  it("handles empty and whitespace-only text gracefully", () => {
    assert.deepEqual(runDeterministicToneChecks(""), []);
    assert.deepEqual(runDeterministicToneChecks("   "), []);
    assert.deepEqual(runDeterministicToneChecks(null), []);
    assert.deepEqual(runDeterministicToneChecks(undefined), []);
  });

  it("compares channels simultaneously across all four profiles", () => {
    const text = "Meet CampusPro today!! Save big.";
    const comparison = compareChannelTones(text, [], INITIAL_BRAND_TERMS, INITIAL_TONE_PROFILES);

    assert.equal(comparison.length, 4);

    const twitterResult = comparison.find((c) => c.channel === "Social Media / Twitter");
    const emailResult = comparison.find((c) => c.channel === "Marketing Email");

    assert.ok(twitterResult.findings.some((f) => f.rule_id === "T-03"));
    assert.equal(emailResult.findings.length, 0);
  });
});
