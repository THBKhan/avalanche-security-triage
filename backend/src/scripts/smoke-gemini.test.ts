/**
 * Offline Unit Tests for smoke:gemini CLI Flow
 * Uses injectable fake fetch and mock env/log writers; performs zero real network calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runGeminiSmoke, SMOKE_GEMINI_SOURCE } from "./smoke-gemini";

const FAKE_KEY = "fake-gemini-key-smoke-test-never-print";
const TEST_MODEL = "gemini-2.5-flash";

function createLogCollector() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    log: (line: string) => stdout.push(line),
    errorLog: (line: string) => stderr.push(line),
    combined: () => [...stdout, ...stderr].join("\n"),
  };
}

describe("smoke:gemini CLI Flow (Offline Fake Fetch)", () => {
  it("performs zero network calls by default when --live is omitted", async () => {
    let fetchCalls = 0;
    const logs = createLogCollector();

    const outcome = await runGeminiSmoke({
      argv: [],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_MODEL: TEST_MODEL,
        LLM_API_KEY: FAKE_KEY,
      },
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error("Should never call fetch in default dry-run mode");
      },
      log: logs.log,
      errorLog: logs.errorLog,
    });

    assert.equal(fetchCalls, 0);
    assert.equal(outcome.status, "DRY_RUN");
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.reviewedCount, 0);

    const out = logs.combined();
    assert.ok(out.includes(TEST_MODEL));
    assert.ok(out.includes("DRY_RUN"));
    assert.ok(!out.includes(FAKE_KEY), "Must never print API key");
    assert.ok(!out.includes(SMOKE_GEMINI_SOURCE), "Must never print source code");
  });

  it("rejects arbitrary CLI arguments (file paths, source code, or addresses) without calling network", async () => {
    let fetchCalls = 0;
    const logs = createLogCollector();

    const outcome = await runGeminiSmoke({
      argv: ["--live", "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754"],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_MODEL: TEST_MODEL,
        LLM_API_KEY: FAKE_KEY,
      },
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error("Should never call fetch on invalid CLI args");
      },
      log: logs.log,
      errorLog: logs.errorLog,
    });

    assert.equal(fetchCalls, 0);
    assert.equal(outcome.status, "FAIL");
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.errorCode, "INVALID_CLI_ARGS");
    assert.ok(!logs.combined().includes("0x5462D6Bcf9E7C030364d276d493a7F9D0388d754"));
  });

  it("fails with MISSING_CONFIG when --live is set without complete LLM_PROVIDER/LLM_MODEL/LLM_API_KEY", async () => {
    let fetchCalls = 0;

    // Missing LLM_MODEL
    const logs1 = createLogCollector();
    const res1 = await runGeminiSmoke({
      argv: ["--live"],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_API_KEY: FAKE_KEY,
      },
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error("Should never call fetch");
      },
      log: logs1.log,
      errorLog: logs1.errorLog,
    });
    assert.equal(res1.status, "FAIL");
    assert.equal(res1.exitCode, 1);
    assert.equal(res1.errorCode, "MISSING_CONFIG");
    assert.ok(!logs1.combined().includes(FAKE_KEY));

    // Missing LLM_API_KEY
    const logs2 = createLogCollector();
    const res2 = await runGeminiSmoke({
      argv: ["--live"],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_MODEL: TEST_MODEL,
      },
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error("Should never call fetch");
      },
      log: logs2.log,
      errorLog: logs2.errorLog,
    });
    assert.equal(res2.status, "FAIL");
    assert.equal(res2.exitCode, 1);
    assert.equal(res2.errorCode, "MISSING_CONFIG");

    // Missing LLM_PROVIDER
    const logs3 = createLogCollector();
    const res3 = await runGeminiSmoke({
      argv: ["--live"],
      env: {
        LLM_MODEL: TEST_MODEL,
        LLM_API_KEY: FAKE_KEY,
      },
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error("Should never call fetch");
      },
      log: logs3.log,
      errorLog: logs3.errorLog,
    });
    assert.equal(res3.status, "FAIL");
    assert.equal(res3.exitCode, 1);
    assert.equal(res3.errorCode, "MISSING_CONFIG");

    assert.equal(fetchCalls, 0);
  });

  it("passes on --live when Gemini returns valid assessment (with thought part) for floating pragma and hides sensitive output", async () => {
    let fetchCalls = 0;
    let capturedSource = "";
    const logs = createLogCollector();

    const secretExplanationToken = "RAW_EXPLANATION_SHOULD_NOT_BE_PRINTED";
    const fakeFetch: typeof fetch = async (input, init) => {
      fetchCalls += 1;
      assert.equal(
        String(input),
        `https://generativelanguage.googleapis.com/v1beta/models/${TEST_MODEL}:generateContent`
      );
      assert.equal(init?.redirect, "error");
      const reqBody = JSON.parse(String(init?.body));
      const userData = JSON.parse(reqBody.contents[0].parts[0].text);
      capturedSource = userData.sourceCode;

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "Internal chain-of-thought reasoning...", thought: true },
                  {
                    text: JSON.stringify({
                      assessments: [
                        {
                          candidateId: "cand-0",
                          verdict: "potential-issue",
                          confidence: "HIGH",
                          explanation: `Floating pragma ^0.8.20 (${secretExplanationToken})`,
                          evidenceReferences: ["primary"],
                          limitations: ["Does not imply compiler vulnerability."],
                          remediation: "Lock pragma solidity 0.8.20;",
                        },
                      ],
                    }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const outcome = await runGeminiSmoke({
      argv: ["--live"],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_MODEL: TEST_MODEL,
        LLM_API_KEY: FAKE_KEY,
      },
      fetchFn: fakeFetch,
      log: logs.log,
      errorLog: logs.errorLog,
    });

    assert.equal(fetchCalls, 1);
    assert.equal(capturedSource, "pragma solidity ^0.8.20; contract Demo {}");
    assert.equal(outcome.status, "PASS");
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.model, TEST_MODEL);
    assert.equal(outcome.reviewedCount, 1);

    const out = logs.combined();
    assert.ok(out.includes(`Model:    ${TEST_MODEL}`));
    assert.ok(out.includes("Reviewed: 1"));
    assert.ok(out.includes("Result:   PASS"));
    // Strict non-leakage checks
    assert.ok(!out.includes(FAKE_KEY), "Output must not print API key");
    assert.ok(!out.includes("pragma solidity"), "Output must not print source code");
    assert.ok(!out.includes("STRICT SECURITY BOUNDARY"), "Output must not print prompt");
    assert.ok(!out.includes(secretExplanationToken), "Output must not print raw model response");
  });

  it("fails with MISSING_ASSESSMENT when Gemini returns valid JSON that omits the floating pragma candidate", async () => {
    let fetchCalls = 0;
    const logs = createLogCollector();

    const emptyAssessmentsFetch: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify({ assessments: [] }) }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const outcome = await runGeminiSmoke({
      argv: ["--live"],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_MODEL: TEST_MODEL,
        LLM_API_KEY: FAKE_KEY,
      },
      fetchFn: emptyAssessmentsFetch,
      log: logs.log,
      errorLog: logs.errorLog,
    });

    assert.equal(fetchCalls, 1);
    assert.equal(outcome.status, "FAIL");
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.errorCode, "MISSING_ASSESSMENT");
    assert.equal(outcome.reviewedCount, 0);
    assert.ok(logs.combined().includes("MISSING_ASSESSMENT"));
    assert.ok(!logs.combined().includes(FAKE_KEY));
  });

  it("fails safely with LLM_TIMEOUT when Gemini HTTP request hangs and aborts via AbortSignal", async () => {
    let fetchCalls = 0;
    let aborted = false;
    const logs = createLogCollector();

    const hangingFetch: typeof fetch = (_input, init) => {
      fetchCalls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          const err = new Error(`Timeout exposing ${FAKE_KEY} ${SMOKE_GEMINI_SOURCE}`);
          err.name = "AbortError";
          reject(err);
        });
      });
    };

    const outcome = await runGeminiSmoke({
      argv: ["--live"],
      env: {
        LLM_PROVIDER: "gemini",
        LLM_MODEL: TEST_MODEL,
        LLM_API_KEY: FAKE_KEY,
      },
      timeoutMs: 35,
      fetchFn: hangingFetch,
      log: logs.log,
      errorLog: logs.errorLog,
    });

    assert.equal(fetchCalls, 1);
    assert.equal(aborted, true);
    assert.equal(outcome.status, "FAIL");
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.errorCode, "LLM_TIMEOUT");
    assert.equal(outcome.reviewedCount, 0);

    const out = logs.combined();
    assert.ok(out.includes("LLM_TIMEOUT"));
    assert.ok(!out.includes(FAKE_KEY));
    assert.ok(!out.includes("pragma solidity"));
  });
});
