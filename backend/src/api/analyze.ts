/**
 * POST /api/analyze Route Handler
 * Implements address-only triage inspection via OnChainContextReader.
 * Returns 501 for source analysis during current incremental phase.
 */

import { Request, Response, NextFunction } from "express";
import { OnChainContextReader, RpcContextError } from "../rpc/context";
import { RequestValidationResult } from "./schema";

export function createAnalyzeHandler(
  reader: OnChainContextReader,
  validateRequest: (data: unknown) => RequestValidationResult
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

      // 2. Temporary 501 Not Implemented for requests containing sourceCode
      if (typeof req.body.sourceCode === "string" && req.body.sourceCode.trim().length > 0) {
        res.status(501).json({
          error: {
            code: "SOURCE_ANALYSIS_NOT_IMPLEMENTED",
            message: "Source code analysis is not yet implemented at this development phase",
            details: {
              note: "Temporary 501 response during incremental development. Use address-only requests for on-chain context triage.",
            },
          },
        });
        return;
      }

      // 3. Address-only context retrieval
      const contractAddress = req.body.contractAddress as string;
      const context = await reader.fetchContext(contractAddress);

      res.status(200).json({
        mode: "context-only",
        targetContract: context,
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

        if (
          err.code === "RPC_TIMEOUT" ||
          err.code === "RATE_LIMITED" ||
          err.code === "WRONG_NETWORK" ||
          err.code === "RPC_ERROR" ||
          err.code === "REVERT"
        ) {
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
