import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app";
import { AppConfig } from "./config";

const testConfig: AppConfig = {
  port: 3001,
  fujiRpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  corsOrigin: "http://localhost:3000",
  llmApiKey: undefined, // Missing LLM key
};

test("GET /health returns 200 and minimal status payload", async () => {
  const app = createApp(testConfig);
  const res = await request(app).get("/health");

  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.ok(res.body.timestamp);
  // Ensure timestamp is valid date-time
  assert.ok(!Number.isNaN(Date.parse(res.body.timestamp)));

  // Ensure response contains NO secrets, internal stack, or env leaks
  assert.equal(res.body.env, undefined);
  assert.equal(res.body.fujiRpcUrl, undefined);
  assert.equal(res.body.llmApiKey, undefined);
  assert.equal(res.body.config, undefined);
});

test("App initializes and runs health check cleanly when LLM_API_KEY is missing", async () => {
  const appWithoutKey = createApp({
    port: 3001,
    fujiRpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    corsOrigin: "http://localhost:3000",
    llmApiKey: undefined,
  });

  const res = await request(appWithoutKey).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("CORS allows requests from declared origin", async () => {
  const app = createApp(testConfig);
  const res = await request(app)
    .get("/health")
    .set("Origin", "http://localhost:3000");

  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3000");
});

test("CORS blocks requests from unauthorized origin", async () => {
  const app = createApp(testConfig);
  const res = await request(app)
    .get("/health")
    .set("Origin", "http://malicious-attacker.com");

  assert.equal(res.status, 403);
  assert.equal(res.body.error?.code, "FORBIDDEN_CORS");
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("Malformed JSON in request returns 400 Bad Request with INVALID_JSON", async () => {
  const app = createApp(testConfig);
  const res = await request(app)
    .post("/health")
    .set("Content-Type", "application/json")
    .send("{ invalid json: ");

  assert.equal(res.status, 400);
  assert.equal(res.body.error?.code, "INVALID_JSON");
  assert.ok(!JSON.stringify(res.body).includes("stack"));
});

test("Payload exceeding 250kb returns 413 Payload Too Large with PAYLOAD_TOO_LARGE", async () => {
  const app = createApp(testConfig);
  // Create payload larger than 250kb (e.g. 260kb)
  const largeData = "a".repeat(260 * 1024);
  const res = await request(app)
    .post("/health")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ data: largeData }));

  assert.equal(res.status, 413);
  assert.equal(res.body.error?.code, "PAYLOAD_TOO_LARGE");
  assert.ok(!JSON.stringify(res.body).includes("stack"));
});
