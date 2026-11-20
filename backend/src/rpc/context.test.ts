import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { custom, createPublicClient, toHex, encodeFunctionResult, getAddress } from "viem";
import { avalancheFuji } from "viem/chains";
import {
  fetchOnChainContext,
  clearRpcContextCache,
  OnChainContextReader,
  RpcContextError,
  MINIMAL_OWNER_ABI,
  MINIMAL_PAUSED_ABI,
  FUJI_CHAIN_ID,
} from "./context";
import { createFujiRpcClient } from "./client";

const VALID_ADDRESS = "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754";
const OWNER_ADDRESS = "0x1234567890123456789012345678901234567890";

beforeEach(() => {
  clearRpcContextCache();
});

test("Address sai & Zero address: INVALID_ADDRESS thrown immediately without calling RPC", async () => {
  let rpcCalled = false;
  const mockTransport = custom({
    async request() {
      rpcCalled = true;
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  // Test invalid string
  await assert.rejects(
    () => fetchOnChainContext("not-an-address", { client }),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "INVALID_ADDRESS");
      return true;
    }
  );

  // Test zero address
  await assert.rejects(
    () => fetchOnChainContext("0x0000000000000000000000000000000000000000", { client }),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "INVALID_ADDRESS");
      return true;
    }
  );

  assert.equal(rpcCalled, false, "RPC should not be called for invalid or zero address");
});

test("Address invariant: output address matches input address after lowercase, and RPC receives exact address", async () => {
  const recordedAddresses: { getBalance?: string; getCode?: string; ethCall?: string } = {};

  const mockTransport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") {
        recordedAddresses.getBalance = (params as any)[0];
        return "0x0";
      }
      if (method === "eth_getCode") {
        recordedAddresses.getCode = (params as any)[0];
        return "0x1234";
      }
      if (method === "eth_call") {
        recordedAddresses.ethCall = (params as any)[0]?.to;
        return encodeFunctionResult({
          abi: MINIMAL_PAUSED_ABI,
          functionName: "paused",
          result: false,
        });
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const ctx = await fetchOnChainContext(VALID_ADDRESS, { client, sleepFn: () => Promise.resolve() });

  // Invariant 1: output address matches input lowercase
  assert.equal(ctx.address.toLowerCase(), VALID_ADDRESS.toLowerCase());
  // Invariant 2: output address is properly checksummed
  assert.equal(ctx.address, getAddress(VALID_ADDRESS));

  // Invariant 3: all RPC calls received the exact normalized address
  assert.equal(recordedAddresses.getBalance, getAddress(VALID_ADDRESS));
  assert.equal(recordedAddresses.getCode, getAddress(VALID_ADDRESS));
  assert.equal(recordedAddresses.ethCall, getAddress(VALID_ADDRESS));
});

test("Balance lớn: giữ nguyên độ chính xác chuỗi (không bị mất chữ số qua Number)", async () => {
  // 1,000,000,000.123456789012345678 AVAX in Wei
  const largeWei = 1000000000123456789012345678n;
  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return toHex(largeWei);
      if (method === "eth_getCode") return "0x";
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const ctx = await fetchOnChainContext(VALID_ADDRESS, { client });
  assert.equal(ctx.balanceAvax, "1000000000.123456789012345678");
  assert.equal(ctx.isContract, false);
  assert.equal(ctx.bytecodeSize, 0);
  assert.equal(ctx.owner, null);
  assert.equal(ctx.isPaused, null);
});

