/**
 * Offline Unit Tests for GeminiLlmAdapter and CandidateTriageService Integration
 * Uses injectable fake fetch exclusively; performs zero live network calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyzeSoliditySource } from "../index";
import { GeminiLlmAdapter, createLlmAdapterFromConfig } from "./gemini-adapter";
import { CandidateTriageService } from "./service";

const SAMPLE_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VaultDemo {
    address public owner;

    function sweep(address payable to) external {
        require(tx.origin == owner, "Not owner");
        to.transfer(address(this).balance);
    }
}
`.trim();

const FAKE_SECRET_KEY = "fake-gemini-key-adapter-test-never-leak";
const TEST_MODEL = "gemini-2.5-flash";

function makeGeminiEnvelope(text: string, finishReason = "STOP"): Response {
  const payload = JSON.stringify({
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text }],
        },
        finishReason,
      },
    ],
  });

  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GeminiLlmAdapter (Offline Fake Fetch)", () => {
  describe("Configuration & Explicit Model Enforcement", () => {
    it("rejects missing API key and missing/invalid model ID (no hardcoded default model)", () => {
      assert.throws(
        () => new GeminiLlmAdapter({ apiKey: "", model: TEST_MODEL }),
        (err: any) => err.code === "LLM_ADAPTER_NOT_CONFIGURED"
      );

      assert.throws(
        () => new GeminiLlmAdapter({ apiKey: FAKE_SECRET_KEY, model: "" }),
        (err: any) => err.code === "LLM_ADAPTER_NOT_CONFIGURED"
      );

      assert.throws(
        () => new GeminiLlmAdapter({ apiKey: FAKE_SECRET_KEY, model: "../evil/path" }),
        (err: any) => err.code === "LLM_ADAPTER_NOT_CONFIGURED"
      );
    });

    it("createLlmAdapterFromConfig returns undefined when unset and enforces explicit model/key for gemini", () => {
      assert.equal(createLlmAdapterFromConfig({}), undefined);

      assert.throws(
        () =>
          createLlmAdapterFromConfig({
            llmProvider: "gemini",
            llmApiKey: FAKE_SECRET_KEY,
            llmModel: undefined,
          }),
        (err: any) => err.code === "LLM_ADAPTER_NOT_CONFIGURED"
      );

      assert.throws(
        () =>
          createLlmAdapterFromConfig({
            llmProvider: "gemini",
            llmApiKey: undefined,
            llmModel: TEST_MODEL,
          }),
        (err: any) => err.code === "LLM_ADAPTER_NOT_CONFIGURED"
      );

      const adapter = createLlmAdapterFromConfig({
        llmProvider: "gemini",
        llmApiKey: FAKE_SECRET_KEY,
        llmModel: TEST_MODEL,
      });
      assert.ok(adapter instanceof GeminiLlmAdapter);
    });
  });

  describe("Request Mapping & Valid Triage Flow", () => {
    it("maps systemPrompt to systemInstruction, dataMessage to contents, requests JSON, disables tools, and validates output", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      let fetchCalls = 0;

      const validModelJson = JSON.stringify({
        assessments: [
          {
            candidateId: "cand-0",
            verdict: "potential-issue",
            confidence: "HIGH",
            explanation: "Floating pragma ^0.8.0 allows compilation across minor versions.",
            evidenceReferences: ["primary"],
            limitations: ["Does not evaluate specific compiler CVEs."],
            remediation: "Lock pragma solidity 0.8.20;",
          },
          {
            candidateId: "cand-1",
            verdict: "potential-issue",
            confidence: "MEDIUM",
            explanation: "sweep checks tx.origin == owner before transferring AVAX.",
            evidenceReferences: ["primary", "expression"],
            limitations: ["Assumes owner may interact with untrusted intermediary contracts."],
            remediation: "Use msg.sender == owner instead of tx.origin == owner.",
          },
        ],
      });

      const fakeFetch: typeof fetch = async (input, init) => {
        fetchCalls += 1;
        capturedUrl = String(input);
        capturedInit = init;
        return makeGeminiEnvelope(validModelJson);
      };

      const adapter = new GeminiLlmAdapter({
        apiKey: FAKE_SECRET_KEY,
        model: TEST_MODEL,
        fetchFn: fakeFetch,
      });

      const service = new CandidateTriageService({ adapter });
      const result = await service.reviewCandidates({
        sourceCode: SAMPLE_SOURCE,
        draft: analysis.draft,
      });

      // Verify single request (no retries)
      assert.equal(fetchCalls, 1);

      // Verify endpoint URL & header auth (key NOT in URL)
      assert.equal(
        capturedUrl,
        `https://generativelanguage.googleapis.com/v1beta/models/${TEST_MODEL}:generateContent`
      );
      assert.ok(!capturedUrl.includes(FAKE_SECRET_KEY), "API key must never appear in URL");
      assert.equal(capturedInit?.method, "POST");
      const headers = capturedInit?.headers as Record<string, string>;
      assert.equal(headers["x-goog-api-key"], FAKE_SECRET_KEY);
      assert.equal(headers["Content-Type"], "application/json");
      assert.ok(capturedInit?.signal instanceof AbortSignal);
      assert.equal(capturedInit?.redirect, "error", "Fetch must disallow HTTP redirects");

      // Verify request body mapping
      const parsedBody = JSON.parse(String(capturedInit?.body));
      assert.ok(parsedBody.systemInstruction?.parts?.[0]?.text.includes("STRICT SECURITY BOUNDARY"));
      assert.ok(!parsedBody.systemInstruction.parts[0].text.includes("VaultDemo"));

      assert.equal(parsedBody.contents.length, 1);
      assert.equal(parsedBody.contents[0].role, "user");
      const parsedUserData = JSON.parse(parsedBody.contents[0].parts[0].text);
      assert.equal(parsedUserData.sourceCode, SAMPLE_SOURCE);

      assert.equal(parsedBody.generationConfig?.responseMimeType, "application/json");
      assert.equal(parsedBody.tools, undefined, "Tools must not be enabled");
      assert.equal(parsedBody.toolConfig, undefined, "ToolConfig must not be enabled");

      // Verify end-to-end triage result
      assert.equal(result.reviewedCandidates.length, 2);
      assert.equal(result.unreviewedCandidates.length, 0);
      assert.equal(result.reviewedCandidates[1].candidate.target.signature, "sweep(address payable)");
    });

    it("ignores parts with thought: true when extracting final JSON and still enforces Zod & reference checks", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      const finalJson = JSON.stringify({
        assessments: [
          {
            candidateId: "cand-0",
            verdict: "potential-issue",
            confidence: "HIGH",
            explanation: "Floating pragma ^0.8.0 detected.",
            evidenceReferences: ["primary"],
            limitations: [],
          },
          {
            candidateId: "cand-1",
            verdict: "needs-review",
            confidence: "MEDIUM",
            explanation: "tx.origin check observed in sweep.",
            evidenceReferences: ["primary", "expression"],
            limitations: ["Context verification required."],
          },
        ],
      });

      const thinkingFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Internal reasoning: examining pragma and tx.origin... not JSON!", thought: true },
                    { text: finalJson },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const service = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: thinkingFetch,
        }),
      });

      const result = await service.reviewCandidates({
        sourceCode: SAMPLE_SOURCE,
        draft: analysis.draft,
      });

      assert.equal(result.reviewedCandidates.length, 2);
      assert.equal(result.unreviewedCandidates.length, 0);
      assert.equal(result.reviewedCandidates[0].verdict, "potential-issue");
      assert.equal(result.reviewedCandidates[1].verdict, "needs-review");

      // Thought part present, but final JSON has invalid evidence reference -> still rejected!
      const badRefThinkingFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Thinking through references...", thought: true },
                    {
                      text: JSON.stringify({
                        assessments: [
                          {
                            candidateId: "cand-0",
                            verdict: "potential-issue",
                            confidence: "HIGH",
                            explanation: "Floating pragma",
                            evidenceReferences: ["nonexistent_ref"],
                            limitations: [],
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

      const badRefService = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: badRefThinkingFetch,
        }),
      });

      await assert.rejects(
        () => badRefService.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => err.code === "INVALID_EVIDENCE_REFERENCE"
      );

      // Thought-only response (no final non-thought part) -> LLM_EMPTY_RESPONSE
      const thoughtOnlyFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Only thoughts, forgot to emit JSON", thought: true }],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const thoughtOnlyService = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: thoughtOnlyFetch,
        }),
      });

      await assert.rejects(
        () =>
          thoughtOnlyService.reviewCandidates({
            sourceCode: SAMPLE_SOURCE,
            draft: analysis.draft,
          }),
        (err: any) => err.code === "LLM_EMPTY_RESPONSE"
      );
    });
  });

  describe("Timeout & Real HTTP AbortSignal Cancellation", () => {
    it("aborts hanging HTTP request via AbortSignal on timeout without retrying or leaking secrets", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      let signalAborted = false;
      let fetchCalls = 0;

      const hangingFetch: typeof fetch = (_input, init) => {
        fetchCalls += 1;
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          assert.ok(signal, "AbortSignal must be passed to fetch");
          signal.addEventListener("abort", () => {
            signalAborted = true;
            const abortErr = new Error(`Aborted request for key=${FAKE_SECRET_KEY} ${SAMPLE_SOURCE}`);
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      };

      const adapter = new GeminiLlmAdapter({
        apiKey: FAKE_SECRET_KEY,
        model: TEST_MODEL,
        timeoutMs: 40,
        fetchFn: hangingFetch,
      });

      const service = new CandidateTriageService({ adapter });

      await assert.rejects(
        () => service.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => {
          assert.equal(err.code, "LLM_TIMEOUT");
          assert.equal(signalAborted, true, "HTTP AbortSignal must be triggered");
          assert.equal(fetchCalls, 1, "Must NOT auto-retry LLM requests");
          assert.ok(!err.message.includes(FAKE_SECRET_KEY));
          assert.ok(!err.message.includes("VaultDemo"));
          return true;
        }
      );
    });
  });

  describe("HTTP Errors, Response Size Bounds & No Leakage", () => {
    it("maps HTTP 429 to LLM_RATE_LIMITED without retrying or leaking key/source from body", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      let fetchCalls = 0;
      const rateLimitFetch: typeof fetch = async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: `Quota exceeded for ${FAKE_SECRET_KEY} while reviewing ${SAMPLE_SOURCE}`,
            },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      };

      const service = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: rateLimitFetch,
        }),
      });

      await assert.rejects(
        () => service.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => {
          assert.equal(err.code, "LLM_RATE_LIMITED");
          assert.equal(fetchCalls, 1, "Must NOT auto-retry on 429");
          assert.ok(!err.message.includes(FAKE_SECRET_KEY));
          assert.ok(!err.message.includes("VaultDemo"));
          return true;
        }
      );
    });

    it("maps HTTP 500/503 to LLM_HTTP_ERROR and 401/403 to LLM_AUTH_ERROR safely", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      const serverErrorFetch: typeof fetch = async () =>
        new Response(`Internal error exposing ${FAKE_SECRET_KEY} and ${SAMPLE_SOURCE}`, {
          status: 503,
        });

      const service503 = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: serverErrorFetch,
        }),
      });

      await assert.rejects(
        () => service503.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => {
          assert.equal(err.code, "LLM_HTTP_ERROR");
          assert.ok(!err.message.includes(FAKE_SECRET_KEY));
          assert.ok(!err.message.includes("VaultDemo"));
          return true;
        }
      );

      const authErrorFetch: typeof fetch = async () =>
        new Response(`API key not valid: ${FAKE_SECRET_KEY}`, { status: 403 });

      const service403 = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: authErrorFetch,
        }),
      });

      await assert.rejects(
        () => service403.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => {
          assert.equal(err.code, "LLM_AUTH_ERROR");
          assert.ok(!err.message.includes(FAKE_SECRET_KEY));
          return true;
        }
      );
    });

    it("rejects oversized streaming response bodies with OUTPUT_TOO_LARGE", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      const oversizedFetch: typeof fetch = async () => {
        const chunk = new Uint8Array(2048).fill(65); // 2KB of 'A'
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      };

      const service = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          maxResponseBytes: 2048, // Cap at 2KB; stream sends 4KB
          fetchFn: oversizedFetch,
        }),
      });

      await assert.rejects(
        () => service.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => {
          assert.equal(err.code, "OUTPUT_TOO_LARGE");
          return true;
        }
      );
    });
  });

  describe("Empty, Blocked, Truncated & Disallowed Provider Responses", () => {
    it("handles promptFeedback.blockReason and SAFETY finishReason with LLM_BLOCKED", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      const blockedPromptFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }),
          { status: 200 }
        );

      const servicePromptBlocked = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: blockedPromptFetch,
        }),
      });

      await assert.rejects(
        () =>
          servicePromptBlocked.reviewCandidates({
            sourceCode: SAMPLE_SOURCE,
            draft: analysis.draft,
          }),
        (err: any) => err.code === "LLM_BLOCKED"
      );

      const blockedCandidateFetch: typeof fetch = async () =>
        makeGeminiEnvelope("", "SAFETY");

      const serviceCandBlocked = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: blockedCandidateFetch,
        }),
      });

      await assert.rejects(
        () =>
          serviceCandBlocked.reviewCandidates({
            sourceCode: SAMPLE_SOURCE,
            draft: analysis.draft,
          }),
        (err: any) => err.code === "LLM_BLOCKED"
      );
    });

    it("handles empty candidates or empty text with LLM_EMPTY_RESPONSE and MAX_TOKENS with LLM_TRUNCATED_RESPONSE", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      const emptyFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ candidates: [] }), { status: 200 });

      const serviceEmpty = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: emptyFetch,
        }),
      });

      await assert.rejects(
        () => serviceEmpty.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => err.code === "LLM_EMPTY_RESPONSE"
      );

      const truncatedFetch: typeof fetch = async () =>
        makeGeminiEnvelope('{"assessments": [{"candidateId": "cand-0"', "MAX_TOKENS");

      const serviceTruncated = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: truncatedFetch,
        }),
      });

      await assert.rejects(
        () =>
          serviceTruncated.reviewCandidates({
            sourceCode: SAMPLE_SOURCE,
            draft: analysis.draft,
          }),
        (err: any) => err.code === "LLM_TRUNCATED_RESPONSE"
      );
    });

    it("rejects unexpected functionCall part and preserves Zod/reference checks on inner JSON", async () => {
      const analysis = analyzeSoliditySource(SAMPLE_SOURCE);
      assert.equal(analysis.ok, true);
      if (!analysis.ok) return;

      const toolCallFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ functionCall: { name: "runShell", args: {} } }],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200 }
        );

      const serviceTool = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: toolCallFetch,
        }),
      });

      await assert.rejects(
        () => serviceTool.reviewCandidates({ sourceCode: SAMPLE_SOURCE, draft: analysis.draft }),
        (err: any) => err.code === "LLM_PROVIDER_ERROR"
      );

      // Valid Gemini envelope, but inner JSON tries to inject priorityScore (rejected by Zod strict)
      const badInnerJsonFetch: typeof fetch = async () =>
        makeGeminiEnvelope(
          JSON.stringify({
            priorityScore: 99,
            assessments: [],
          })
        );

      const serviceBadInner = new CandidateTriageService({
        adapter: new GeminiLlmAdapter({
          apiKey: FAKE_SECRET_KEY,
          model: TEST_MODEL,
          fetchFn: badInnerJsonFetch,
        }),
      });

      await assert.rejects(
        () =>
          serviceBadInner.reviewCandidates({
            sourceCode: SAMPLE_SOURCE,
            draft: analysis.draft,
          }),
        (err: any) => {
          assert.equal(err.code, "INVALID_MODEL_OUTPUT");
          assert.ok(!JSON.stringify(err.issues ?? []).includes("priorityScore"));
          return true;
        }
      );
    });
  });
});
