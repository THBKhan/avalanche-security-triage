/**
 * Express Application Setup
 * Factory function separating app instantiation from HTTP server listening.
 * Reuses reader instance and compiled schemas across HTTP requests.
 */

import express, { Express, Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import path from "node:path";
import { AppConfig } from "./config";
import { OnChainContextReader } from "./rpc/context";
import { createRequestValidator, createResponseValidator } from "./api/schema";
import { createAnalyzeHandler } from "./api/analyze";
import { createFujiSmokeHandler } from "./api/fuji-smoke";
import { createSourceReportService } from "./api/source-report";
import { createSnapshotStore, type SnapshotStore } from "./analysis/snapshot";
import { CandidateTriageService, createLlmAdapterFromConfig, type LlmAdapter } from "./analysis";

export interface AppDependencies {
  reader?: Pick<OnChainContextReader, "fetchContext">;
  snapshots?: SnapshotStore;
  llmAdapter?: LlmAdapter;
}

export function createApp(config: AppConfig, deps: AppDependencies = {}): Express {
  const app = express();
  app.disable("x-powered-by");

  // Create or inject the reader for this app instance (reused across requests)
  const reader = deps.reader || new OnChainContextReader({ rpcUrl: config.fujiRpcUrl });

  // Compile request validation schema ONCE at app creation
  const validateRequest = createRequestValidator();
  const validateResponse = createResponseValidator();
  const adapter = deps.llmAdapter ?? createLlmAdapterFromConfig(config);
  const sourceReport = createSourceReportService(
    reader,
    deps.snapshots ?? createSnapshotStore(config.snapshotDirectory ?? path.resolve(__dirname, "../.report-snapshots")),
    validateResponse,
    config.registryAddress,
    adapter ? new CandidateTriageService({ adapter }) : undefined,
  );
  const fujiSmoke = createFujiSmokeHandler(config, sourceReport);

  // Strict CORS: Only allow configured origins, never reflect arbitrary origins
  const allowedOrigins = Array.isArray(config.corsOrigin) ? config.corsOrigin : [config.corsOrigin];
  app.use(cors<Request>((req, callback) => {
    const origin = req.get("origin");
    const sameOrigin = req.get("host") && `${req.protocol}://${req.get("host")}`;
    if (origin && origin !== sameOrigin && !allowedOrigins.includes(origin)) {
      callback(new Error("CORS origin not allowed"));
      return;
    }
    const options: CorsOptions = {
      origin: origin ?? false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    };
    callback(null, options);
  }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "250kb" }));

  // Health endpoint: does not call external LLM or RPC; does not leak secrets or env vars
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({ geminiAvailable: Boolean(adapter), ...(fujiSmoke ? { fujiSmokeAvailable: true } : {}) });
  });

  // Bound the entire process, including when deployed behind a shared proxy.
  let active = 0;
  let remaining = 60;
  let resetAt = Date.now() + 60_000;
  const withAnalysisLimits = (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      const now = Date.now();
      if (now >= resetAt) {
        remaining = 60;
        resetAt = now + 60_000;
      }
      if (remaining === 0 || active >= 4) {
        res.set("Retry-After", remaining === 0 ? String(Math.max(1, Math.ceil((resetAt - now) / 1000))) : "2");
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "The demo is busy. Try again shortly." } });
        return;
      }
      remaining--;
      active++;
      // Release when the handler finishes, including if the client disconnects early.
      void handler(req, res, next).finally(() => { active--; }).catch(next);
    };
  app.post("/api/analyze", withAnalysisLimits(createAnalyzeHandler(reader, validateRequest, sourceReport)));
  if (fujiSmoke) app.post("/api/fuji-smoke", withAnalysisLimits(fujiSmoke));

  app.use(express.static(path.resolve(__dirname, "../../frontend/public"), {
    setHeaders(res, filename) {
      if (filename.endsWith(".mjs")) res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }));

  // Global safe error handler: prevents leaking stack traces, bodies, or configuration secrets
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.message === "CORS origin not allowed") {
      res.status(403).json({
        error: {
          code: "FORBIDDEN_CORS",
          message: "Origin is not allowed by CORS policy",
        },
      });
      return;
    }

    if (err.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400)) {
      res.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Malformed JSON payload in request body",
        },
      });
      return;
    }

    if (err.type === "entity.too.large" || err.status === 413) {
      res.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request payload exceeds size limit (250kb)",
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An internal server error occurred",
      },
    });
  });

  return app;
}
