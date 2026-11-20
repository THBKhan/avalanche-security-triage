/**
 * Avalanche Fuji On-Chain Context Fetcher
 * Reads native AVAX balance, bytecode, and optional owner/paused states safely.
 * Includes reader-scoped cache isolation, exponential backoff, budget enforcement,
 * real HTTP transport deadline cancellation, and zero credential leakage.
 */

import {
  PublicClient,
  formatEther,
  getAddress,
  isAddress,
  parseAbi,
} from "viem";
import { createFujiRpcClient } from "./client";
import {
  RequestScope,
  activeScopeStorage,
  getActiveAbortSignal,
  getActiveScope,
} from "./scope";

export {
  RequestScope,
  activeScopeStorage,
  getActiveAbortSignal,
  getActiveScope,
};

export const FUJI_CHAIN_ID = 43113;
export const FUJI_NETWORK_NAME = "Avalanche Fuji Testnet" as const;

export const MINIMAL_OWNER_ABI = parseAbi([
  "function owner() external view returns (address)",
]);

export const MINIMAL_PAUSED_ABI = parseAbi([
  "function paused() external view returns (bool)",
]);

export type RpcErrorCode =
  | "INVALID_ADDRESS"
  | "WRONG_NETWORK"
  | "RPC_TIMEOUT"
  | "RATE_LIMITED"
  | "RPC_ERROR"
  | "REVERT"
  | "INVALID_INPUT";

export class RpcContextError extends Error {
  readonly code: RpcErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: RpcErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RpcContextError";
    this.code = code;
    this.details = details;
  }
}

export interface TargetContractContext {
  address: string;
  network: typeof FUJI_NETWORK_NAME;
  chainId: typeof FUJI_CHAIN_ID;
  balanceAvax: string;
  isContract: boolean;
  bytecodeSize: number;
  owner?: string | null;
  isPaused?: boolean | null;
  queriedAt: string;
  status: "available";
  warning?: string;
}

export interface FetchContextOptions {
  client?: PublicClient;
  rpcUrl?: string;
  timeoutMs?: number; // Total budget for the entire operation (default: 10_000ms)
  now?: () => Date;   // Deterministic clock injection
  clock?: () => Date; // Alias for now
  bypassCache?: boolean;
  maxRetries?: number; // Maximum retry attempts for transient errors (0..2, corresponding to 1..3 attempts)
  sleepFn?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  data: TargetContractContext;
  cachedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;

/**
 * Check if an error represents a contract execution revert.
 */
function isContractRevertError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes("revert") ||
    msg.includes("execution reverted") ||
    msg.includes("out of gas") ||
    msg.includes("invalid opcode")
  );
}

/**
 * Check if an error represents upstream rate limiting (HTTP 429).
 */
function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");
}

/**
 * Check if an RPC error is transient and eligible for retry.
 * Aborted / deadline errors are strictly non-transient.
 */
export function isTransientRpcError(error: unknown): boolean {
  if (!error) return false;
  if (isContractRevertError(error)) {
    return false;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))) {
    return false;
  }
  if (isRateLimitError(error)) {
    return true;
  }

  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("timeout") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

/**
 * Wrap a promise with timeout deadline, aborting controller on expiration and cleaning up timer.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMsg: string,
  controller?: AbortController
): Promise<T> {
  let timerId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
      reject(new RpcContextError("RPC_TIMEOUT", timeoutMsg));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  });
}

/**
 * Reader Class with Isolated In-Memory Cache and Configured Client.
 *
 * NOTE:
 * - Chain ID is verified ONCE per reader instance during its first operation and cached.
 *   Subsequent queries reuse the verified chain ID.
 * - Injected `client` without abort signal support will rely on promise-racing; underlying
 *   in-flight network requests cannot be aborted without HTTP transport signal support.
 */
export class OnChainContextReader {
  private readonly client: PublicClient;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly clock: () => Date;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxCacheEntries: number;
  private readonly cacheTtlMs: number;
  private verifiedChainId: number | null = null;

