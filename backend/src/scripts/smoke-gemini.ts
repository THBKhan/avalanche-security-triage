/**
 * Controlled Live Smoke Test CLI for Google Gemini Candidate Triage
 *
 * Security & Usage Rules:
 * - Default mode performs ZERO network calls (dry-run).
 * - Sends at most ONE request only when invoked with `--live` AND complete configuration:
 *   LLM_PROVIDER=gemini, LLM_MODEL=<explicit-model-id>, LLM_API_KEY=<key>.
 * - Uses strictly a fixed minimal Solidity source: `pragma solidity ^0.8.20; contract Demo {}`.
 * - Rejects arbitrary CLI arguments (files, source strings, contract/wallet addresses).
 * - Prints ONLY model ID, reviewed candidate count, duration, and pass/fail result.
 *   Never prints API keys, prompts, source code, or raw model responses.
 */

import { loadConfig } from "../config";
import {
  analyzeSoliditySource,
  CandidateTriageService,
  createLlmAdapterFromConfig,
  TriageServiceError,
} from "../analysis";

export const SMOKE_GEMINI_SOURCE = "pragma solidity ^0.8.20; contract Demo {}";

export interface GeminiSmokeOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  nowMs?: () => number;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}

export interface GeminiSmokeOutcome {
  exitCode: number;
  status: "DRY_RUN" | "PASS" | "FAIL";
  model?: string;
  reviewedCount: number;
  durationMs: number;
  errorCode?: string;
}

function formatSummary(
  writer: (line: string) => void,
  fields: { model: string; reviewedCount: number; durationMs: number; result: string }
): void {
  writer(`Model:    ${fields.model}`);
  writer(`Reviewed: ${fields.reviewedCount}`);
  writer(`Duration: ${fields.durationMs}ms`);
  writer(`Result:   ${fields.result}`);
}

/**
 * Execute the Gemini smoke test flow.
 * Separated from process.exit() so CLI behavior can be tested offline with fake fetch.
 */
