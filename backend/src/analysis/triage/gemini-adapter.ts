/**
 * Google Gemini REST Adapter for Candidate Triage Review
 * Implements LlmAdapter using the official Gemini generateContent REST API.
 *
 * Security & Resilience Boundaries:
 * - Uses fixed HTTPS Google Gemini endpoint only (no configurable base URL in production).
 * - Uses redirect: "error" to prevent credential leakage or SSRF via HTTP redirects.
 * - Requires explicit model identifier (no hardcoded default model).
 * - Sends API key via x-goog-api-key header (never in URL query string).
 * - Places trusted system instructions in systemInstruction and untrusted payload in contents.
 * - Requests JSON output via generationConfig.responseMimeType = "application/json".
 * - Ignores model reasoning parts marked with thought: true when extracting final JSON.
 * - Does not enable tools, function calling, or code execution.
 * - Enforces HTTP timeout via AbortSignal and bounded response byte reading.
 * - Does not perform automatic retries.
 * - Never echoes API keys, URLs, prompts, source code, or raw provider error bodies.
 */

import { AppConfig } from "../../config";
import { LlmAdapter, LlmReviewPrompt } from "./adapter";
import { TriageServiceError } from "./types";

export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_TIMEOUT_MS = 20_000;
export const DEFAULT_GEMINI_MAX_RESPONSE_BYTES = 200_000;

const VALID_MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "MALFORMED_FUNCTION_CALL",
  "LANGUAGE",
]);

export interface GeminiAdapterOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchFn?: typeof fetch;
}

function validatePositiveInteger(
  value: number,
  min: number,
  max: number,
  fieldName: string
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TriageServiceError(
      "LLM_ADAPTER_NOT_CONFIGURED",
      `Invalid ${fieldName} configuration for Gemini adapter.`
    );
  }
  return value;
}

/**
 * Read a Response body as UTF-8 text while enforcing a strict maximum byte limit
 * and respecting the active AbortSignal.
 */
async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  controller: AbortController
): Promise<string> {
  const contentLengthHeader = response.headers?.get?.("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader.trim());
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel?.().catch(() => {});
      controller.abort();
      throw new TriageServiceError(
        "OUTPUT_TOO_LARGE",
        "LLM provider response exceeded maximum allowed size."
      );
    }
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        if (controller.signal.aborted) {
          await reader.cancel().catch(() => {});
          throw new TriageServiceError("LLM_TIMEOUT", "LLM provider request timed out.");
        }

        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => {});
            controller.abort();
            throw new TriageServiceError(
              "OUTPUT_TOO_LARGE",
              "LLM provider response exceeded maximum allowed size."
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, totalBytes).toString("utf8");
  }

  // Fallback for minimal mock Response implementations without a ReadableStream body
  const text = await response.text();
  if (controller.signal.aborted) {
    throw new TriageServiceError("LLM_TIMEOUT", "LLM provider request timed out.");
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new TriageServiceError(
      "OUTPUT_TOO_LARGE",
      "LLM provider response exceeded maximum allowed size."
    );
  }
  return text;
}

/**
 * Extract the final model text payload from a Gemini generateContent JSON response envelope.
 * Skips any reasoning parts where `thought === true`.
 */
function extractGeminiCandidateText(rawEnvelopeText: string): string {
  let envelope: any;
  try {
    envelope = JSON.parse(rawEnvelopeText);
  } catch {
    throw new TriageServiceError(
      "LLM_PROVIDER_ERROR",
      "LLM provider returned a malformed response envelope."
    );
  }

  if (!envelope || typeof envelope !== "object") {
    throw new TriageServiceError(
      "LLM_EMPTY_RESPONSE",
      "LLM provider returned an empty response."
    );
  }

  const blockReason = envelope.promptFeedback?.blockReason;
  if (
    typeof blockReason === "string" &&
    blockReason.length > 0 &&
    blockReason !== "BLOCK_REASON_UNSPECIFIED"
  ) {
    throw new TriageServiceError(
      "LLM_BLOCKED",
      "LLM provider blocked or filtered the response."
    );
  }

  if (!Array.isArray(envelope.candidates) || envelope.candidates.length === 0) {
    throw new TriageServiceError(
      "LLM_EMPTY_RESPONSE",
      "LLM provider returned an empty response."
    );
  }

  const primaryCandidate = envelope.candidates[0];
  const finishReason = primaryCandidate?.finishReason;

  if (typeof finishReason === "string" && BLOCKED_FINISH_REASONS.has(finishReason)) {
    throw new TriageServiceError(
      "LLM_BLOCKED",
      "LLM provider blocked or filtered the response."
    );
  }

  if (finishReason === "MAX_TOKENS") {
    throw new TriageServiceError(
      "LLM_TRUNCATED_RESPONSE",
      "LLM provider truncated the response."
    );
  }

  const parts = primaryCandidate?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new TriageServiceError(
      "LLM_EMPTY_RESPONSE",
      "LLM provider returned an empty response."
    );
  }

  const textSegments: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object") {
      if ("functionCall" in part || "executableCode" in part) {
        throw new TriageServiceError(
          "LLM_PROVIDER_ERROR",
          "LLM provider returned disallowed tool or code output."
        );
      }
      if (part.thought === true) {
        continue;
      }
      if (typeof part.text === "string") {
        textSegments.push(part.text);
      }
    }
  }

  const combined = textSegments.join("").trim();
  if (combined.length === 0) {
    throw new TriageServiceError(
      "LLM_EMPTY_RESPONSE",
      "LLM provider returned an empty response."
    );
  }

  return combined;
}