  constructor(options: FetchContextOptions = {}) {
    if (options.timeoutMs !== undefined) {
      if (
        typeof options.timeoutMs !== "number" ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs <= 0
      ) {
        throw new RpcContextError("INVALID_INPUT", "timeoutMs must be a positive finite number");
      }
    }

    if (options.maxRetries !== undefined) {
      if (
        typeof options.maxRetries !== "number" ||
        !Number.isInteger(options.maxRetries) ||
        options.maxRetries < 0 ||
        options.maxRetries > 2
      ) {
        throw new RpcContextError(
          "INVALID_INPUT",
          "maxRetries must be an integer between 0 and 2 (max 3 total attempts)"
        );
      }
    }

    this.client = options.client || createFujiRpcClient({ rpcUrl: options.rpcUrl });
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.clock = options.clock || options.now || (() => new Date());
    this.sleepFn = options.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES;
    this.cacheTtlMs = DEFAULT_CACHE_TTL_MS;
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public getCacheSize(): number {
    return this.cache.size;
  }

  private writeCache(key: string, data: TargetContractContext, cachedAt: number): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, {
      data: JSON.parse(JSON.stringify(data)),
      cachedAt,
    });
  }

  /**
   * Sleep helper with abort awareness. Wakes up immediately and throws RPC_TIMEOUT if signal aborts.
   */
  private async sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return this.sleepFn(ms);
    }
    if (signal.aborted) {
      throw new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget");
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          reject(new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget"));
        }
      };

      signal.addEventListener("abort", onAbort, { once: true });

      this.sleepFn(ms).then(
        () => {
          if (!settled) {
            settled = true;
            signal.removeEventListener("abort", onAbort);
            resolve();
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        }
      );
    });
  }

  /**
   * Execute an action within the remaining time budget, retrying transient errors with exponential backoff.
   * Cancels in-flight requests immediately upon deadline expiration.
   */
  private async executeWithBudget<T>(
    action: () => Promise<T>,
    opName: string,
    startTime: number,
    budgetMs?: number,
    customController?: AbortController
  ): Promise<T> {
    const scope = getActiveScope();
    const controller = customController || scope?.controller;
    const allocatedBudget = budgetMs ?? this.timeoutMs;
    let attempt = 0;

    while (true) {
      attempt++;
      const elapsed = this.clock().getTime() - startTime;
      const remaining = allocatedBudget - elapsed;

      if (remaining <= 0 || controller?.signal.aborted || scope?.isCancelled) {
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        throw new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget", {
          opName,
          attempt,
        });
      }

      try {
        return await withTimeout(
          action(),
          remaining,
          "Operation timed out within allocated budget",
          controller
        );
      } catch (err) {
        if (err instanceof RpcContextError && err.code === "RPC_TIMEOUT") {
          throw err;
        }

        const isAbort =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && (err.name === "AbortError" || err.message.toLowerCase().includes("abort"))) ||
          ((err as any)?.cause instanceof Error && ((err as any).cause.name === "AbortError" || (err as any).cause.message.toLowerCase().includes("abort"))) ||
          controller?.signal.aborted ||
          scope?.isCancelled;

        if (isAbort) {
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
          throw new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget", {
            opName,
            attempt,
          });
        }

        if (isContractRevertError(err)) {
          throw new RpcContextError("REVERT", "Contract execution reverted", {
            opName,
            attempt,
          });
        }

        const isTransient = isTransientRpcError(err);
        if (!isTransient || attempt > this.maxRetries) {
          if (isRateLimitError(err)) {
            throw new RpcContextError("RATE_LIMITED", "RPC request rate limited by upstream provider", {
              opName,
              attempt,
            });
          }
          throw new RpcContextError("RPC_ERROR", "Upstream RPC query failed during operation", {
            opName,
            attempt,
          });
        }

        // Exponential backoff: min(100 * 2^(attempt-1), 1000) ms
        const backoffMs = Math.min(100 * Math.pow(2, attempt - 1), 1000);
        const currentElapsed = this.clock().getTime() - startTime;
        const currentRemaining = allocatedBudget - currentElapsed;

        if (currentRemaining <= backoffMs) {
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
          throw new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget", {
            opName,
            attempt,
          });
        }

        await this.sleepWithAbort(backoffMs, controller?.signal);
      }
    }
  }

  /**
   * Internal implementation of context fetch within an active RequestScope.
   */
  private async executeFetchContext(
    normalizedAddress: `0x${string}`,
    startTime: number,
    scope: RequestScope,
    state: {
      hasCoreData: boolean;
      isCompleted: boolean;
      coreResult?: {
        balanceAvax: string;
        bytecodeSize: number;
        isContract: boolean;
        queriedAt: string;
      };
      owner: string | null;
      isPaused: boolean | null;
      warnings: string[];
      cacheKey?: string;
    },
    clearTimer: () => void,
    overrideOptions?: { bypassCache?: boolean }
  ): Promise<TargetContractContext> {
    // 1. Verify remote chain ID first (ensures no cross-chain cache leaks)
    // NOTE: Verified once per reader instance; subsequent queries reuse verifiedChainId.
    if (this.verifiedChainId === null) {
      const remoteChainId = await this.executeWithBudget(
        async () => Number(await this.client.getChainId()),
        "eth_chainId",
        startTime
      );

      if (remoteChainId !== FUJI_CHAIN_ID) {
        throw new RpcContextError(
          "WRONG_NETWORK",
          "RPC endpoint is not connected to Avalanche Fuji Testnet (Chain ID 43113)",
          { expectedChainId: FUJI_CHAIN_ID, actualChainId: remoteChainId }
        );
      }
      this.verifiedChainId = remoteChainId;
    }

    // 2. Cache lookup (isolated to this verified client/chain)
    const cacheKey = `${this.verifiedChainId}:${normalizedAddress.toLowerCase()}`;
    state.cacheKey = cacheKey;
    const currentNow = this.clock();
    const currentNowMs = currentNow.getTime();

    if (!overrideOptions?.bypassCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        if (currentNowMs - cached.cachedAt < this.cacheTtlMs) {
          clearTimer();
          state.isCompleted = true;
          return JSON.parse(JSON.stringify(cached.data));
        }
        this.cache.delete(cacheKey);
      }
    }

    // 3. Query native balance (exact string, never convert via Number(wei))
    const balanceWei = await this.executeWithBudget(
      async () => this.client.getBalance({ address: normalizedAddress }),
      "eth_getBalance",
      startTime
    );
    const balanceAvax = formatEther(balanceWei);

    // 4. Query bytecode
    const bytecode = await this.executeWithBudget(
      async () => this.client.getBytecode({ address: normalizedAddress }),
      "eth_getCode",
      startTime
    );

    const hasCode = typeof bytecode === "string" && bytecode.length > 2 && bytecode !== "0x";
    const bytecodeSize = hasCode ? (bytecode.length - 2) / 2 : 0;
    const isContract = hasCode;

    // Record core data state immediately upon successful completion of core queries
    state.hasCoreData = true;
    state.coreResult = {
      balanceAvax,
      bytecodeSize,
      isContract,
      queriedAt: currentNow.toISOString(),
    };

    // 5. Optional calls: only attempted if code is present.
    // Core data is already read. If optional calls time out or fail, core data is preserved.
    let owner: string | null = null;
    let isPaused: boolean | null = null;
    const warnings: string[] = [];

    if (isContract) {
      const remainingBeforeOwner = scope.deadlineMs - this.clock().getTime();
      if (remainingBeforeOwner <= 0 || scope.isCancelled || scope.controller.signal.aborted) {
        warnings.push("owner() skipped due to exhausted time budget");
        state.warnings.push("owner() skipped due to exhausted time budget");
      } else {
        const ownerController = new AbortController();
        const unbindOwner = () => {
          if (!ownerController.signal.aborted) ownerController.abort();
        };
        scope.controller.signal.addEventListener("abort", unbindOwner, { once: true });

        try {
          const ownerRes = await this.executeWithBudget(
            async () =>
              this.client.readContract({
                address: normalizedAddress,
                abi: MINIMAL_OWNER_ABI,
                functionName: "owner",
              }),
            "owner()",
            startTime,
            this.timeoutMs,
            ownerController
          );
          if (typeof ownerRes === "string" && isAddress(ownerRes, { strict: false })) {
            owner = getAddress(ownerRes);
            state.owner = owner;
          }
        } catch (err) {
          owner = null;
          state.owner = null;
          if (err instanceof RpcContextError && err.code === "RPC_TIMEOUT") {
            warnings.push("owner() timed out");
            state.warnings.push("owner() timed out");
          } else if (err instanceof RpcContextError && err.code === "RATE_LIMITED") {
            warnings.push("owner() rate limited");
            state.warnings.push("owner() rate limited");
          } else if (err instanceof RpcContextError && err.code === "REVERT") {
            warnings.push("owner() not supported or execution reverted");
            state.warnings.push("owner() not supported or execution reverted");
          } else if (isContractRevertError(err)) {
            warnings.push("owner() not supported or execution reverted");
            state.warnings.push("owner() not supported or execution reverted");
          } else {
            warnings.push("owner() transport error");
            state.warnings.push("owner() transport error");
          }
        } finally {
          scope.controller.signal.removeEventListener("abort", unbindOwner);
        }
      }

      const remainingBeforePaused = scope.deadlineMs - this.clock().getTime();
      if (remainingBeforePaused <= 0 || scope.isCancelled || scope.controller.signal.aborted) {
        warnings.push("paused() skipped due to exhausted time budget");
        state.warnings.push("paused() skipped due to exhausted time budget");
      } else {
        const pausedController = new AbortController();
        const unbindPaused = () => {
          if (!pausedController.signal.aborted) pausedController.abort();
        };
        scope.controller.signal.addEventListener("abort", unbindPaused, { once: true });

        try {
          const pausedRes = await this.executeWithBudget(
            async () =>
              this.client.readContract({
                address: normalizedAddress,
                abi: MINIMAL_PAUSED_ABI,
                functionName: "paused",
              }),
            "paused()",
            startTime,
            this.timeoutMs,
            pausedController
          );
          if (typeof pausedRes === "boolean") {
            isPaused = pausedRes;
            state.isPaused = isPaused;
          }
        } catch (err) {
          isPaused = null;
          state.isPaused = null;
          if (err instanceof RpcContextError && err.code === "RPC_TIMEOUT") {
            warnings.push("paused() timed out");
            state.warnings.push("paused() timed out");
          } else if (err instanceof RpcContextError && err.code === "RATE_LIMITED") {
            warnings.push("paused() rate limited");
            state.warnings.push("paused() rate limited");
          } else if (err instanceof RpcContextError && err.code === "REVERT") {
            warnings.push("paused() not supported or execution reverted");
            state.warnings.push("paused() not supported or execution reverted");
          } else if (isContractRevertError(err)) {
            warnings.push("paused() not supported or execution reverted");
            state.warnings.push("paused() not supported or execution reverted");
          } else {
            warnings.push("paused() transport error");
            state.warnings.push("paused() transport error");
          }
        } finally {
          scope.controller.signal.removeEventListener("abort", unbindPaused);
        }
      }
    }

    // 6. Construct final context object
    const result: TargetContractContext = {
      address: normalizedAddress,
      network: FUJI_NETWORK_NAME,
      chainId: FUJI_CHAIN_ID,
      balanceAvax,
      isContract,
      bytecodeSize,
      owner,
      isPaused,
      queriedAt: currentNow.toISOString(),
      status: "available",
    };

    if (warnings.length > 0) {
      result.warning = warnings.join("; ");
    }

    // 7. Check if already completed by deadline timer
    if (state.isCompleted) {
      return JSON.parse(JSON.stringify(result));
    }

    state.isCompleted = true;
    clearTimer();

    // 8. Cache result
    this.writeCache(cacheKey, result, currentNowMs);

    return JSON.parse(JSON.stringify(result));
  }

  /**
   * Fetch live on-chain state for an address using this reader's client and isolated cache.
   * Allocates an independent AbortController and deadline timer per invocation.
   */
  public async fetchContext(
    address: string,
    overrideOptions?: { bypassCache?: boolean }
  ): Promise<TargetContractContext> {
    // 1. Validate address format BEFORE any network/RPC call
    const trimmed = typeof address === "string" ? address.trim() : "";
    if (
      !trimmed ||
      !isAddress(trimmed, { strict: false }) ||
      trimmed.toLowerCase() === "0x0000000000000000000000000000000000000000"
    ) {
      throw new RpcContextError(
        "INVALID_ADDRESS",
        "Invalid Avalanche Fuji contract address format"
      );
    }

    const normalizedAddress = getAddress(trimmed);
    // Explicit invariant: output address must equal input address after lowercase
    if (normalizedAddress.toLowerCase() !== trimmed.toLowerCase()) {
      throw new Error("Address normalization invariant violated");
    }

    const startTime = this.clock().getTime();
    const deadlineMs = startTime + this.timeoutMs;
    const controller = new AbortController();
    const scope: RequestScope = {
      controller,
      deadlineMs,
      isCancelled: false,
    };

    const state: {
      hasCoreData: boolean;
      isCompleted: boolean;
      coreResult?: {
        balanceAvax: string;
        bytecodeSize: number;
        isContract: boolean;
        queriedAt: string;
      };
      owner: string | null;
      isPaused: boolean | null;
      warnings: string[];
      cacheKey?: string;
    } = {
      hasCoreData: false,
      isCompleted: false,
      owner: null,
      isPaused: null,
      warnings: [],
    };

    let deadlineTimer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<TargetContractContext>((resolve, reject) => {
      const remainingMs = deadlineMs - this.clock().getTime();

      const onDeadline = () => {
        scope.isCancelled = true;
        controller.abort();

        if (state.isCompleted) return;

        if (!state.hasCoreData || !state.coreResult) {
          state.isCompleted = true;
          reject(new RpcContextError("RPC_TIMEOUT", "Operation timed out within allocated budget"));
          return;
        }

        // Core data is already available! Finalize context with warnings for unread optional calls.
        state.isCompleted = true;
        const warnings = [...state.warnings];
        if (state.coreResult.isContract) {
          if (state.owner === null && !warnings.some((w) => w.includes("owner()"))) {
            warnings.push("owner() timed out");
          }
          if (state.isPaused === null && !warnings.some((w) => w.includes("paused()"))) {
            warnings.push("paused() skipped due to exhausted time budget");
          }
        }

        const fallbackResult: TargetContractContext = {
          address: normalizedAddress,
          network: FUJI_NETWORK_NAME,
          chainId: FUJI_CHAIN_ID,
          balanceAvax: state.coreResult.balanceAvax,
          isContract: state.coreResult.isContract,
          bytecodeSize: state.coreResult.bytecodeSize,
          owner: state.owner,
          isPaused: state.isPaused,
          queriedAt: state.coreResult.queriedAt,
          status: "available",
        };
        if (warnings.length > 0) {
          fallbackResult.warning = warnings.join("; ");
        }

        if (state.cacheKey) {
          this.writeCache(state.cacheKey, fallbackResult, this.clock().getTime());
        }

        resolve(JSON.parse(JSON.stringify(fallbackResult)));
      };

      if (remainingMs <= 0) {
        onDeadline();
        return;
      }

      deadlineTimer = setTimeout(onDeadline, remainingMs);
    });

    try {
      return await activeScopeStorage.run(scope, async () => {
        return await Promise.race([
          this.executeFetchContext(
            normalizedAddress,
            startTime,
            scope,
            state,
            () => {
              if (deadlineTimer !== null) {
                clearTimeout(deadlineTimer);
                deadlineTimer = null;
              }
            },
            overrideOptions
          ),
          timeoutPromise,
        ]);
      });
    } finally {
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
      }
    }
  }
}

