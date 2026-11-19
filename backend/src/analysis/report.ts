import { keccak256, stringToHex } from "viem";
import type { SourceAnalysisDraft } from "./types";
import type { TriageReviewResult } from "./triage/types";
import type { TargetContractContext } from "../rpc/context";
import { RULES_CATALOG } from "./rules/catalog";

export type ReportContext = TargetContractContext | {
  status: "unavailable";
  address: string;
  network: "Avalanche Fuji Testnet";
  chainId: 43113;
  warning: string;
} | { status: "unspecified" };

export const SCORING_POLICY = "demo-v1-half-up-max";

export function priorityScore(exploitability: number, exposure: number, assetImpact: number) {
  return Math.round((4 * exploitability + 3 * exposure + 3 * assetImpact) / 10);
}

function severity(score: number) {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function boundText(text: string, limit: number): string {
  // Model text and source excerpts can carry unpaired UTF-16 surrogates.
  const safe = text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
  if (safe.length <= limit) return safe;
  return safe.slice(0, limit).replace(/[\uD800-\uDFFF]$/u, "") + "…";
}

export function buildReport(
  sourceCode: string,
  draft: SourceAnalysisDraft,
  targetContract: ReportContext,
  review?: TriageReviewResult,
) {
  const assessed = new Map(review?.reviewedCandidates.map((item) => [item.candidateId, item]));
  const findings = draft.candidates.map((candidate, index) => {
    const assessment = assessed.get(`cand-${index}`);
    const visibility = candidate.target.visibility === "default" ? "n/a" : candidate.target.visibility;
    const callable = visibility === "public" || visibility === "external";
    const exploitability = RULES_CATALOG[candidate.ruleId].defaultExploitability;
    // Unknown modifier semantics and unverified address bindings cannot lower a score.
    const exposure = callable ? 100 : 10;
    const assetImpact = 0;
    const score = priorityScore(exploitability, exposure, assetImpact);
    const patch = assessment?.remediation ?? "";
    const isDiff = /^--- [^\n]+\r?\n\+\+\+ /u.test(patch);
    return {
      id: `F-${index + 1}`,
      ruleId: candidate.ruleId,
      title: candidate.ruleId === "RULE-PRAGMA-006" ? "Floating Solidity pragma" : "tx.origin in a condition",
      function: candidate.target.signature ?? candidate.target.functionName,
      visibility,
      modifiers: candidate.target.modifiers,
      scores: { exploitability, exposure, assetImpact, priorityScore: score },
      severity: severity(score),
      description: boundText(candidate.evidence.reasoning, 1500),
      evidence: [`${candidate.evidence.lines}: ${boundText(candidate.evidence.snippet, 1200)}`],
      confidence: candidate.confidence,
      patchDiff: isDiff ? boundText(patch, 8000) : "",
      liveContext: {
        status: targetContract.status,
        note: "Native balance is context only. Assets at risk and the source-to-address match are unverified.",
      },
      limitations: candidate.limitations.map((item) => boundText(item, 1000)),
      ...(assessment ? {
        review: {
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          explanation: boundText(assessment.explanation, 4000),
          limitations: assessment.limitations.map((item) => boundText(item, 1000)),
          remediation: isDiff ? "" : boundText(patch, 8000),
        },
      } : {}),
    };
  }).sort((a, b) => b.scores.priorityScore - a.scores.priorityScore);

  return {
    sourceDigest: keccak256(stringToHex(sourceCode)),
    analyzedAt: new Date().toISOString(),
    policy: SCORING_POLICY,
    reviewMode: review ? "gemini" : "static",
    limitations: [
      "Scores are local demo estimates with half-up rounding and the highest candidate as the report score.",
      "Asset Impact uses a zero placeholder because asset exposure is unverified, even when native balance is available.",
      "The submitted source was not matched against deployed bytecode. Candidates are observations for human review.",
      ...(findings.length ? [] : ["No candidates from the available checks. This is not a safety verdict."]),
      ...draft.limitations.slice(0, 50).map((item) => boundText(item, 1000)),
    ],
    coverage: {
      analyzedRules: draft.coverage.analyzedRules,
      unanalyzedRules: draft.coverage.unanalyzedRules,
    },
    targetContract,
    summary: {
      totalVulnerabilities: findings.length,
      criticalCount: findings.filter((item) => item.severity === "CRITICAL").length,
      highCount: findings.filter((item) => item.severity === "HIGH").length,
      mediumCount: findings.filter((item) => item.severity === "MEDIUM").length,
      lowCount: findings.filter((item) => item.severity === "LOW").length,
      priorityScore: findings[0]?.scores.priorityScore ?? 0,
    },
    findings,
    ...("queriedAt" in targetContract ? { queriedAt: targetContract.queriedAt } : {}),
  };
}
