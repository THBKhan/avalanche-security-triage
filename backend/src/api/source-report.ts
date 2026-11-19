import type { ValidateFunction } from "ajv";
import type { AppConfig } from "../config";
import { analyzeSoliditySource, CandidateTriageService, TriageServiceError } from "../analysis";
import { buildReport, type ReportContext } from "../analysis/report";
import { hashReport, isWellFormedUnicode, type SnapshotStore } from "../analysis/snapshot";
import type { OnChainContextReader } from "../rpc/context";
import { isUpstreamRpcError } from "./analyze";

interface SourceRequest {
  sourceCode: string;
  contractAddress?: string;
  reviewWithGemini?: boolean;
}

export type SourceReportService = (request: SourceRequest) => Promise<{
  status: number;
  body: unknown;
}>;

function failure(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } };
}

export function createSourceReportService(
  reader: Pick<OnChainContextReader, "fetchContext">,
  snapshots: SnapshotStore,
  validateResponse: ValidateFunction,
  registryAddress: AppConfig["registryAddress"],
  triage?: CandidateTriageService,
): SourceReportService {
  return async ({ sourceCode, contractAddress, reviewWithGemini }) => {
    if (!isWellFormedUnicode(sourceCode)) {
      return failure(400, "INVALID_REQUEST", "Solidity source must contain valid Unicode.");
    }
    const analysis = analyzeSoliditySource(sourceCode);
    if (!analysis.ok) {
      return {
        status: 400,
        body: {
          error: {
            code: "INVALID_SOURCE",
            message: "Solidity source could not be parsed.",
            details: { line: analysis.error.line, column: analysis.error.column },
          },
        },
      };
    }
    if (analysis.draft.candidates.length > 50) {
      return failure(400, "INVALID_SOURCE", "This file produced over 50 candidates. Analyze smaller sections.");
    }
    if (reviewWithGemini && !triage) {
      return failure(503, "AI_MODEL_UNAVAILABLE", "Gemini review is not configured.");
    }

    let context: ReportContext = { status: "unspecified" };
    if (contractAddress) {
      try {
        context = await reader.fetchContext(contractAddress);
      } catch (error) {
        if (!isUpstreamRpcError(error)) throw error;
        context = {
          status: "unavailable",
          address: contractAddress,
          network: "Avalanche Fuji Testnet",
          chainId: 43113,
          warning: "Fuji context could not be retrieved. Source analysis is still available.",
        };
      }
    }

    let review;
    if (reviewWithGemini && triage) {
      try {
        review = await triage.reviewCandidates({
          sourceCode,
          draft: analysis.draft,
          onChainContext: context,
        });
      } catch (error) {
        if (!(error instanceof TriageServiceError)) throw error;
        return failure(502, "AI_MODEL_ERROR", "Gemini review did not complete. You can run static checks separately.");
      }
    }

    const report = buildReport(sourceCode, analysis.draft, context, review);
    const snapshot = hashReport(report);
    const disabledReason = !report.findings.length
      ? "There are no candidates to attest."
      : context.status !== "available" || !context.isContract
        ? "Attestation requires a readable Fuji address with deployed code."
        : !registryAddress ? "The Fuji registry is not configured." : "";
    const body = {
      mode: "source-analysis",
      report,
      attestation: disabledReason ? {
        status: "NOT_ATTESTABLE",
        disabledReason,
        reportHash: snapshot.reportHash,
      } : {
        status: "READY_TO_ATTEST",
        reportHash: snapshot.reportHash,
        registryAddress,
        ipfsUri: "",
      },
    };
    if (!validateResponse(body)) {
      throw new Error("Generated source report does not match the response schema");
    }
    await snapshots.save(snapshot);
    return { status: 200, body };
  };
}
