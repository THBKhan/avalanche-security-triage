/**
 * Candidate Triage Review Service
 * Orchestrates LLM prompt preparation, model invocation via adapter, strict Zod validation,
 * semantic reference checks, and candidate fact merging.
 *
 * Enforces strict security boundaries:
 * - Does not evaluate raw Solidity in system instructions.
 * - Does not treat zero candidates as "contract is safe".
 * - Validates evidence references and prevents overwriting backend facts.
 * - Identifies unreviewed candidates explicitly.
 * - Sanitizes errors against secret/source leakage.
 */

import { SourceAnalysisDraft } from "../types";
import { TargetContractContext } from "../../rpc/context";
import { LlmAdapter } from "./adapter";
import { buildTriagePrompt, TRIAGE_PROMPT_VERSION } from "./prompt";
import {
  CandidateAssessment,
  ModelTriageOutputSchema,
  ReviewedCandidate,
  TriageReviewResult,
  TriageServiceError,
  UnreviewedCandidate,
} from "./types";

const MAX_MODEL_RESPONSE_CHARS = 100_000;

export interface TriageServiceOptions {
  adapter?: LlmAdapter;
  customTemplatePath?: string;
}

export class CandidateTriageService {
  private adapter?: LlmAdapter;
  private customTemplatePath?: string;

  constructor(options: TriageServiceOptions = {}) {
    this.adapter = options.adapter;
    this.customTemplatePath = options.customTemplatePath;
  }

  /**
   * Execute candidate review triage on a SourceAnalysisDraft.
   */
  async reviewCandidates(params: {
    sourceCode: string;
    draft: SourceAnalysisDraft;
    onChainContext?: TargetContractContext | Record<string, any> | null;
  }): Promise<TriageReviewResult> {
    const timestamp = new Date().toISOString();
    const onChainAttached = Boolean(
      params.onChainContext && params.onChainContext.status === "available"
    );

    // 1. Boundary check: Fail fast if real or mock adapter is not configured
    if (!this.adapter) {
      throw new TriageServiceError(
        "LLM_ADAPTER_NOT_CONFIGURED",
        "No LLM adapter configured for candidate review. Live provider connection is pending."
      );
    }

    // 2. Prepare structured versioned prompt
    const prompt = buildTriagePrompt({
      sourceCode: params.sourceCode,
      draft: params.draft,
      onChainContext: params.onChainContext,
      customTemplatePath: this.customTemplatePath,
    });

    // 3. Zero-candidates handling: Do NOT claim the contract is safe
    if (prompt.preparedCandidates.length === 0) {
      return {
        reviewedCandidates: [],
        unreviewedCandidates: [],
        coverage: params.draft.coverage,
        limitations: [
          ...params.draft.limitations,
          "Zero candidates identified in static analysis; this does NOT imply the contract is secure or vulnerability-free.",
        ],
        triageTimestamp: timestamp,
        promptVersion: TRIAGE_PROMPT_VERSION,
        onChainContextAttached: onChainAttached,
      };
    }

    // 4. Invoke LLM Adapter safely
    let rawResponse: string;
    try {
      rawResponse = await this.adapter.generateReview({
        systemPrompt: prompt.systemPrompt,
        dataMessage: prompt.dataMessage,
      });
    } catch (err: any) {
      // Do not echo prompt or secrets
      throw new TriageServiceError(
        "LLM_PROVIDER_ERROR",
        `LLM candidate review failed during model execution: ${err?.message || "Unknown provider error"}`
      );
    }

    // 5. Bounds check on response size
    if (typeof rawResponse !== "string" || rawResponse.length > MAX_MODEL_RESPONSE_CHARS) {
      throw new TriageServiceError(
        "OUTPUT_TOO_LARGE",
        `Model review response exceeded maximum allowed length (${MAX_MODEL_RESPONSE_CHARS} characters)`
      );
    }

    // 6. Safe JSON parse (never eval, never heuristic repair)
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawResponse);
    } catch {
      throw new TriageServiceError(
        "MALFORMED_JSON",
        "Model review response is not valid JSON."
      );
    }

    // 7. Strict Zod schema validation
    const zodResult = ModelTriageOutputSchema.safeParse(parsedJson);
    if (!zodResult.success) {
      const issueDetails = zodResult.error.issues.map(
        (i) => `${i.path.join(".") || "root"}: ${i.message}`
      );
      throw new TriageServiceError(
        "INVALID_MODEL_OUTPUT",
        "Model review output failed strict schema validation.",
        issueDetails
      );
    }

    // 8. Semantic validation & Reference checks
    const candidateMap = new Map(prompt.preparedCandidates.map((p) => [p.candidateId, p]));
    const assessmentMap = new Map<string, CandidateAssessment>();

    for (const assessment of zodResult.data.assessments) {
      // Check candidateId existence
      const prep = candidateMap.get(assessment.candidateId);
      if (!prep) {
        throw new TriageServiceError(
          "UNKNOWN_CANDIDATE_ID",
          `Model assessment references unknown candidateId '${assessment.candidateId}'.`
        );
      }

      // Check for duplicates
      if (assessmentMap.has(assessment.candidateId)) {
        throw new TriageServiceError(
          "DUPLICATE_ASSESSMENT",
          `Model review contains duplicate assessment for candidateId '${assessment.candidateId}'.`
        );
      }

      // Check evidence references
      for (const ref of assessment.evidenceReferences) {
        if (!prep.validEvidenceKeys.has(ref)) {
          throw new TriageServiceError(
            "INVALID_EVIDENCE_REFERENCE",
            `Assessment for candidateId '${assessment.candidateId}' references non-existent evidence '${ref}'.`
          );
        }
      }

      assessmentMap.set(assessment.candidateId, assessment);
    }

    // 9. Assemble reviewed and unreviewed candidates
    const reviewedCandidates: ReviewedCandidate[] = [];
    const unreviewedCandidates: UnreviewedCandidate[] = [];

    for (const prep of prompt.preparedCandidates) {
      const assessment = assessmentMap.get(prep.candidateId);

      if (assessment) {
        // Model CANNOT overwrite immutable backend facts (signature, location, facts)
        reviewedCandidates.push({
          candidateId: prep.candidateId,
          candidate: prep.candidate,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          explanation: assessment.explanation,
          evidenceReferences: [...assessment.evidenceReferences],
          limitations: [...assessment.limitations],
          remediation: assessment.remediation,
        });
      } else {
        // Unassessed candidates are explicitly flagged as unreviewed, never silently dismissed
        unreviewedCandidates.push({
          candidateId: prep.candidateId,
          candidate: prep.candidate,
          status: "unreviewed",
          reason: "Model omitted assessment for this candidate in its review response.",
        });
      }
    }

    return {
      reviewedCandidates,
      unreviewedCandidates,
      coverage: params.draft.coverage,
      limitations: [
        ...params.draft.limitations,
        "Candidate review verdicts represent semantic triage assessments and do not constitute formal verification.",
      ],
      triageTimestamp: timestamp,
      promptVersion: TRIAGE_PROMPT_VERSION,
      onChainContextAttached: onChainAttached,
    };
  }
}
