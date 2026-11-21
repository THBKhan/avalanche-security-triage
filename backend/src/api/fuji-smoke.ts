import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { createPublicClient, http, keccak256, stringToHex } from "viem";
import { avalancheFuji } from "viem/chains";
import type { AppConfig } from "../config";
import type { SourceReportService } from "./source-report";

// Source and runtime of the registry deployed in Fuji transaction 0xd813393b…4254585.
const REGISTRY = "0xB94F639079de5b1D3AF27f18F09b417f04742107";
const SOURCE_HASH = "0xf7cbef9e48375ba8409d5a32663d0a61ed60752fca1f9f39dd9ace75362c33a9";
const RUNTIME_HASH = "0x86d96b1e578a4a224e4785142fff61b4db948dccd22ad7c83c62d09c566783c1";
const sourcePath = path.resolve(__dirname, "../../../contracts/contracts/AvaTriageRegistry.sol");

export function createFujiSmokeHandler(config: AppConfig, sourceReport: SourceReportService) {
  if (!config.enableFujiSmokeTest || config.registryAddress !== REGISTRY) return undefined;

  const client = createPublicClient({
    chain: avalancheFuji,
    transport: http(config.fujiRpcUrl, { retryCount: 0, timeout: 5_000 }),
  });

  return async (_req: Request, res: Response): Promise<void> => {
    let sourceCode: string;
    try {
      const [source, chainId, bytecode] = await Promise.all([
        readFile(sourcePath, "utf8"),
        client.getChainId(),
        client.getCode({ address: REGISTRY }),
      ]);
      sourceCode = source.replace(/\r\n/g, "\n").trimEnd();
      if (chainId !== avalancheFuji.id || !bytecode || keccak256(bytecode) !== RUNTIME_HASH
          || keccak256(stringToHex(sourceCode)) !== SOURCE_HASH) {
        throw new Error("Fuji smoke target verification failed");
      }
    } catch {
      res.status(502).json({
        error: { code: "FUJI_SMOKE_UNAVAILABLE", message: "Fuji registry source or runtime could not be verified." },
      });
      return;
    }

    const { status, body } = await sourceReport({ sourceCode, contractAddress: REGISTRY }, "fuji-smoke");
    res.status(status).json(body);
  };
}
