const rulesCatalog = require("./rules-catalog.json");

const OWNER_MODIFIERS = new Set(["onlyOwner", "onlyGovernance", "onlyAdmin", "onlyTimelock"]);
const ROLE_MODIFIERS = new Set(["onlyRole", "onlyMinter", "onlyKeeper", "onlyAuthorized"]);

/**
 * Clamp a numeric score to [0, 100].
 * @param {number} value
 * @returns {number}
 */
function clampScore(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`Score must be a valid number, got: ${value}`);
  }
  return Math.max(0, Math.min(100, value));
}

/**
 * Compute Exposure score (0-100) from function visibility, modifiers, and live pause state.
 * @param {object} params
 * @param {string} params.visibility - "external" | "public" | "internal" | "private" | "n/a"
 * @param {string[]} [params.modifiers=[]]
 * @param {boolean} [params.isPaused=false]
 * @returns {number}
 */
function computeExposure({ visibility, modifiers = [], isPaused = false }) {
  const vis = (visibility || "n/a").toLowerCase();
  const mods = new Set(modifiers);

  let baseExposure;
  if (vis === "n/a" || vis === "global" || vis === "internal" || vis === "private") {
    baseExposure = 10;
  } else if ([...mods].some((m) => OWNER_MODIFIERS.has(m))) {
    baseExposure = rulesCatalog.exposureByVisibilityAndModifiers.public_onlyOwner;
  } else if ([...mods].some((m) => ROLE_MODIFIERS.has(m))) {
    baseExposure = rulesCatalog.exposureByVisibilityAndModifiers.public_roleRestricted;
  } else if (mods.has("whenNotPaused")) {
    baseExposure = rulesCatalog.exposureByVisibilityAndModifiers.public_whenNotPaused;
  } else {
    baseExposure = rulesCatalog.exposureByVisibilityAndModifiers.public_unrestricted;
  }

  if (isPaused && (vis === "external" || vis === "public")) {
    baseExposure = Math.round(baseExposure * 0.5);
  }

  return clampScore(baseExposure);
}

/**
 * Compute Tri-Pillar Priority Score:
 *   0.4 * Exploitability + 0.3 * Exposure + 0.3 * AssetImpact
 * @param {object} params
 * @param {number} params.exploitability
 * @param {number} params.exposure
 * @param {number} params.assetImpact
 * @returns {number} Rounded to 1 decimal place
 */
function computePriorityScore({ exploitability, exposure, assetImpact }) {
  const e = clampScore(exploitability);
  const x = clampScore(exposure);
  const a = clampScore(assetImpact);
  const { weights } = rulesCatalog;
  const raw = weights.exploitability * e + weights.exposure * x + weights.assetImpact * a;
  return Math.round(raw * 10) / 10;
}

/**
 * Map Priority Score (0-100) to Severity Label.
 * @param {number} priorityScore
 * @returns {"CRITICAL" | "HIGH" | "MEDIUM" | "LOW"}
 */
function classifySeverity(priorityScore) {
  const score = clampScore(priorityScore);
  const t = rulesCatalog.severityThresholds;
  if (score >= t.CRITICAL) return "CRITICAL";
  if (score >= t.HIGH) return "HIGH";
  if (score >= t.MEDIUM) return "MEDIUM";
  return "LOW";
}

/**
 * Evaluate a rule from rules-catalog.json against function context.
 * @param {string} ruleId
 * @param {object} context
 * @param {string} context.visibility
 * @param {string[]} [context.modifiers=[]]
 * @param {number} [context.assetImpact=0]
 * @param {boolean} [context.isPaused=false]
 * @param {boolean} [context.hasEvidence=true]
 */
function evaluateRule(ruleId, { visibility, modifiers = [], assetImpact = 0, isPaused = false, hasEvidence = true }) {
  const rule = rulesCatalog.rules.find((r) => r.id === ruleId);
  if (!rule) {
    throw new Error(`Unknown ruleId: ${ruleId}`);
  }

  if (!hasEvidence) {
    return {
      ruleId: rule.id,
      confidence: "INSUFFICIENT_EVIDENCE",
      scores: {
        exploitability: 0,
        exposure: computeExposure({ visibility, modifiers, isPaused }),
        assetImpact: clampScore(assetImpact),
        priorityScore: computePriorityScore({
          exploitability: 0,
          exposure: computeExposure({ visibility, modifiers, isPaused }),
          assetImpact,
        }),
      },
      severity: "LOW",
    };
  }

  const mods = new Set(modifiers);
  const isMitigated = rule.mitigatedBy.some((m) => mods.has(m));
  const exploitability = isMitigated ? rule.mitigatedExploitability : rule.defaultExploitability;
  const exposure = computeExposure({ visibility, modifiers, isPaused });
  const priorityScore = computePriorityScore({ exploitability, exposure, assetImpact });

  return {
    ruleId: rule.id,
    confidence: "HIGH",
    scores: {
      exploitability,
      exposure,
      assetImpact: clampScore(assetImpact),
      priorityScore,
    },
    severity: classifySeverity(priorityScore),
  };
}

module.exports = {
  clampScore,
  computeExposure,
  computePriorityScore,
  classifySeverity,
  evaluateRule,
  rulesCatalog,
};