test("Without code (0x / undefined): isContract=false, bytecodeSize=0, skips optional calls", async () => {
  let callAttempted = false;
  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x";
      if (method === "eth_call") {
        callAttempted = true;
        return null;
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const ctx = await fetchOnChainContext(VALID_ADDRESS, { client });
  assert.equal(ctx.isContract, false);
  assert.equal(ctx.bytecodeSize, 0);
  assert.equal(callAttempted, false, "Should not attempt eth_call if bytecode is empty");
});

test("With code: reads owner() and paused() successfully", async () => {
  const mockTransport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return toHex(1000000000000000000n); // 1 AVAX
      if (method === "eth_getCode") return "0x608060405234801561001057600080fd5b50"; // 18 bytes
      if (method === "eth_call") {
        const callData = (params as any)[0]?.data as string;
        if (callData.startsWith("0x8da5cb5b")) {
          return encodeFunctionResult({
            abi: MINIMAL_OWNER_ABI,
            functionName: "owner",
            result: OWNER_ADDRESS,
          });
        }
        if (callData.startsWith("0x5c975abb")) {
          return encodeFunctionResult({
            abi: MINIMAL_PAUSED_ABI,
            functionName: "paused",
            result: false,
          });
        }
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const ctx = await fetchOnChainContext(VALID_ADDRESS, { client });
  assert.equal(ctx.isContract, true);
  assert.equal(ctx.bytecodeSize, 18);
  assert.equal(ctx.owner, OWNER_ADDRESS);
  assert.equal(ctx.isPaused, false);
  assert.equal(ctx.warning, undefined);
});

test("Optional warnings: phân biệt rõ ràng revert vs transport vs budget", async () => {
  const mockTransport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x1234";
      if (method === "eth_call") {
        const callData = (params as any)[0]?.data as string;
        if (callData.startsWith("0x8da5cb5b")) {
          // Revert for owner
          throw new Error("execution reverted: function does not exist");
        }
        if (callData.startsWith("0x5c975abb")) {
          // Transport failure for paused
          throw new Error("fetch failed: socket hang up");
        }
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const ctx = await fetchOnChainContext(VALID_ADDRESS, { client, sleepFn: () => Promise.resolve() });
  assert.equal(ctx.isContract, true);
  assert.equal(ctx.owner, null);
  assert.equal(ctx.isPaused, null);
  assert.ok(ctx.warning?.includes("owner() not supported or execution reverted"));
  assert.ok(ctx.warning?.includes("paused() transport error"));
});

test("Cache isolation across clients: Client A (Fuji) does not leak cache to Client B (wrong network)", async () => {
  // Client A connected to Fuji
  const transportA = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x";
      return null;
    },
  }, { retryCount: 0 });
  const clientA = createPublicClient({ chain: avalancheFuji, transport: transportA });
  const readerA = new OnChainContextReader({ client: clientA });

  // Client B connected to wrong network (Chain ID 1)
  const transportB = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(1); // Mainnet
      return null;
    },
  }, { retryCount: 0 });
  const clientB = createPublicClient({ chain: avalancheFuji, transport: transportB });
  const readerB = new OnChainContextReader({ client: clientB });

  // Reader A fetches and caches
  const ctxA = await readerA.fetchContext(VALID_ADDRESS);
  assert.equal(ctxA.status, "available");
  assert.equal(readerA.getCacheSize(), 1);

  // Reader B must NOT use Reader A's cache and must be rejected with WRONG_NETWORK
  await assert.rejects(
    () => readerB.fetchContext(VALID_ADDRESS),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "WRONG_NETWORK");
      return true;
    }
  );
  assert.equal(readerB.getCacheSize(), 0);
});

