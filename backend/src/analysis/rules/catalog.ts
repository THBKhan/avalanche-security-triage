/**
 * Rules Catalog Loader and Coverage Registry
 * Loads rule metadata strictly from backend/rules/rules-catalog.json as the single source of truth.
 * Does not duplicate rule definitions by hand.
 */

import fs from "fs";
import path from "path";

export interface RuleMeta {
  id: string;
  swc: string;
  title: string;
  defaultExploitability: number;
  mitigatedBy: string[];
  mitigatedExploitability: number;
  requiredEvidence: string[];
  falsePositiveExclusions: string[];
}

export const ANALYZED_RULES = ["RULE-PRAGMA-006", "RULE-TX-ORIGIN-003"] as const;

export const UNANALYZED_RULES = [
  "RULE-REENTRANCY-001",
  "RULE-ACCESS-002",
  "RULE-UNCHECKED-CALL-004",
  "RULE-DELEGATECALL-005",
] as const;

export const UNANALYZED_REASONS: Record<string, string> = {
  "RULE-REENTRANCY-001":
    "Inter-procedural state mutation tracking and CEI control-flow analysis are not implemented in the current static analysis module.",
  "RULE-ACCESS-002":
    "Identifying critical state mutations and role governance semantics are not implemented in the current static analysis module.",
  "RULE-UNCHECKED-CALL-004":
    "Low-level call return value capture validation is not implemented in the current static analysis module.",
  "RULE-DELEGATECALL-005":
    "Delegatecall target address provenance tracking is not implemented in the current static analysis module.",
};

/**
 * Locate rules-catalog.json using relative module paths first, falling back to process.cwd() paths.
 */
export function resolveRulesCatalogPath(): string {
  const candidatePaths = [
    // 1. From backend/src/analysis/rules/ or backend/dist/analysis/rules/ -> backend/rules/rules-catalog.json
    path.resolve(__dirname, "../../../rules/rules-catalog.json"),
    // 2. From backend/dist/rules/
    path.resolve(__dirname, "../../rules/rules-catalog.json"),
    path.resolve(__dirname, "../rules/rules-catalog.json"),
    // 3. Fallbacks using process.cwd()
    path.resolve(process.cwd(), "backend/rules/rules-catalog.json"),
    path.resolve(process.cwd(), "rules/rules-catalog.json"),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Failed to locate rules-catalog.json. Searched locations:\n  - ${candidatePaths.join("\n  - ")}`
  );
}

/**
 * Load and validate rules-catalog.json from disk.
 */
export function loadRulesCatalog(customPath?: string): Record<string, RuleMeta> {
  const filePath = customPath || resolveRulesCatalogPath();
  const content = fs.readFileSync(filePath, "utf-8");

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    throw new Error(`Failed to parse rules-catalog.json at ${filePath}: ${err.message}`);
  }

  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(
      `Invalid rules-catalog.json format at ${filePath}: missing 'rules' array.`
    );
  }

  const catalog: Record<string, RuleMeta> = {};

  for (const rule of parsed.rules) {
    if (!rule.id || typeof rule.id !== "string") {
      throw new Error(`Invalid rule entry in ${filePath}: missing string 'id'.`);
    }
    if (!rule.title || typeof rule.title !== "string") {
      throw new Error(`Invalid rule entry '${rule.id}' in ${filePath}: missing string 'title'.`);
    }
    if (!rule.swc || typeof rule.swc !== "string") {
      throw new Error(`Invalid rule entry '${rule.id}' in ${filePath}: missing string 'swc'.`);
    }
    if (typeof rule.defaultExploitability !== "number") {
      throw new Error(
        `Invalid rule entry '${rule.id}' in ${filePath}: missing numeric 'defaultExploitability'.`
      );
    }
    if (!Array.isArray(rule.requiredEvidence)) {
      throw new Error(
        `Invalid rule entry '${rule.id}' in ${filePath}: missing 'requiredEvidence' array.`
      );
    }

    catalog[rule.id] = {
      id: rule.id,
      swc: rule.swc,
      title: rule.title,
      defaultExploitability: rule.defaultExploitability,
      mitigatedBy: Array.isArray(rule.mitigatedBy) ? rule.mitigatedBy : [],
      mitigatedExploitability:
        typeof rule.mitigatedExploitability === "number"
          ? rule.mitigatedExploitability
          : rule.defaultExploitability,
      requiredEvidence: rule.requiredEvidence,
      falsePositiveExclusions: Array.isArray(rule.falsePositiveExclusions)
        ? rule.falsePositiveExclusions
        : [],
    };
  }

  // Validate that all analyzed and unanalyzed rule IDs exist in the catalog
  for (const ruleId of ANALYZED_RULES) {
    if (!catalog[ruleId]) {
      throw new Error(`Expected analyzed rule '${ruleId}' not found in rules-catalog.json.`);
    }
  }

  for (const ruleId of UNANALYZED_RULES) {
    if (!catalog[ruleId]) {
      throw new Error(`Expected unanalyzed rule '${ruleId}' not found in rules-catalog.json.`);
    }
  }

  return catalog;
}

// Singleton catalog initialized at module load
export const RULES_CATALOG: Record<string, RuleMeta> = loadRulesCatalog();
