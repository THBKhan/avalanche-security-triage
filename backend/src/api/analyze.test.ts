import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { custom, createPublicClient, toHex } from "viem";
import { avalancheFuji } from "viem/chains";
import { createApp } from "../app";
import { AppConfig } from "../config";
import { OnChainContextReader, RpcContextError, FUJI_CHAIN_ID } from "../rpc/context";
import { createResponseValidator } from "./schema";

const validateResponse = createResponseValidator();

const testConfig: AppConfig = {
  port: 3001,
  fujiRpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  corsOrigin: "http://localhost:3000",
  llmApiKey: undefined,
};

const VALID_ADDRESS = "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754";

test("POST /api/analyze: Address-only thành công, đúng response schema và attest DISABLED", async () => {
  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return "0x1bc16d674ec80000"; // 2 AVAX
      if (method === "eth_getCode") return "0x"; // Non-contract (EOA/empty)
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });
  const reader = new OnChainContextReader({ client });
  const app = createApp(testConfig, { reader });

  const res = await request(app)
    .post("/api/analyze")
    .send({ contractAddress: VALID_ADDRESS });

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, "context-only");
  assert.equal(res.body.targetContract.address, "0x5462d6Bcf9E7C030364D276d493A7F9D0388d754");
  assert.equal(res.body.targetContract.network, "Avalanche Fuji Testnet");
  assert.equal(res.body.targetContract.chainId, 43113);
  assert.equal(res.body.targetContract.dataSource, "fuji-rpc");
  assert.match(res.body.targetContract.queriedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(res.body.targetContract.attemptedAt, undefined);
  assert.equal(res.body.targetContract.balanceAvax, "2");
  assert.equal(res.body.targetContract.isContract, false);
  assert.equal(res.body.targetContract.bytecodeSize, 0);
  assert.equal(res.body.attestation.status, "DISABLED");
  assert.ok(res.body.attestation.disabledReason);

  // Address-only must NEVER simulate findings, priorityScore, or reportHash
  assert.equal(res.body.findings, undefined);
  assert.equal(res.body.summary, undefined);
  assert.equal(res.body.report, undefined);
  assert.equal(res.body.reportHash, undefined);

  // Validate response against official JSON Schema draft 2020-12
  const isValid = validateResponse(res.body);
  assert.equal(isValid, true, `Response does not match analyze-response.schema.json: ${JSON.stringify(validateResponse.errors)}`);
});

test("POST /api/analyze: Context có optional warning vẫn trả 200 và giữ nguyên warning", async () => {
  const mockTransport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x60806040"; // Contract code
      if (method === "eth_call") {
        throw new Error("execution reverted: function does not exist");
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });
  const reader = new OnChainContextReader({ client });
  const app = createApp(testConfig, { reader });

  const res = await request(app)
    .post("/api/analyze")
    .send({ contractAddress: VALID_ADDRESS });

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, "context-only");
  assert.equal(res.body.targetContract.isContract, true);
  assert.equal(res.body.targetContract.owner, null);
  assert.equal(res.body.targetContract.isPaused, null);
  assert.ok(res.body.targetContract.warning?.includes("not supported or execution reverted"));

  const isValid = validateResponse(res.body);
  assert.equal(isValid, true, `Response violates schema: ${JSON.stringify(validateResponse.errors)}`);
});

