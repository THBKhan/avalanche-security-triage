/**
 * POST /api/analyze Route Handler
 * Validates requests and dispatches to source analysis or Fuji context inspection.
 */

import { Request, Response, NextFunction } from "express";
import { OnChainContextReader, RpcContextError } from "../rpc/context";
import { RequestValidationResult } from "./schema";
import type { SourceReportService } from "./source-report";

export function createAnalyzeHandler(
  reader: Pick<OnChainContextReader, "fetchContext">,
  validateRequest: (data: unknown) => RequestValidationResult,
  sourceReport: SourceReportService,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Validate request payload against compiled JSON Schema
      const validation = validateRequest(req.body);

      if (!validation.valid) {
        if (validation.isZeroAddress) {
          res.status(400).json({
            error: {
              code: "INVALID_ADDRESS",
              message: "Invalid Avalanche Fuji contract address: zero address is not allowed",
            },
          });
          return;
        }

        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Request payload does not match schema requirements",
            details: {
              issues: validation.issues,
            },
          },
        });
        return;
      }

      // Source assessment and read-only address inspection have separate outcomes.
      if (typeof req.body.sourceCode === "string" && req.body.sourceCode.trim().length > 0) {
        const result = await sourceReport(req.body);
        res.status(result.status).json(result.body);
        return;
      }

      // 3. Address-only context retrieval
      const contractAddress = req.body.contractAddress as string;
      const context = await reader.fetchContext(contractAddress);

      res.status(200).json({
        mode: "context-only",
        targetContract: { ...context, dataSource: "fuji-rpc" },
        attestation: {
          status: "DISABLED",
          disabledReason: "Address-only request: On-chain context retrieved without source code analysis or priority score.",
        },
      });
    } catch (err: unknown) {
      if (err instanceof RpcContextError) {
        if (err.code === "INVALID_ADDRESS") {
          res.status(400).json({
            error: {
              code: "INVALID_ADDRESS",
              message: "Invalid Avalanche Fuji contract address format",
            },
          });
          return;
        }

        if (isUpstreamRpcError(err)) {
          res.status(502).json({
            error: {
              code: "UPSTREAM_RPC_ERROR",
              message: "Failed to query on-chain context from Avalanche Fuji RPC",
              details: {
                reason: err.code,
              },
            },
          });
          return;
        }

        if (err.code === "INVALID_INPUT") {
          res.status(500).json({
            error: {
              code: "INTERNAL_SERVER_ERROR",
              message: "An internal server error occurred",
            },
          });
          return;
        }
      }

      // Forward unexpected errors to the global Express error handler
      next(err);
    }
  };
}

export function isUpstreamRpcError(err: unknown): boolean {
  return err instanceof RpcContextError &&
    ["RPC_TIMEOUT", "RATE_LIMITED", "WRONG_NETWORK", "RPC_ERROR", "REVERT"].includes(err.code);
}
