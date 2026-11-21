/**
 * Backend Configuration Module
 * Loads and validates environment variables safely without leaking secrets in errors.
 */

import dotenv from "dotenv";
import path from "node:path";
import { getAddress, isAddress, zeroAddress } from "viem";

dotenv.config();

export type LlmProvider = "gemini";

export interface AppConfig {
  port: number;
  fujiRpcUrl: string;
  corsOrigin: string | string[];
  llmProvider?: LlmProvider;
  llmModel?: string;
  llmApiKey?: string;
  registryAddress?: `0x${string}`;
  enableFujiSmokeTest?: boolean;
  snapshotDirectory?: string;
}

const VALID_LLM_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/**
 * Validate port number (strict positive integer in range 1 - 65535).
 * Rejects floating numbers, exponent notation, trailing characters, and whitespace-only.
 */
function parsePort(val: string | undefined, defaultPort = 3001): number {
  if (val === undefined || val === null) return defaultPort;
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid PORT configuration: must be a valid TCP port number (1-65535)");
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Invalid PORT configuration: must be a valid TCP port number (1-65535)");
  }
  const parsed = Number(trimmed);
  if (parsed < 1 || parsed > 65535) {
    throw new Error("Invalid PORT configuration: must be a valid TCP port number (1-65535)");
  }
  return parsed;
}

/**
 * Validate HTTP/HTTPS URL.
 */
function parseUrl(val: string | undefined, defaultUrl: string, varName: string): string {
  const target = val || defaultUrl;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`Invalid ${varName}: must be a well-formed HTTP/HTTPS URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${varName}: protocol must be http or https`);
  }
  return target;
}

/**
 * Validate optional LLM provider identifier.
 */
function parseLlmProvider(val: string | undefined): LlmProvider | undefined {
  if (val === undefined || val === null) return undefined;
  const trimmed = val.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  if (trimmed === "gemini") return "gemini";
  throw new Error("Invalid LLM_PROVIDER configuration: supported provider is 'gemini'");
}

/**
 * Validate optional LLM model identifier (no hardcoded default model).
 */
function parseLlmModel(val: string | undefined): string | undefined {
  if (val === undefined || val === null) return undefined;
  const trimmed = val.trim();
  if (trimmed.length === 0) return undefined;
  if (!VALID_LLM_MODEL_PATTERN.test(trimmed)) {
    throw new Error("Invalid LLM_MODEL configuration: must be a valid model identifier");
  }
  return trimmed;
}

/**
 * Load and validate application configuration.
 * Does not leak secrets in error messages.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = parsePort(env.PORT, 3001);
  const fujiRpcUrl = parseUrl(
    env.FUJI_RPC_URL,
    "https://api.avax-test.network/ext/bc/C/rpc",
    "FUJI_RPC_URL"
  );

  const rawCors = env.CORS_ORIGIN || "http://localhost:3000";
  const corsOrigin = rawCors.includes(",")
    ? rawCors.split(",").map((o) => o.trim())
    : rawCors.trim();

  const llmProvider = parseLlmProvider(env.LLM_PROVIDER);
  const llmModel = parseLlmModel(env.LLM_MODEL);
  const llmApiKey =
    env.LLM_API_KEY && env.LLM_API_KEY.trim().length > 0
      ? env.LLM_API_KEY.trim()
      : undefined;
  const registry = env.REGISTRY_ADDRESS?.trim();
  if (registry && (!isAddress(registry) || registry.toLowerCase() === zeroAddress)) {
    throw new Error("Invalid REGISTRY_ADDRESS configuration");
  }

  return {
    port,
    fujiRpcUrl,
    corsOrigin,
    llmProvider,
    llmModel,
    llmApiKey,
    ...(registry ? { registryAddress: getAddress(registry) } : {}),
    ...(env.ENABLE_FUJI_SMOKE_TEST?.trim() === "true" ? { enableFujiSmokeTest: true } : {}),
    ...(env.REPORT_SNAPSHOT_DIR?.trim()
      ? { snapshotDirectory: path.resolve(env.REPORT_SNAPSHOT_DIR.trim()) }
      : {}),
  };
}
