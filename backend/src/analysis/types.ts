/**
 * Solidity Source & AST Analysis Types
 * Internal data contracts for static facts extraction and rule candidates.
 * Independent of scoring formulas and LLM adapters.
 */

export interface SourceLocation {
  start: {
    line: number;
    column: number;
  };
  end: {
    line: number;
    column: number;
  };
}

export interface PragmaInfo {
  name: string;
  value: string;
  isFloating: boolean;
  location: SourceLocation;
  range: [number, number];
}

export interface ImportInfo {
  path: string;
  location: SourceLocation;
  range: [number, number];
  unresolved: true;
}

export interface FunctionParam {
  name: string | null;
  type: string;
}

export type FunctionKind = "function" | "constructor" | "fallback" | "receive";

export interface FunctionFact {
  name: string | null;
  displayName: string;
  signature: string;
  kind: FunctionKind;
  visibility: "external" | "public" | "internal" | "private" | "default";
  stateMutability: "pure" | "view" | "payable" | "nonpayable";
  modifiers: string[];
  parameters: FunctionParam[];
  location: SourceLocation;
  range: [number, number];
}

export type ContractKind = "contract" | "interface" | "library";

export interface ContractFact {
  name: string;
  kind: ContractKind;
  baseContracts: string[];
  functions: FunctionFact[];
  modifiers: string[];
  location: SourceLocation;
  range: [number, number];
}

export interface SourceFacts {
  pragmas: PragmaInfo[];
  imports: ImportInfo[];
  contracts: ContractFact[];
}

export interface ExpressionEvidence {
  lines: string;
  snippet: string;
  location: SourceLocation;
  range: [number, number];
}

export interface CandidateEvidence {
  lines: string;
  snippet: string;
  reasoning: string;
  location: SourceLocation;
  range: [number, number];
  expression?: ExpressionEvidence;
}

export interface RuleCandidateTarget {
  contractName?: string;
  functionName: string;
  signature?: string;
  kind?: FunctionKind | "modifier";
  visibility: "external" | "public" | "internal" | "private" | "default" | "n/a";
  modifiers: string[];
  isConstructor?: boolean;
  isFallback?: boolean;
  isReceiveEther?: boolean;
  isModifier?: boolean;
}

export interface RuleCandidate {
  ruleId: string;
  title: string;
  swc?: string;
  target: RuleCandidateTarget;
  evidence: CandidateEvidence;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_EVIDENCE";
  limitations: string[];
}

export interface AnalysisCoverage {
  analyzedRules: string[];
  unanalyzedRules: string[];
  notes: Record<string, string>;
}

export interface SourceAnalysisDraft {
  sourceFacts: SourceFacts;
  candidates: RuleCandidate[];
  coverage: AnalysisCoverage;
  limitations: string[];
}

export interface ParseErrorDetail {
  message: string;
  line?: number;
  column?: number;
}

export class SolidityParseError extends Error {
  public readonly errors: ParseErrorDetail[];
  public readonly line?: number;
  public readonly column?: number;

  constructor(message: string, errors: ParseErrorDetail[] = []) {
    super(message);
    this.name = "SolidityParseError";
    this.errors = errors;
    this.line = errors[0]?.line;
    this.column = errors[0]?.column;
  }
}

export type AnalysisResult =
  | {
      ok: true;
      draft: SourceAnalysisDraft;
    }
  | {
      ok: false;
      error: {
        code: "SYNTAX_ERROR";
        message: string;
        line?: number;
        column?: number;
        details: ParseErrorDetail[];
      };
    };
