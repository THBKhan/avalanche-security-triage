import assert from "node:assert/strict";
import test from "node:test";
import { checkAttestationReceipt, prepareAttestation, submitAttestation } from "./public/wallet.mjs";

const target = "0x" + "11".repeat(20);
const registry = "0x" + "22".repeat(20);
const account = "0x" + "33".repeat(20);
const reportHash = "0x" + "44".repeat(32);
const txHash = "0x" + "55".repeat(32);
const word = (value) => value.padStart(64, "0");
const snapshot = {
  report: { targetContract: { address: target }, summary: { priorityScore: 87 } },
  attestation: { status: "READY_TO_ATTEST", registryAddress: registry, reportHash, ipfsUri: "" },
};
const intent = prepareAttestation(snapshot);

test("wallet request uses the viewed hash, integer score, and fixed empty IPFS URI", async () => {
  const calls = [];
  const provider = { request: async (call) => {
    calls.push(call);
    if (call.method === "eth_requestAccounts") return [account];
    if (call.method === "eth_chainId") return "0xa869";
    if (call.method === "eth_getCode") return "0x6001";
    if (call.method === "eth_sendTransaction") return txHash;
    throw new Error("Unexpected RPC");
  } };
  assert.deepEqual(await submitAttestation(provider, intent), { account, txHash });
  assert.deepEqual(calls.at(-1).params, [{
    from: account, to: registry, value: "0x0",
    data: "0x4fd9d719" + word(target.slice(2)) + reportHash.slice(2) + word("57") + word("80") + word("0"),
  }]);
  assert.equal(prepareAttestation({ ...snapshot, attestation: { status: "DISABLED" } }), null);
});

test("wrong chain and absent registry code cannot reach the wallet send call", async () => {
  for (const chainId of ["0x1", "0xa869"]) {
    let sends = 0;
    const provider = { request: async ({ method }) => {
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return chainId;
      if (method === "eth_getCode") return "0x";
      if (method === "eth_sendTransaction") sends++;
    } };
    await assert.rejects(() => submitAttestation(provider, intent));
    assert.equal(sends, 0);
  }
});

test("confirmation requires a successful receipt and an event matching the snapshot", async () => {
  let receipt = null;
  const provider = { request: async ({ method }) => method === "eth_chainId" ? "0xa869" : receipt };
  const submission = { txHash, account };
  assert.equal(await checkAttestationReceipt(provider, intent, submission), "pending");
  receipt = { status: "0x1", logs: [] };
  assert.equal(await checkAttestationReceipt(provider, intent, submission), "failed");
  receipt.logs.push({
    address: registry,
    topics: [
      "0x4511436f903ee89a426cb6cd458019f3996b82791afbdfb955afa27e8cc75377",
      "0x" + word("0"), "0x" + word(target.slice(2)), "0x" + word(account.slice(2)),
    ],
    data: reportHash + word("57") + word("80") + word("0") + word("0"),
  });
  assert.equal(await checkAttestationReceipt(provider, intent, submission), "confirmed");
});
