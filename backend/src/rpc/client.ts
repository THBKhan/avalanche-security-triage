/**
 * Avalanche Fuji RPC Public Client
 * Read-only client for Avalanche Fuji Testnet (Chain ID: 43113).
 * Does not create wallets, signers, or private-key accounts.
 */

import { createPublicClient, http, PublicClient, Transport } from "viem";
import { avalancheFuji } from "viem/chains";
import { getActiveScope } from "./scope";

export interface FujiClientOptions {
  rpcUrl?: string;
  transport?: Transport;
  fetchFn?: typeof fetch;
}

/**
 * Creates a read-only viem PublicClient for Avalanche Fuji.
 * Defaults to retryCount: 0 to prevent implicit retries beneath the application layer.
 * Integrates real deadline cancellation at the HTTP transport layer via fetch signal.
 */
export function createFujiRpcClient(options: FujiClientOptions = {}): PublicClient {
  const rpcUrl = options.rpcUrl || "https://api.avax-test.network/ext/bc/C/rpc";
  const userFetchFn = options.fetchFn || globalThis.fetch;

  const transport =
    options.transport ||
    http(rpcUrl, {
      retryCount: 0,
      fetchFn: async (input, init) => {
        const scope = getActiveScope();
        if (scope) {
          if (scope.isCancelled || scope.controller.signal.aborted) {
            throw new DOMException("The operation was aborted", "AbortError");
          }
          const signal = init?.signal
            ? AbortSignal.any([init.signal, scope.controller.signal])
            : scope.controller.signal;

          return userFetchFn(input, { ...init, signal });
        }
        return userFetchFn(input, init);
      },
    });

  return createPublicClient({
    chain: avalancheFuji,
    transport,
  });
}