test("POST /api/analyze: Request sai schema ({}, source rỗng, address sai, zero address, trường thừa) trả 400 và không gọi reader", async () => {
  let readerCalled = false;
  const mockReader = {
    fetchContext: async () => {
      readerCalled = true;
      throw new Error("Reader should not have been called");
    },
  } as unknown as OnChainContextReader;

  const app = createApp(testConfig, { reader: mockReader });

  const invalidPayloads = [
    { name: "Empty object {}", payload: {}, expectedCode: "INVALID_REQUEST" },
    { name: "Empty sourceCode", payload: { sourceCode: "" }, expectedCode: "INVALID_REQUEST" },
    { name: "Whitespace-only sourceCode", payload: { sourceCode: "   \n\t  " }, expectedCode: "INVALID_REQUEST" },
    { name: "Short address", payload: { contractAddress: "0x123" }, expectedCode: "INVALID_REQUEST" },
    { name: "Invalid hex address", payload: { contractAddress: "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ" }, expectedCode: "INVALID_REQUEST" },
    { name: "Zero address", payload: { contractAddress: "0x0000000000000000000000000000000000000000" }, expectedCode: "INVALID_ADDRESS" },
    { name: "Unknown property outside schema", payload: { contractAddress: VALID_ADDRESS, injectedMaliciousField: 123 }, expectedCode: "INVALID_REQUEST" },
  ];

  for (const item of invalidPayloads) {
    const res = await request(app)
      .post("/api/analyze")
      .send(item.payload);

    assert.equal(res.status, 400, `Failed for ${item.name}: expected 400 got ${res.status}`);
    assert.equal(res.body.error?.code, item.expectedCode);
    assert.ok(res.body.error?.message);

    // Ensure error does NOT echo raw input, sourceCode, or secrets
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes("injectedMaliciousField"));
    assert.ok(!bodyStr.includes("stack"));

    const isValid = validateResponse(res.body);
    assert.equal(isValid, true, `Error response violates schema for ${item.name}: ${JSON.stringify(validateResponse.errors)}`);
  }

  assert.equal(readerCalled, false, "Reader must never be called for invalid requests");
});

test("POST /api/analyze: Malformed JSON (400) and Payload Too Large (413) on /api/analyze", async () => {
  const app = createApp(testConfig);

  // 1. Malformed JSON
  const resBadJson = await request(app)
    .post("/api/analyze")
    .set("Content-Type", "application/json")
    .send("{ contractAddress: ");
  assert.equal(resBadJson.status, 400);
  assert.equal(resBadJson.body.error?.code, "INVALID_JSON");
  assert.equal(validateResponse(resBadJson.body), true);

  // 2. Payload too large (>250kb)
  const hugePayload = JSON.stringify({ contractAddress: VALID_ADDRESS, data: "a".repeat(260 * 1024) });
  const resLarge = await request(app)
    .post("/api/analyze")
    .set("Content-Type", "application/json")
    .send(hugePayload);
  assert.equal(resLarge.status, 413);
  assert.equal(resLarge.body.error?.code, "PAYLOAD_TOO_LARGE");
  assert.equal(validateResponse(resLarge.body), true);
});

test("POST /api/analyze: Timeout, upstream rate limit, wrong network, và RPC error trả 502 UPSTREAM_RPC_ERROR", async () => {
  const errorCases: Array<{ error: RpcContextError; expectedReason: string }> = [
    {
      error: new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget"),
      expectedReason: "RPC_TIMEOUT",
    },
    {
      error: new RpcContextError("RATE_LIMITED", "RPC request rate limited by upstream provider"),
      expectedReason: "RATE_LIMITED",
    },
    {
      error: new RpcContextError("WRONG_NETWORK", "RPC endpoint is not connected to Avalanche Fuji"),
      expectedReason: "WRONG_NETWORK",
    },
    {
      error: new RpcContextError("RPC_ERROR", "Upstream RPC query failed during operation"),
      expectedReason: "RPC_ERROR",
    },
  ];

  for (const item of errorCases) {
    const mockReader = {
      fetchContext: async () => {
        throw item.error;
      },
    } as unknown as OnChainContextReader;

    const app = createApp(testConfig, { reader: mockReader });

    const res = await request(app)
      .post("/api/analyze")
      .send({ contractAddress: VALID_ADDRESS });

    assert.equal(res.status, 502, `Expected 502 for ${item.expectedReason}, got ${res.status}`);
    assert.equal(res.body.error?.code, "UPSTREAM_RPC_ERROR");
    assert.equal(res.body.error?.details?.reason, item.expectedReason);
    assert.ok(!JSON.stringify(res.body).includes("stack"));

    const isValid = validateResponse(res.body);
    assert.equal(isValid, true, `Error response violates schema for ${item.expectedReason}: ${JSON.stringify(validateResponse.errors)}`);
  }
});

