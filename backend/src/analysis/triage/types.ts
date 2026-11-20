/**
 * Internal LLM Triage Review Contract and Zod Schemas
 * Defines strict validation schemas for model candidate review assessments.
 * Completely distinct from the public API JSON Schema.
 */

import { z } from "zod";
import { AnalysisCoverage, RuleCandidate } from "../types";

// Allowed triage verdicts - strictly excludes "confirmed" or proof of exploit
export const TriageVerdictSchema = z.enum(["potential-issue", "dismissed", "needs-review"]);
export type TriageVerdict = z.infer<typeof TriageVerdictSchema>;

export const TriageConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type TriageConfidence = z.infer<typeof TriageConfidenceSchema>;

/**
 * Strict single assessment schema.
 * Rejects unexpected properties, imposes bounds on length and arrays.
 */
export const CandidateAssessmentSchema = z
  .object({
    candidateId: z.string().min(1).max(100),
    verdict: TriageVerdictSchema,
    confidence: TriageConfidenceSchema,
    explanation: z.string().min(1).max(4000),
    evidenceReferences: z.array(z.string().min(1).max(100)).min(1).max(20),
    limitations: z.array(z.string().min(1).max(1000)).max(20).default([]),
    remediation: z.string().max(8000).optional(),
  })
  .strict();

export type CandidateAssessment = z.infer<typeof CandidateAssessmentSchema>;

/**
 * Strict top-level model output schema.
 * Rejects priorityScore, severity, reportHash, onChainFacts, or extra fields.
 */
export const ModelTriageOutputSchema = z
  .object({
    assessments: z.array(CandidateAssessmentSchema).max(50),
  })
  .strict();

export type ModelTriageOutput = z.infer<typeof ModelTriageOutputSchema>;

/**
 * Reviewed candidate combining immutable backend facts with model assessment.
 */
export interface ReviewedCandidate {
  candidateId: string;
  candidate: RuleCandidate;
  verdict: TriageVerdict;
  confidence: TriageConfidence;
  explanation: string;
  evidenceReferences: string[];
  limitations: string[];
  remediation?: string;
}

/**
 * Candidate that was omitted or unassessed by the model review.
 */
export interface UnreviewedCandidate {
  candidateId: string;
  candidate: RuleCandidate;
  status: "unreviewed";
  reason: string;
}

/**
 * Full internal result of candidate review triage.
 */
export interface TriageReviewResult {
  reviewedCandidates: ReviewedCandidate[];
  unreviewedCandidates: UnreviewedCandidate[];
  coverage: AnalysisCoverage;
  limitations: string[];
  triageTimestamp: string;
  promptVersion: string;
  onChainContextAttached: boolean;
}

/**
 * Structured service error with sanitized details.
 */
export class TriageServiceError extends Error {
  public readonly code: string;
  public readonly issues?: string[];

  constructor(code: string, message: string, issues?: string[]) {
    super(message);
    this.name = "TriageServiceError";
    this.code = code;
    this.issues = issues;
  }
}