test("Credential protection: secrets in userinfo, path, query and error body are NOT leaked", async () => {
  const sensitiveUrl = "https://sensitive_user:topsecret_pass_123@node.example.com/vault_token_456?api_key=query_secret_789";
  const mockTransport = custom({
    async request() {
      throw new Error(`Connection to ${sensitiveUrl} failed with secret response body {"token":"body_secret_999"}`);
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  try {
    await fetchOnChainContext(VALID_ADDRESS, { client, maxRetries: 0 });
    assert.fail("Should have thrown");
  } catch (err: unknown) {
    assert.ok(err instanceof RpcContextError);
    assert.equal(err.code, "RPC_ERROR");
    // Verify error message is a safe fixed string
    assert.equal(err.message, "Upstream RPC query failed during operation");

    const fullErrorStr = JSON.stringify({ message: err.message, details: err.details });
    assert.ok(!fullErrorStr.includes("topsecret_pass_123"), "Password must not appear in error");
    assert.ok(!fullErrorStr.includes("sensitive_user"), "Username must not appear in error");
    assert.ok(!fullErrorStr.includes("vault_token_456"), "URL path secret must not appear in error");
    assert.ok(!fullErrorStr.includes("query_secret_789"), "Query secret must not appear in error");
    assert.ok(!fullErrorStr.includes("body_secret_999"), "Body secret must not appear in error");
  }
});

test("Validation of reader options rejects invalid/negative values, decimals, NaN, Infinity, and out-of-range", () => {
  // timeoutMs validation: must be positive finite number
  assert.throws(() => new OnChainContextReader({ timeoutMs: -1 }), /timeoutMs must be a positive/);
  assert.throws(() => new OnChainContextReader({ timeoutMs: 0 }), /timeoutMs must be a positive/);
  assert.throws(() => new OnChainContextReader({ timeoutMs: NaN }), /timeoutMs must be a positive/);
  assert.throws(() => new OnChainContextReader({ timeoutMs: Infinity }), /timeoutMs must be a positive/);
  assert.throws(() => new OnChainContextReader({ timeoutMs: -Infinity }), /timeoutMs must be a positive/);

  // maxRetries validation: must be integer in 0..2
  assert.throws(() => new OnChainContextReader({ maxRetries: -1 }), /maxRetries must be an integer between 0 and 2/);
  assert.throws(() => new OnChainContextReader({ maxRetries: 0.5 }), /maxRetries must be an integer between 0 and 2/);
  assert.throws(() => new OnChainContextReader({ maxRetries: NaN }), /maxRetries must be an integer between 0 and 2/);
  assert.throws(() => new OnChainContextReader({ maxRetries: Infinity }), /maxRetries must be an integer between 0 and 2/);
  assert.throws(() => new OnChainContextReader({ maxRetries: 3 }), /maxRetries must be an integer between 0 and 2/);
  assert.throws(() => new OnChainContextReader({ maxRetries: 10 }), /maxRetries must be an integer between 0 and 2/);

  // Valid values (0, 1, 2) must not throw
  assert.doesNotThrow(() => new OnChainContextReader({ maxRetries: 0 }));
  assert.doesNotThrow(() => new OnChainContextReader({ maxRetries: 1 }));
  assert.doesNotThrow(() => new OnChainContextReader({ maxRetries: 2 }));
});

test("Transient retry with exponential backoff: fails once, succeeds on retry", async () => {
  let attempt = 0;
  const backoffDelays: number[] = [];

  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") {
        attempt++;
        if (attempt === 1) {
          throw new Error("fetch failed: socket hang up");
        }
        return toHex(FUJI_CHAIN_ID);
      }
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x";
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const ctx = await fetchOnChainContext(VALID_ADDRESS, {
    client,
    sleepFn: (ms) => {
      backoffDelays.push(ms);
      return Promise.resolve();
    },
  });
  assert.equal(ctx.status, "available");
  assert.equal(attempt, 2);
  // Attempt 1 backoff should be 100ms
  assert.equal(backoffDelays[0], 100);
});

test("Cache TTL & mutation protection: returns clone with identical queriedAt", async () => {
  let callCount = 0;
  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") {
        return toHex(FUJI_CHAIN_ID);
      }
      if (method === "eth_getBalance") {
        callCount++;
        return "0x0";
      }
      if (method === "eth_getCode") return "0x";
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  let virtualTime = 500000;
  const clock = () => new Date(virtualTime);
  const reader = new OnChainContextReader({ client, clock });

  const ctx1 = await reader.fetchContext(VALID_ADDRESS);
  assert.equal(callCount, 1);
  const queriedAt1 = ctx1.queriedAt;

  // Mutate ctx1
  ctx1.balanceAvax = "999999";
  virtualTime += 10000; // 10s within 30s TTL

  const ctx2 = await reader.fetchContext(VALID_ADDRESS);
  assert.equal(callCount, 1, "Cache hit should not trigger RPC");
  assert.equal(ctx2.queriedAt, queriedAt1, "Cache hit must preserve original queriedAt");
  assert.equal(ctx2.balanceAvax, "0", "Mutating ctx1 must not corrupt cached data");

  virtualTime += 35000; // Exceeds 30s TTL
  const ctx3 = await reader.fetchContext(VALID_ADDRESS);
  assert.equal(callCount, 2, "Expired cache triggers fresh RPC query");
  assert.notEqual(ctx3.queriedAt, queriedAt1);
});

test("Request treo: caller nhận RPC_TIMEOUT và HTTP transport nhận abort khi hết deadline", async () => {
  let transportReceivedAbort = false;
  let fetchAborted = false;

  const fakeFetch: typeof fetch = async (_url, init) => {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        transportReceivedAbort = true;
        fetchAborted = init.signal?.aborted ?? false;
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    });
  };

  const client = createFujiRpcClient({ fetchFn: fakeFetch });
  const reader = new OnChainContextReader({ client, timeoutMs: 60 });

  await assert.rejects(
    () => reader.fetchContext(VALID_ADDRESS),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "RPC_TIMEOUT");
      assert.equal(err.message, "Operation timed out within allocated budget");
      return true;
    }
  );

  assert.equal(transportReceivedAbort, true, "HTTP transport must receive abort signal event");
  assert.equal(fetchAborted, true, "Fetch init.signal.aborted must be true");
});

