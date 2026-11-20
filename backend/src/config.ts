/**
 * Backend Configuration Module
 * Loads and validates environment variables safely without leaking secrets in errors.
 */

import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  port: number;
  fujiRpcUrl: string;
  corsOrigin: string | string[];
  llmApiKey?: string;
}

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

  const llmApiKey = env.LLM_API_KEY && env.LLM_API_KEY.trim().length > 0
    ? env.LLM_API_KEY.trim()
    : undefined;

  return {
    port,
    fujiRpcUrl,
    corsOrigin,
    llmApiKey,
  };
}