export class GeminiLlmAdapter implements LlmAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiAdapterOptions) {
    const trimmedKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
    if (trimmedKey.length === 0) {
      throw new TriageServiceError(
        "LLM_ADAPTER_NOT_CONFIGURED",
        "Gemini adapter requires a non-empty API key."
      );
    }

    const trimmedModel = typeof options.model === "string" ? options.model.trim() : "";
    if (trimmedModel.length === 0 || !VALID_MODEL_ID_PATTERN.test(trimmedModel)) {
      throw new TriageServiceError(
        "LLM_ADAPTER_NOT_CONFIGURED",
        "Gemini adapter requires an explicit valid model identifier."
      );
    }

    this.apiKey = trimmedKey;
    this.model = trimmedModel;
    this.timeoutMs = validatePositiveInteger(
      options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS,
      1,
      120_000,
      "timeoutMs"
    );
    this.maxResponseBytes = validatePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_GEMINI_MAX_RESPONSE_BYTES,
      1_024,
      2_000_000,
      "maxResponseBytes"
    );
    this.fetchFn = options.fetchFn ?? globalThis.fetch;

    if (typeof this.fetchFn !== "function") {
      throw new TriageServiceError(
        "LLM_ADAPTER_NOT_CONFIGURED",
        "Fetch implementation is not available for Gemini adapter."
      );
    }
  }

  async generateReview(prompt: LlmReviewPrompt): Promise<string> {
    const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(this.model)}:generateContent`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: prompt.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt.dataMessage }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
          redirect: "error",
        });
      } catch (err: unknown) {
        if (
          timedOut ||
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          throw new TriageServiceError("LLM_TIMEOUT", "LLM provider request timed out.");
        }
        throw new TriageServiceError(
          "LLM_HTTP_ERROR",
          "LLM provider network request failed."
        );
      }

      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});

        if (response.status === 429) {
          throw new TriageServiceError(
            "LLM_RATE_LIMITED",
            "LLM provider rate limit exceeded."
          );
        }
        if (response.status === 401 || response.status === 403) {
          throw new TriageServiceError(
            "LLM_AUTH_ERROR",
            "LLM provider authentication or authorization failed."
          );
        }
        throw new TriageServiceError(
          "LLM_HTTP_ERROR",
          "LLM provider returned an upstream HTTP error."
        );
      }

      const rawBody = await readBoundedResponseText(
        response,
        this.maxResponseBytes,
        controller
      );

      return extractGeminiCandidateText(rawBody);
    } catch (err: unknown) {
      if (err instanceof TriageServiceError) {
        throw err;
      }
      if (
        timedOut ||
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        throw new TriageServiceError("LLM_TIMEOUT", "LLM provider request timed out.");
      }
      throw new TriageServiceError(
        "LLM_PROVIDER_ERROR",
        "LLM provider failed during candidate review."
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Create an LlmAdapter from validated application config.
 * Returns undefined if LLM_PROVIDER is not configured.
 * Throws TriageServiceError if LLM_PROVIDER=gemini is set without explicit LLM_MODEL or LLM_API_KEY.
 */
export function createLlmAdapterFromConfig(
  config: Pick<AppConfig, "llmProvider" | "llmModel" | "llmApiKey">,
  overrides?: Partial<Pick<GeminiAdapterOptions, "timeoutMs" | "maxResponseBytes" | "fetchFn">>
): LlmAdapter | undefined {
  if (!config.llmProvider) {
    return undefined;
  }

  if (config.llmProvider === "gemini") {
    if (!config.llmModel || !config.llmApiKey) {
      throw new TriageServiceError(
        "LLM_ADAPTER_NOT_CONFIGURED",
        "Gemini provider requires explicit LLM_MODEL and LLM_API_KEY configuration."
      );
    }

    return new GeminiLlmAdapter({
      apiKey: config.llmApiKey,
      model: config.llmModel,
      ...overrides,
    });
  }

  throw new TriageServiceError(
    "LLM_ADAPTER_NOT_CONFIGURED",
    "Configured LLM provider is not supported."
  );
}
