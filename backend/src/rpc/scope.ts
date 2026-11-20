/**
 * Per-request execution scope for On-Chain Context Reader.
 * Provides thread-safe / call-safe async isolation for AbortController,
 * budget deadlines, and cancellation signals.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestScope {
  controller: AbortController;
  deadlineMs: number;
  isCancelled: boolean;
}

export const activeScopeStorage = new AsyncLocalStorage<RequestScope>();

export function getActiveScope(): RequestScope | undefined {
  return activeScopeStorage.getStore();
}

export function getActiveAbortSignal(): AbortSignal | undefined {
  return activeScopeStorage.getStore()?.controller.signal;
}