test("Không phát sinh attempt mới sau khi hết deadline", async () => {
  let attempts = 0;
  let virtualTime = 1000;
  const clock = () => new Date(virtualTime);

  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") {
        attempts++;
        // Advance time beyond the 200ms timeout during the first attempt
        virtualTime += 300;
        throw new Error("fetch failed: socket hang up");
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const reader = new OnChainContextReader({ client, timeoutMs: 200, maxRetries: 2, clock });

  await assert.rejects(
    () => reader.fetchContext(VALID_ADDRESS),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "RPC_TIMEOUT");
      return true;
    }
  );

  assert.equal(attempts, 1, "Must not spawn new attempts after deadline has passed");
});

test("Backoff cũng nằm trong tổng ngân sách: thời gian chờ không vượt quá timeoutMs", async () => {
  let attempts = 0;
  let virtualTime = 1000;
  const clock = () => new Date(virtualTime);
  const sleepCalledWith: number[] = [];

  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") {
        attempts++;
        // First attempt takes 80ms of a 150ms budget (leaving 70ms)
        virtualTime += 80;
        throw new Error("fetch failed: socket hang up");
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const reader = new OnChainContextReader({
    client,
    timeoutMs: 150,
    maxRetries: 2,
    clock,
    sleepFn: (ms) => {
      sleepCalledWith.push(ms);
      return Promise.resolve();
    },
  });

  await assert.rejects(
    () => reader.fetchContext(VALID_ADDRESS),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "RPC_TIMEOUT");
      return true;
    }
  );

  assert.equal(attempts, 1);
  assert.equal(sleepCalledWith.length, 0, "Should not sleep when backoff exceeds remaining budget");
});

