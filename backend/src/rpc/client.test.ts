import test from "node:test";
import assert from "node:assert/strict";
import { custom } from "viem";
import { createFujiRpcClient } from "./client";

test("createFujiRpcClient creates read-only client for Avalanche Fuji (Chain ID 43113)", () => {
  const client = createFujiRpcClient({
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  });

  assert.equal(client.chain?.id, 43113);
  assert.equal(client.chain?.name, "Avalanche Fuji");
  // Ensure it is strictly a public read-only client (no wallet account attached)
  assert.equal(client.account, undefined);
});

test("createFujiRpcClient allows injecting custom mock transport without network calls", async () => {
  // Create an in-memory custom transport that responds with mock data without network
  const mockTransport = custom({
    async request({ method }) {
      if (method === "eth_chainId") {
        return "0xa869"; // 43113 in hex
      }
      return null;
    },
  });

  const client = createFujiRpcClient({
    transport: mockTransport,
  });

  assert.equal(client.chain?.id, 43113);
  const chainId = await client.getChainId();
  assert.equal(chainId, 43113);
});
