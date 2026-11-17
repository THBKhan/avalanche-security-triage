/**
 * Express Application Setup
 * Factory function separating app instantiation from HTTP server listening.
 * Reuses reader instance and compiled schemas across HTTP requests.
 */

import express, { Express, Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import { AppConfig } from "./config";
import { OnChainContextReader } from "./rpc/context";
import { createRequestValidator } from "./api/schema";
import { createAnalyzeHandler } from "./api/analyze";

export interface AppDependencies {
  reader?: OnChainContextReader;
}

export function createApp(config: AppConfig, deps: AppDependencies = {}): Express {
  const app = express();

  // Create or inject the reader for this app instance (reused across requests)
  const reader = deps.reader || new OnChainContextReader({ rpcUrl: config.fujiRpcUrl });

  // Compile request validation schema ONCE at app creation
  const validateRequest = createRequestValidator();

  // Strict CORS: Only allow configured origins, never reflect arbitrary origins
  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (such as same-origin curl or server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      const allowed = Array.isArray(config.corsOrigin)
        ? config.corsOrigin
        : [config.corsOrigin];

      if (allowed.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin not allowed"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "250kb" }));

  // Health endpoint: does not call external LLM or RPC; does not leak secrets or env vars
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  // POST /api/analyze endpoint (registered BEFORE global error handler)
  app.post("/api/analyze", createAnalyzeHandler(reader, validateRequest));

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