// Default reader instance for application-wide default client
let defaultReader: OnChainContextReader | null = null;

function getDefaultReader(): OnChainContextReader {
  if (!defaultReader) {
    defaultReader = new OnChainContextReader();
  }
  return defaultReader;
}

/**
 * Clear cache across default and custom readers (primarily for tests)
 */
export function clearRpcContextCache(): void {
  if (defaultReader) {
    defaultReader.clearCache();
  }
}

/**
 * Functional wrapper for fetching on-chain context.
 *
 * NOTE:
 * Calling `fetchOnChainContext` with custom options instantiates a new reader per call.
 * When wiring to the HTTP API, instantiate and reuse a shared `OnChainContextReader`
 * instance across requests to allow the cache to function effectively.
 */
export async function fetchOnChainContext(
  address: string,
  options: FetchContextOptions = {}
): Promise<TargetContractContext> {
  // If custom client, timeout, or rpcUrl is supplied, use an isolated reader
  if (
    options.client ||
    options.rpcUrl ||
    options.timeoutMs !== undefined ||
    options.maxRetries !== undefined ||
    options.clock ||
    options.now ||
    options.sleepFn
  ) {
    const reader = new OnChainContextReader(options);
    return reader.fetchContext(address, { bypassCache: options.bypassCache });
  }

  return getDefaultReader().fetchContext(address, { bypassCache: options.bypassCache });
}
