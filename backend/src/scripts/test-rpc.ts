/**
 * CLI Test Script for Avalanche Fuji On-Chain Context Fetcher
 * Strictly read-only; no private keys, signers, or transactions.
 * Usage: npx tsx src/scripts/test-rpc.ts <contractAddress>
 */

import { loadConfig } from "../config";
import { fetchOnChainContext, RpcContextError } from "../rpc/context";

/**
 * Mask URL to strictly origin only (strip credentials, path, query parameters)
 */
function getSafeEndpointLabel(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "custom-rpc-endpoint";
  }
}

async function main() {
  const address = process.argv[2];

  if (!address) {
    console.error("Usage: npx tsx src/scripts/test-rpc.ts <contractAddress>");
    console.error("Example: npx tsx src/scripts/test-rpc.ts 0x5462D6Bcf9E7C030364d276d493a7F9D0388d754");
    process.exit(1);
  }

  const config = loadConfig();
  console.log(`Connecting to Avalanche Fuji RPC (${getSafeEndpointLabel(config.fujiRpcUrl)})...`);
  console.log(`Target Address: ${address}\n`);

  try {
    const context = await fetchOnChainContext(address, {
      rpcUrl: config.fujiRpcUrl,
      timeoutMs: 10_000,
    });

    // Programmatic verification of input vs output address invariant
    if (context.address.toLowerCase() !== address.trim().toLowerCase()) {
      throw new Error(`Address invariant mismatch: input ${address.trim().toLowerCase()} !== output ${context.address.toLowerCase()}`);
    }

    console.log("=== ON-CHAIN CONTEXT (LIVE RESULT) ===");
    console.log(`Address:       ${context.address}`);
    console.log(`Address Invariant: MATCHED (normalized lowercase equals input lowercase)`);
    console.log(`Network:       ${context.network} (Chain ID: ${context.chainId})`);
    console.log(`Native Balance:${context.balanceAvax} AVAX`);
    console.log(`Is Contract:   ${context.isContract}`);
    console.log(`Bytecode Size: ${context.bytecodeSize} bytes`);

    if (context.isContract) {
      console.log(`Owner:         ${context.owner ?? "null (not implemented/reverted)"}`);
      console.log(`Paused:        ${context.isPaused ?? "null (not implemented/reverted)"}`);
    } else {
      console.log(`Owner:         skipped (not a contract)`);
      console.log(`Paused:        skipped (not a contract)`);
    }

    console.log(`Queried At:    ${context.queriedAt}`);
    if (context.warning) {
      console.log(`Warning:       ${context.warning}`);
    }
    console.log("======================================");
  } catch (err: unknown) {
    if (err instanceof RpcContextError) {
      console.error(`\n❌ RPC Context Error [${err.code}]: ${err.message}`);
      if (err.details) {
        console.error("Details:", JSON.stringify(err.details, null, 2));
      }
    } else {
      // Safe generic message, never print raw provider payload or secret
      console.error("\n❌ Unexpected execution error occurred while querying on-chain context");
    }
    process.exit(1);
  }
}

main();
