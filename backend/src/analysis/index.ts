/**
 * Solidity Analysis Engine
 * Internal AST parsing, fact extraction, and rule evidence generation.
 * Standalone module decoupled from Express, RPC, and LLM providers.
 */

import {
  AnalysisCoverage,
  AnalysisResult,
  RuleCandidate,
  SourceAnalysisDraft,
} from "./types";
import { safeParseSolidityAST } from "./parser";
import { checkPragmas } from "./rules/pragma";
import { checkTxOrigin } from "./rules/tx-origin";
import {
  ANALYZED_RULES,
  UNANALYZED_REASONS,
  UNANALYZED_RULES,
} from "./rules/catalog";

export * from "./types";
export * from "./format";
export * from "./parser";
export * from "./rules/catalog";
export * from "./rules/pragma";
export * from "./rules/tx-origin";
export * from "./triage/types";
export * from "./triage/prompt";
export * from "./triage/adapter";
export * from "./triage/service";

/**
 * Perform static AST parsing and rule evidence extraction on Solidity source code.
 * Safe invocation: catches syntax errors and returns structured errors without throwing.
 *
 * @param sourceCode Raw Solidity source string.
 * @returns AnalysisResult with draft facts/candidates or structured syntax error.
 */
export function analyzeSoliditySource(sourceCode: string): AnalysisResult {
  // 1. Safe AST parsing
  const parseResult = safeParseSolidityAST(sourceCode);
  if (!parseResult.ok) {
    const primary = parseResult.error.errors[0];
    return {
      ok: false,
      error: {
        code: "SYNTAX_ERROR",
        message: parseResult.error.message,
        line: primary?.line,
        column: primary?.column,
        details: parseResult.error.errors,
      },
    };
  }

  const { ast, facts } = parseResult;

  // 2. Extract rule candidates
  const candidates: RuleCandidate[] = [];

  // RULE-PRAGMA-006: Floating Pragma check
  const pragmaCandidates = checkPragmas(facts.pragmas, sourceCode);
  candidates.push(...pragmaCandidates);

  // RULE-TX-ORIGIN-003: tx.origin in require/if condition
  const txOriginCandidates = checkTxOrigin(ast.children || [], facts.contracts, sourceCode);
  candidates.push(...txOriginCandidates);

  // 3. Construct coverage metadata
  const coverage: AnalysisCoverage = {
    analyzedRules: [...ANALYZED_RULES],
    unanalyzedRules: [...UNANALYZED_RULES],
    notes: { ...UNANALYZED_REASONS },
  };

  // 4. Construct limitations
  const limitations: string[] = [];

  if (facts.imports.length > 0) {
    for (const imp of facts.imports) {
      limitations.push(
        `External import '${imp.path}' was not resolved or fetched across network/filesystem boundaries.`
      );
    }
  }

  if (facts.pragmas.length === 0) {
    limitations.push("No pragma solidity directive declared in the provided source code.");
  }

  limitations.push(
    "Static AST analysis is performed on uncompiled source without resolving external imports or running full type-checking."
  );
  limitations.push(
    "Parser supports standard Solidity syntax within @solidity-parser/parser capabilities; experimental or non-standard syntax may not be parsed."
  );
  limitations.push(
    "Tri-pillar scoring, severity classification, and report-level aggregation are deferred to subsequent pipeline stages."
  );
  limitations.push(
    "Rule checks not implemented in the current static analysis module are deferred to subsequent analysis stages."
  );

  const draft: SourceAnalysisDraft = {
    sourceFacts: facts,
    candidates,
    coverage,
    limitations,
  };

  return {
    ok: true,
    draft,
  };
}