export async function runGeminiSmoke(
  options: GeminiSmokeOptions = {}
): Promise<GeminiSmokeOutcome> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? (() => Date.now());
  const log = options.log ?? ((line: string) => console.log(line));
  const errorLog = options.errorLog ?? ((line: string) => console.error(line));

  const startMs = nowMs();

  // 1. Strict CLI argument validation: allow ONLY optional `--live`
  let isLive = false;
  for (const arg of argv) {
    if (arg === "--live") {
      isLive = true;
    } else {
      const durationMs = Math.max(0, nowMs() - startMs);
      formatSummary(errorLog, {
        model: "(unset)",
        reviewedCount: 0,
        durationMs,
        result: "FAIL (INVALID_CLI_ARGS: only optional --live flag is allowed)",
      });
      return {
        exitCode: 1,
        status: "FAIL",
        reviewedCount: 0,
        durationMs,
        errorCode: "INVALID_CLI_ARGS",
      };
    }
  }

  // 2. Default no-network guard when --live is omitted
  if (!isLive) {
    let modelLabel = "(unset)";
    try {
      const cfg = loadConfig(env);
      if (cfg.llmModel) modelLabel = cfg.llmModel;
    } catch {
      // Keep safe placeholder in dry-run output
    }
    const durationMs = Math.max(0, nowMs() - startMs);
    formatSummary(log, {
      model: modelLabel,
      reviewedCount: 0,
      durationMs,
      result: "DRY_RUN (no network call; pass --live to run 1 live Gemini request)",
    });
    return {
      exitCode: 0,
      status: "DRY_RUN",
      model: modelLabel === "(unset)" ? undefined : modelLabel,
      reviewedCount: 0,
      durationMs,
    };
  }

  // 3. Load & validate required live configuration
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(env);
  } catch {
    const durationMs = Math.max(0, nowMs() - startMs);
    formatSummary(errorLog, {
      model: "(unset)",
      reviewedCount: 0,
      durationMs,
      result: "FAIL (INVALID_CONFIG)",
    });
    return {
      exitCode: 1,
      status: "FAIL",
      reviewedCount: 0,
      durationMs,
      errorCode: "INVALID_CONFIG",
    };
  }

  if (config.llmProvider !== "gemini" || !config.llmModel || !config.llmApiKey) {
    const durationMs = Math.max(0, nowMs() - startMs);
    formatSummary(errorLog, {
      model: config.llmModel ?? "(unset)",
      reviewedCount: 0,
      durationMs,
      result: "FAIL (MISSING_CONFIG: requires LLM_PROVIDER=gemini, LLM_MODEL, and LLM_API_KEY)",
    });
    return {
      exitCode: 1,
      status: "FAIL",
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      errorCode: "MISSING_CONFIG",
    };
  }

  // 4. Static AST analysis on fixed smoke source
  const analysis = analyzeSoliditySource(SMOKE_GEMINI_SOURCE);
  if (!analysis.ok) {
    const durationMs = Math.max(0, nowMs() - startMs);
    formatSummary(errorLog, {
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      result: "FAIL (STATIC_ANALYSIS_ERROR)",
    });
    return {
      exitCode: 1,
      status: "FAIL",
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      errorCode: "STATIC_ANALYSIS_ERROR",
    };
  }

  const pragmaCandidates = analysis.draft.candidates.filter(
    (c) => c.ruleId === "RULE-PRAGMA-006"
  );
  if (pragmaCandidates.length === 0) {
    const durationMs = Math.max(0, nowMs() - startMs);
    formatSummary(errorLog, {
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      result: "FAIL (EXPECTED_CANDIDATE_MISSING)",
    });
    return {
      exitCode: 1,
      status: "FAIL",
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      errorCode: "EXPECTED_CANDIDATE_MISSING",
    };
  }

  // 5. Execute single triage review via GeminiLlmAdapter -> CandidateTriageService
  try {
    const adapter = createLlmAdapterFromConfig(config, {
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs,
    });
    const service = new CandidateTriageService({ adapter });

    const triageResult = await service.reviewCandidates({
      sourceCode: SMOKE_GEMINI_SOURCE,
      draft: analysis.draft,
    });

    const durationMs = Math.max(0, nowMs() - startMs);
    const reviewedCount = triageResult.reviewedCandidates.length;

    // 6. Strict pass verification:
    //    Floating pragma candidate MUST be assessed with matching evidence reference ("primary")
    //    and zero unreviewed candidates.
    const pragmaAssessment = triageResult.reviewedCandidates.find(
      (r) =>
        r.candidate.ruleId === "RULE-PRAGMA-006" &&
        r.evidenceReferences.includes("primary")
    );

    if (!pragmaAssessment || triageResult.unreviewedCandidates.length > 0) {
      formatSummary(errorLog, {
        model: config.llmModel,
        reviewedCount,
        durationMs,
        result: "FAIL (MISSING_ASSESSMENT: floating pragma candidate was not reviewed)",
      });
      return {
        exitCode: 1,
        status: "FAIL",
        model: config.llmModel,
        reviewedCount,
        durationMs,
        errorCode: "MISSING_ASSESSMENT",
      };
    }

    formatSummary(log, {
      model: config.llmModel,
      reviewedCount,
      durationMs,
      result: "PASS",
    });
    return {
      exitCode: 0,
      status: "PASS",
      model: config.llmModel,
      reviewedCount,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Math.max(0, nowMs() - startMs);
    const safeCode =
      err instanceof TriageServiceError ? err.code : "UNEXPECTED_SMOKE_ERROR";

    formatSummary(errorLog, {
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      result: `FAIL (${safeCode})`,
    });
    return {
      exitCode: 1,
      status: "FAIL",
      model: config.llmModel,
      reviewedCount: 0,
      durationMs,
      errorCode: safeCode,
    };
  }
}

if (require.main === module) {
  void runGeminiSmoke().then((outcome) => {
    process.exitCode = outcome.exitCode;
  }, () => {
    console.error("Result:   FAIL (UNEXPECTED_SMOKE_ERROR)");
    process.exitCode = 1;
  });
}
