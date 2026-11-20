import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config";

test("loadConfig returns default values when env is empty", () => {
  const config = loadConfig({});
  assert.equal(config.port, 3001);
  assert.equal(config.fujiRpcUrl, "https://api.avax-test.network/ext/bc/C/rpc");
  assert.equal(config.corsOrigin, "http://localhost:3000");
  assert.equal(config.llmProvider, undefined);
  assert.equal(config.llmModel, undefined);
  assert.equal(config.llmApiKey, undefined);
});

test("loadConfig parses LLM_PROVIDER=gemini and explicit LLM_MODEL without hardcoded default", () => {
  const config = loadConfig({
    LLM_PROVIDER: "  GEMINI ",
    LLM_MODEL: "gemini-2.5-flash",
    LLM_API_KEY: "test-key",
  });
  assert.equal(config.llmProvider, "gemini");
  assert.equal(config.llmModel, "gemini-2.5-flash");
  assert.equal(config.llmApiKey, "test-key");

  // When only provider is set, llmModel stays undefined (no hardcoded default)
  const providerOnly = loadConfig({ LLM_PROVIDER: "gemini" });
  assert.equal(providerOnly.llmProvider, "gemini");
  assert.equal(providerOnly.llmModel, undefined);
});

test("loadConfig rejects unsupported LLM_PROVIDER and malformed LLM_MODEL without echoing values", () => {
  try {
    loadConfig({ LLM_PROVIDER: "secret-provider-xyz" });
    assert.fail("Should have thrown");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /Invalid LLM_PROVIDER/);
    assert.ok(!msg.includes("secret-provider-xyz"));
  }

  try {
    loadConfig({ LLM_MODEL: "../etc/passwd" });
    assert.fail("Should have thrown");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /Invalid LLM_MODEL/);
    assert.ok(!msg.includes("passwd"));
  }
});

test("loadConfig parses custom valid port and URL", () => {
  const config = loadConfig({
    PORT: "8080",
    FUJI_RPC_URL: "https://custom-fuji-rpc.example.com",
    CORS_ORIGIN: "https://my-dashboard.example.com",
    LLM_API_KEY: "secret-test-key",
  });
  assert.equal(config.port, 8080);
  assert.equal(config.fujiRpcUrl, "https://custom-fuji-rpc.example.com");
  assert.equal(config.corsOrigin, "https://my-dashboard.example.com");
  assert.equal(config.llmApiKey, "secret-test-key");
});

test("loadConfig parses multiple CORS origins separated by comma", () => {
  const config = loadConfig({
    CORS_ORIGIN: "http://localhost:3000, https://dashboard.example.com",
  });
  assert.deepEqual(config.corsOrigin, ["http://localhost:3000", "https://dashboard.example.com"]);
});

test("loadConfig rejects invalid port numbers (trailing letters, decimals, exponents, empty)", () => {
  assert.throws(() => loadConfig({ PORT: "not-a-number" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "3001abc" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "3001.5" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "1e3" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "   " }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "0" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "-1" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "65536" }), /Invalid PORT configuration/);
  assert.throws(() => loadConfig({ PORT: "70000" }), /Invalid PORT configuration/);
});

test("loadConfig rejects malformed RPC URLs", () => {
  assert.throws(() => loadConfig({ FUJI_RPC_URL: "not-a-url" }), /Invalid FUJI_RPC_URL/);
  assert.throws(() => loadConfig({ FUJI_RPC_URL: "ftp://example.com" }), /protocol must be http or https/);
});

test("loadConfig error messages do not leak secrets", () => {
  try {
    loadConfig({
      PORT: "invalid",
      LLM_API_KEY: "super_sensitive_api_key_12345",
    });
    assert.fail("Should have thrown");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(!message.includes("super_sensitive_api_key_12345"));
  }
});
