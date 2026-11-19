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
 * - Sanitizes all errors so secrets, source code, prompts, and model payloads are never echoed.
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

/**
 * Fixed, sanitized error messages mapped from known safe adapter error codes.
 * Raw adapter err.message is NEVER echoed to callers.
 */
const SAFE_ADAPTER_ERROR_MESSAGES: Record<string, string> = {
  LLM_TIMEOUT: "LLM provider request timed out.",
  LLM_RATE_LIMITED: "LLM provider rate limit exceeded.",
  LLM_AUTH_ERROR: "LLM provider authentication or authorization failed.",
  LLM_HTTP_ERROR: "LLM provider returned an upstream HTTP error.",
  LLM_EMPTY_RESPONSE: "LLM provider returned an empty response.",
  LLM_BLOCKED: "LLM provider blocked or filtered the response.",
  LLM_TRUNCATED_RESPONSE: "LLM provider truncated the response.",
  OUTPUT_TOO_LARGE: `Model review response exceeded maximum allowed length (${MAX_MODEL_RESPONSE_CHARS} characters).`,
  LLM_ADAPTER_NOT_CONFIGURED: "No LLM adapter configured for candidate review.",
};

/**
 * Allowlist of known schema field names so Zod path formatting never echoes arbitrary model keys.
 */
const ALLOWED_SCHEMA_PATH_KEYS = new Set([
  "assessments",
  "candidateId",
  "verdict",
  "confidence",
  "explanation",
  "evidenceReferences",
  "limitations",
  "remediation",
]);

function formatSafeZodIssue(issue: { path: PropertyKey[]; code: string }): string {
  const safePath = issue.path
    .map((segment) => {
      if (typeof segment === "number") return String(segment);
      if (typeof segment === "string" && ALLOWED_SCHEMA_PATH_KEYS.has(segment)) {
        return segment;
      }
      return "<field>";
    })
    .join(".");

  const location = safePath || "root";
  return `${location}: ${issue.code}`;
}

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

    // 4. Invoke LLM Adapter safely (never echo raw adapter err.message)
    let rawResponse: string;
    try {
      rawResponse = await this.adapter.generateReview({
        systemPrompt: prompt.systemPrompt,
        dataMessage: prompt.dataMessage,
      });
    } catch (err: unknown) {
      const rawCode =
        err && typeof err === "object" && "code" in err && typeof (err as any).code === "string"
          ? (err as any).code
          : undefined;

      if (rawCode && Object.prototype.hasOwnProperty.call(SAFE_ADAPTER_ERROR_MESSAGES, rawCode)) {
        throw new TriageServiceError(rawCode, SAFE_ADAPTER_ERROR_MESSAGES[rawCode]);
      }

      throw new TriageServiceError(
        "LLM_PROVIDER_ERROR",
        "LLM candidate review failed due to an upstream provider error."
      );
    }

    // 5. Bounds check on response size
    if (typeof rawResponse !== "string" || rawResponse.length > MAX_MODEL_RESPONSE_CHARS) {
      throw new TriageServiceError(
        "OUTPUT_TOO_LARGE",
        `Model review response exceeded maximum allowed length (${MAX_MODEL_RESPONSE_CHARS} characters).`
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

    // 7. Strict Zod schema validation (never echo model keys or values in issues)
    const zodResult = ModelTriageOutputSchema.safeParse(parsedJson);
    if (!zodResult.success) {
      const issueDetails = zodResult.error.issues.map(formatSafeZodIssue);
      throw new TriageServiceError(
        "INVALID_MODEL_OUTPUT",
        "Model review output failed strict schema validation.",
        issueDetails
      );
    }

    // 8. Semantic validation & Reference checks (never echo untrusted model strings)
    const candidateMap = new Map(prompt.preparedCandidates.map((p) => [p.candidateId, p]));
    const assessmentMap = new Map<string, CandidateAssessment>();

    for (let idx = 0; idx < zodResult.data.assessments.length; idx++) {
      const assessment = zodResult.data.assessments[idx];

      // Check candidateId existence
      const prep = candidateMap.get(assessment.candidateId);
      if (!prep) {
        throw new TriageServiceError(
          "UNKNOWN_CANDIDATE_ID",
          "Model assessment references an unknown candidateId.",
          [`assessments.${idx}.candidateId: unknown_candidate_id`]
        );
      }

      // Check for duplicates
      if (assessmentMap.has(assessment.candidateId)) {
        throw new TriageServiceError(
          "DUPLICATE_ASSESSMENT",
          "Model review contains a duplicate assessment for the same candidateId.",
          [`assessments.${idx}.candidateId: duplicate_assessment`]
        );
      }

      // Check evidence references
      for (let refIdx = 0; refIdx < assessment.evidenceReferences.length; refIdx++) {
        const ref = assessment.evidenceReferences[refIdx];
        if (!prep.validEvidenceKeys.has(ref)) {
          throw new TriageServiceError(
            "INVALID_EVIDENCE_REFERENCE",
            "Model assessment references a non-existent evidence key.",
            [`assessments.${idx}.evidenceReferences.${refIdx}: invalid_evidence_reference`]
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