test("POST /api/analyze: Lỗi bất ngờ trả 500, không rò rỉ secret giả", async () => {
  const sensitiveError = new Error("Database failed connecting to postgres://db_admin:vault_secret_token_12345@internal.cluster:5432/secrets");
  const mockReader = {
    fetchContext: async () => {
      throw sensitiveError;
    },
  } as unknown as OnChainContextReader;

  const app = createApp(testConfig, { reader: mockReader });

  const res = await request(app)
    .post("/api/analyze")
    .send({ contractAddress: VALID_ADDRESS });

  assert.equal(res.status, 500);
  assert.equal(res.body.error?.code, "INTERNAL_SERVER_ERROR");
  assert.equal(res.body.error?.message, "An internal server error occurred");

  const bodyStr = JSON.stringify(res.body);
  assert.ok(!bodyStr.includes("vault_secret_token_12345"), "Must not leak secret token in error body");
  assert.ok(!bodyStr.includes("db_admin"), "Must not leak username");
  assert.ok(!bodyStr.includes("stack"), "Must not leak stack trace");

  const isValid = validateResponse(res.body);
  assert.equal(isValid, true, `Error response violates schema: ${JSON.stringify(validateResponse.errors)}`);
});

test("POST /api/analyze: source-only persists its report and source plus RPC failure keeps the report", async () => {
  let readerCalls = 0;
  let saves = 0;
  const reader = {
    fetchContext: async () => {
      readerCalls++;
      throw new RpcContextError("RPC_TIMEOUT", "Private diagnostic");
    },
  };
  const app = createApp(testConfig, {
    reader,
    snapshots: { save: async () => { saves++; } },
  });
  const resSourceOnly = await request(app)
    .post("/api/analyze")
    .send({ sourceCode: "pragma solidity ^0.8.0; contract Vault {}" });

  assert.equal(resSourceOnly.status, 200);
  assert.equal(resSourceOnly.body.mode, "source-analysis");
  assert.equal(resSourceOnly.body.report.summary.priorityScore, 0);
  assert.equal(resSourceOnly.body.report.summary.scoredFindingCount, 0);
  assert.equal(resSourceOnly.body.report.findings[0].scores.priorityScore, 7);
  assert.equal(resSourceOnly.body.attestation.status, "NOT_ATTESTABLE");
  assert.equal(readerCalls, 0);
  assert.equal(saves, 1);
  assert.equal(validateResponse(resSourceOnly.body), true);

  const resBoth = await request(app)
    .post("/api/analyze")
    .send({
      sourceCode: "pragma solidity ^0.8.0; contract Vault {}",
      contractAddress: VALID_ADDRESS,
    });

  assert.equal(resBoth.status, 200);
  assert.equal(resBoth.body.report.targetContract.status, "unavailable");
  assert.equal(validateResponse(resBoth.body), true);
  assert.equal(readerCalls, 1);
  assert.equal(saves, 2);
});

test("POST /api/analyze: Hai requests dùng cùng app tái sử dụng reader instance và cache", async () => {
  let balanceCallCount = 0;
  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") {
        balanceCallCount++;
        return "0x1bc16d674ec80000";
      }
      if (method === "eth_getCode") return "0x";
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });
  const reader = new OnChainContextReader({ client });
  const app = createApp(testConfig, { reader });

  // Request 1: Cache miss -> triggers balance query
  const res1 = await request(app)
    .post("/api/analyze")
    .send({ contractAddress: VALID_ADDRESS });
  assert.equal(res1.status, 200);
  assert.equal(balanceCallCount, 1);
  const queriedAt1 = res1.body.targetContract.queriedAt;

  // Request 2: Same address on same app instance -> Cache hit -> Does NOT call balance query again
  const res2 = await request(app)
    .post("/api/analyze")
    .send({ contractAddress: VALID_ADDRESS });
  assert.equal(res2.status, 200);
  assert.equal(balanceCallCount, 1, "Second request must hit cache and not re-query RPC");
  assert.equal(res2.body.targetContract.queriedAt, queriedAt1, "Cache hit must preserve original queriedAt");
});