test("Hai lần fetch đồng thời: timeout của một lần không hủy lần kia", async () => {
  const ADDR_FAST = "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754";
  const ADDR_SLOW = "0x1111111111111111111111111111111111111111";

  const fakeFetch: typeof fetch = async (_url, init) => {
    const bodyStr = String(init?.body || "");
    if (bodyStr.includes(ADDR_FAST.toLowerCase())) {
      // Fast call: succeeds in 20ms
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (bodyStr.includes(ADDR_SLOW.toLowerCase())) {
      // Slow call: hangs until aborted
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
    // eth_chainId
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: toHex(FUJI_CHAIN_ID) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const client = createFujiRpcClient({ fetchFn: fakeFetch });
  const reader = new OnChainContextReader({ client, timeoutMs: 100 });

  const [slowResult, fastResult] = await Promise.allSettled([
    reader.fetchContext(ADDR_SLOW),
    reader.fetchContext(ADDR_FAST),
  ]);

  // Slow call must have timed out
  assert.equal(slowResult.status, "rejected");
  if (slowResult.status === "rejected") {
    assert.ok(slowResult.reason instanceof RpcContextError);
    assert.equal(slowResult.reason.code, "RPC_TIMEOUT");
  }

  // Fast call must have succeeded and NOT been cancelled by the slow call
  assert.equal(fastResult.status, "fulfilled");
  if (fastResult.status === "fulfilled") {
    assert.equal(fastResult.value.status, "available");
    assert.equal(fastResult.value.address.toLowerCase(), ADDR_FAST.toLowerCase());
  }
});

test("Optional call hết thời gian vẫn giữ dữ liệu cốt lõi đã đọc", async () => {
  let virtualTime = 1000;
  const clock = () => new Date(virtualTime);

  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x123456"; // Has bytecode
      if (method === "eth_call") {
        // Optional call for owner hangs and exceeds budget
        virtualTime += 10000; // Exceeds budget
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return null;
    },
  }, { retryCount: 0 });
  const client = createPublicClient({ chain: avalancheFuji, transport: mockTransport });

  const reader = new OnChainContextReader({ client, timeoutMs: 5000, clock });
  const ctx = await reader.fetchContext(VALID_ADDRESS);

  // Core data must be intact!
  assert.equal(ctx.status, "available");
  assert.equal(ctx.isContract, true);
  assert.equal(ctx.bytecodeSize, 3);
  assert.equal(ctx.balanceAvax, "0");
  assert.equal(ctx.owner, null);
  assert.equal(ctx.isPaused, null);
  assert.ok(ctx.warning?.includes("owner() timed out") || ctx.warning?.includes("owner() skipped"));
});

test("Retry đúng giới hạn (maxRetries) và không retry revert", async () => {
  let revertAttempts = 0;
  const revertTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") {
        revertAttempts++;
        throw new Error("execution reverted: contract not found");
      }
      return null;
    },
  }, { retryCount: 0 });
  const clientRevert = createPublicClient({ chain: avalancheFuji, transport: revertTransport });

  const readerRevert = new OnChainContextReader({ client: clientRevert, maxRetries: 2 });
  await assert.rejects(
    () => readerRevert.fetchContext(VALID_ADDRESS),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "REVERT");
      return true;
    }
  );
  assert.equal(revertAttempts, 1, "Revert error must not be retried");

  // Transient error retries exactly maxRetries times (1 initial + maxRetries retries)
  let transientAttempts = 0;
  const transientTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") return toHex(FUJI_CHAIN_ID);
      if (method === "eth_getBalance") {
        transientAttempts++;
        throw new Error("fetch failed: socket hang up");
      }
      return null;
    },
  }, { retryCount: 0 });
  const clientTransient = createPublicClient({ chain: avalancheFuji, transport: transientTransport });

  const readerTransient = new OnChainContextReader({
    client: clientTransient,
    maxRetries: 1, // 1 retry -> 2 total attempts
    sleepFn: () => Promise.resolve(),
  });

  await assert.rejects(
    () => readerTransient.fetchContext(VALID_ADDRESS),
    (err: unknown) => {
      assert.ok(err instanceof RpcContextError);
      assert.equal(err.code, "RPC_ERROR");
      return true;
    }
  );
  assert.equal(transientAttempts, 2, "Transient error with maxRetries=1 must attempt exactly 2 times");
});

test("Optional call treo: caller vẫn nhận context available với balance/bytecode và optional nhận abort", async () => {
  let optionalStarted = false;
  let transportAborted = false;
  let pausedCalled = false;

  const fakeFetch: typeof fetch = async (_url, init) => {
    const bodyStr = String(init?.body || "");
    const bodyObj = JSON.parse(bodyStr);
    const method = bodyObj.method;

    if (method === "eth_chainId") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: bodyObj.id, result: toHex(FUJI_CHAIN_ID) }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "eth_getBalance") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: bodyObj.id, result: "0x1bc16d674ec80000" }), // 2 AVAX
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "eth_getCode") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: bodyObj.id, result: "0x60806040" }), // Non-empty bytecode
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "eth_call") {
      const callData = bodyObj.params?.[0]?.data as string;
      if (callData?.startsWith("0x8da5cb5b")) {
        // owner()
        optionalStarted = true;
        // Hang until abort signal fires
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            transportAborted = true;
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
      }
      if (callData?.startsWith("0x5c975abb")) {
        // paused()
        pausedCalled = true;
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: bodyObj.id, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: bodyObj.id, error: { code: -32601, message: "Method not found" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  };

  const client = createFujiRpcClient({ fetchFn: fakeFetch });
  // Real timer with short budget (70ms)
  const reader = new OnChainContextReader({ client, timeoutMs: 70 });

  const ctx = await reader.fetchContext(VALID_ADDRESS);

  assert.equal(optionalStarted, true, "owner() should have been called");
  assert.equal(transportAborted, true, "hanging HTTP transport must have received abort");
  assert.equal(pausedCalled, false, "paused() must not be called after deadline has passed");

  assert.equal(ctx.status, "available");
  assert.equal(ctx.isContract, true);
  assert.equal(ctx.bytecodeSize, 4);
  assert.equal(ctx.balanceAvax, "2");
  assert.equal(ctx.owner, null);
  assert.equal(ctx.isPaused, null);
  assert.ok(ctx.warning?.includes("owner() timed out") || ctx.warning?.includes("owner() skipped"));
});
