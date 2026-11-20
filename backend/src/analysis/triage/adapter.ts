/**
 * LLM Adapter Interface and Mock Implementations
 * Minimal abstraction for model invocation. Real provider integration is deferred.
 */

export interface LlmReviewPrompt {
  systemPrompt: string;
  dataMessage: string;
}

export interface LlmAdapter {
  generateReview(prompt: LlmReviewPrompt): Promise<string>;
}

/**
 * Mock LLM Adapter for offline testing and deterministic verification.
 * Supports programmable response string or function handler.
 */
export class MockLlmAdapter implements LlmAdapter {
  private responseHandler: (prompt: LlmReviewPrompt) => Promise<string> | string;

  constructor(
    responseOrHandler: string | ((prompt: LlmReviewPrompt) => Promise<string> | string)
  ) {
    if (typeof responseOrHandler === "function") {
      this.responseHandler = responseOrHandler;
    } else {
      this.responseHandler = () => responseOrHandler;
    }
  }

  async generateReview(prompt: LlmReviewPrompt): Promise<string> {
    return Promise.resolve(this.responseHandler(prompt));
  }
}
