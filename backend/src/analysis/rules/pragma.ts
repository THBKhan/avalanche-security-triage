/**
 * RULE-PRAGMA-006: Floating Pragma & Outdated Compiler Version
 * Detects floating pragma (^ or >= range) vs locked compiler version.
 * Does not assert compiler vulnerabilities solely from version ranges.
 */

import { PragmaInfo, RuleCandidate } from "../types";
import { formatLineSpan, extractSnippet } from "../format";
import { RULES_CATALOG } from "./catalog";

/**
 * Determine if a Solidity pragma value represents a floating version range.
 * Examples of floating/range pragmas:
 *   "^0.8.0", ">=0.8.0", ">=0.8.0 <0.9.0", ">0.8.0", "0.8.0 - 0.8.20", "~0.8.0"
 * Examples of locked pragmas:
 *   "0.8.20", "=0.8.20", "0.8.0"
 */
export function isFloatingPragma(value: string): boolean {
  const trimmed = value.trim();
  if (/[\^~><]/.test(trimmed)) return true;
  if (trimmed.includes(" - ")) return true;
  if (/\s+[<>]/.test(trimmed)) return true;
  return false;
}

/**
 * Check pragma directives and extract RULE-PRAGMA-006 candidate findings.
 */
export function checkPragmas(pragmas: PragmaInfo[], sourceCode: string): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  const meta = RULES_CATALOG["RULE-PRAGMA-006"];

  for (const pragma of pragmas) {
    if (pragma.name.toLowerCase() !== "solidity") continue;

    if (pragma.isFloating) {
      const lines = formatLineSpan(pragma.location);
      const snippet = extractSnippet(sourceCode, pragma.range);

      candidates.push({
        ruleId: meta.id,
        title: meta.title,
        swc: meta.swc,
        target: {
          functionName: "Global",
          visibility: "n/a",
          modifiers: [],
        },
        evidence: {
          lines,
          snippet,
          reasoning: `Pragma solidity specifies a floating version range ('${pragma.value}') instead of a locked compiler version.`,
          location: pragma.location,
          range: pragma.range,
        },
        confidence: "HIGH",
        limitations: [
          "Static check reports compiler version range; does not evaluate specific compiler vulnerabilities or compatibility.",
          "Source has not been compiled or type-checked against a specific solc binary.",
        ],
      });
    }
  }

  return candidates;
}
