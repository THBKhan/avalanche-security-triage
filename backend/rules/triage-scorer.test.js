const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  computeExposure,
  computePriorityScore,
  classifySeverity,
  evaluateRule,
  rulesCatalog,
} = require("./triage-scorer");

test("Tri-Pillar formula weights sum to 1.0", () => {
  const { exploitability, exposure, assetImpact } = rulesCatalog.weights;
  const total = exploitability + exposure + assetImpact;
  assert.ok(Math.abs(total - 1.0) < 1e-9);
});

test("computePriorityScore matches mock-data.json VULN-001 and VULN-002", () => {
  // VULN-001: 0.4*95 + 0.3*100 + 0.3*90 = 38 + 30 + 27 = 95.0
  assert.equal(
    computePriorityScore({ exploitability: 95, exposure: 100, assetImpact: 90 }),
    95.0
  );
  // VULN-002: 0.4*100 + 0.3*100 + 0.3*90 = 40 + 30 + 27 = 97.0
  assert.equal(
    computePriorityScore({ exploitability: 100, exposure: 100, assetImpact: 90 }),
    97.0
  );
  // VULN-003: 0.4*10 + 0.3*10 + 0.3*15 = 4 + 3 + 4.5 = 11.5
  assert.equal(
    computePriorityScore({ exploitability: 10, exposure: 10, assetImpact: 15 }),
    11.5
  );
});

test("computeExposure differentiates unrestricted, paused, role-restricted, and onlyOwner", () => {
  assert.equal(computeExposure({ visibility: "external", modifiers: [] }), 100);
  assert.equal(computeExposure({ visibility: "public", modifiers: ["whenNotPaused"] }), 75);
  assert.equal(computeExposure({ visibility: "external", modifiers: ["onlyKeeper"] }), 45);
  assert.equal(computeExposure({ visibility: "external", modifiers: ["onlyOwner"] }), 20);
  assert.equal(computeExposure({ visibility: "internal", modifiers: [] }), 10);
  assert.equal(computeExposure({ visibility: "n/a", modifiers: [] }), 10);
  assert.equal(computeExposure({ visibility: "external", modifiers: [], isPaused: true }), 50);
});

test("evaluateRule lowers severity when SafeVaultFixture guards are present", () => {
  const unguarded = evaluateRule("RULE-REENTRANCY-001", {
    visibility: "external",
    modifiers: [],
    assetImpact: 90,
  });
  assert.equal(unguarded.severity, "CRITICAL");
  assert.equal(unguarded.scores.priorityScore, 95.0);

  const guarded = evaluateRule("RULE-REENTRANCY-001", {
    visibility: "external",
    modifiers: ["nonReentrant", "whenNotPaused"],
    assetImpact: 90,
  });
  // 0.4*15 + 0.3*75 + 0.3*90 = 6 + 22.5 + 27 = 55.5 -> MEDIUM (mitigated)
  assert.equal(guarded.scores.exploitability, 15);
  assert.equal(guarded.severity, "MEDIUM");
});

test("evaluateRule refuses to assert high exploitability when evidence is missing", () => {
  const noEvidence = evaluateRule("RULE-ACCESS-002", {
    visibility: "external",
    modifiers: [],
    assetImpact: 90,
    hasEvidence: false,
  });
  assert.equal(noEvidence.confidence, "INSUFFICIENT_EVIDENCE");
  assert.equal(noEvidence.scores.exploitability, 0);
});

test("classifySeverity maps thresholds accurately", () => {
  assert.equal(classifySeverity(80), "CRITICAL");
  assert.equal(classifySeverity(79.9), "HIGH");
  assert.equal(classifySeverity(60), "HIGH");
  assert.equal(classifySeverity(40), "MEDIUM");
  assert.equal(classifySeverity(39.9), "LOW");
});

test("system_prompt.txt contains required evidence, diff, and on-chain separation rules", () => {
  const prompt = fs.readFileSync(path.join(__dirname, "system_prompt.txt"), "utf8");
  assert.match(prompt, /INSUFFICIENT_EVIDENCE/);
  assert.match(prompt, /onChainFacts/);
  assert.match(prompt, /inferredRisks/);
  assert.match(prompt, /remediationDiff/);
  assert.match(prompt, /0\.4 \* Exploitability/);
});

