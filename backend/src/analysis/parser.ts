/**
 * Solidity Source & AST Parser
 * Parses Solidity source code in memory without external compiler dependencies.
 * Extracts structural facts (pragmas, imports, contracts, functions, modifiers).
 * Never executes code, never fetches imports over network, never reads filesystem paths.
 */

import { parse as solidityParse } from "@solidity-parser/parser";
import {
  ContractFact,
  ContractKind,
  FunctionFact,
  FunctionKind,
  FunctionParam,
  ImportInfo,
  ParseErrorDetail,
  PragmaInfo,
  SolidityParseError,
  SourceFacts,
} from "./types";
import { formatTypeName } from "./format";
import { isFloatingPragma } from "./rules/pragma";

/**
 * Format function signature from name/kind and parameter types.
 * e.g. "withdraw(uint256)", "emergencyDrain(address payable)", "constructor(address)", "receive()"
 */
function buildFunctionSignature(
  displayName: string,
  kind: FunctionKind,
  params: FunctionParam[]
): string {
  if (kind === "receive") return "receive()";
  if (kind === "fallback") return "fallback()";
  const paramTypes = params.map((p) => p.type).join(",");
  return `${displayName}(${paramTypes})`;
}

/**
 * Map AST FunctionDefinition node into normalized FunctionFact.
 */
function mapFunctionNode(node: any): FunctionFact {
  const isConstructor = Boolean(node.isConstructor);
  const isReceive = Boolean(node.isReceiveEther);
  const isFallback = Boolean(node.isFallback);

  let kind: FunctionKind = "function";
  let displayName = node.name || "anonymous";

  if (isConstructor) {
    kind = "constructor";
    displayName = "constructor";
  } else if (isReceive) {
    kind = "receive";
    displayName = "receive";
  } else if (isFallback) {
    kind = "fallback";
    displayName = "fallback";
  }

  const parameters: FunctionParam[] = Array.isArray(node.parameters)
    ? node.parameters.map((p: any) => ({
        name: p.name || null,
        type: formatTypeName(p.typeName),
      }))
    : [];

  const modifiers: string[] = Array.isArray(node.modifiers)
    ? node.modifiers.map((m: any) => m.name).filter(Boolean)
    : [];

  const rawVisibility = node.visibility || "default";
  const visibility = ["external", "public", "internal", "private", "default"].includes(rawVisibility)
    ? rawVisibility
    : "default";

  const rawState = node.stateMutability;
  const stateMutability = ["pure", "view", "payable"].includes(rawState)
    ? rawState
    : "nonpayable";

  const signature = buildFunctionSignature(displayName, kind, parameters);

  return {
    name: kind === "function" ? node.name : null,
    displayName,
    signature,
    kind,
    visibility,
    stateMutability,
    modifiers,
    parameters,
    location: node.loc,
    range: node.range,
  };
}

/**
 * Extract SourceFacts from an AST SourceUnit node.
 */
export function extractFactsFromAST(ast: any): SourceFacts {
  const pragmas: PragmaInfo[] = [];
  const imports: ImportInfo[] = [];
  const contracts: ContractFact[] = [];

  for (const child of ast.children || []) {
    if (child.type === "PragmaDirective") {
      pragmas.push({
        name: child.name,
        value: child.value,
        isFloating: isFloatingPragma(child.value),
        location: child.loc,
        range: child.range,
      });
    } else if (child.type === "ImportDirective") {
      imports.push({
        path: child.path,
        location: child.loc,
        range: child.range,
        unresolved: true,
      });
    } else if (child.type === "ContractDefinition") {
      const kind: ContractKind =
        child.kind === "interface"
          ? "interface"
          : child.kind === "library"
          ? "library"
          : "contract";

      const baseContracts: string[] = Array.isArray(child.baseContracts)
        ? child.baseContracts.map((b: any) => b.baseName?.namePath).filter(Boolean)
        : [];

      const functions: FunctionFact[] = [];
      const declaredModifiers: string[] = [];

      for (const sub of child.subNodes || []) {
        if (sub.type === "FunctionDefinition") {
          functions.push(mapFunctionNode(sub));
        } else if (sub.type === "ModifierDefinition") {
          if (sub.name) {
            declaredModifiers.push(sub.name);
          }
        }
      }

      contracts.push({
        name: child.name,
        kind,
        baseContracts,
        functions,
        modifiers: declaredModifiers,
        location: child.loc,
        range: child.range,
      });
    }
  }

  return {
    pragmas,
    imports,
    contracts,
  };
}

/**
 * Parse Solidity source code safely into AST and extracted facts.
 * Does not throw unhandled exceptions on invalid syntax.
 */
export function safeParseSolidityAST(
  sourceCode: string
): { ok: true; ast: any; facts: SourceFacts } | { ok: false; error: SolidityParseError } {
  try {
    const ast = solidityParse(sourceCode, {
      loc: true,
      range: true,
      tolerant: false,
    });

    const facts = extractFactsFromAST(ast);
    return { ok: true, ast, facts };
  } catch (err: any) {
    const details: ParseErrorDetail[] = [];

    if (Array.isArray(err.errors) && err.errors.length > 0) {
      for (const e of err.errors) {
        details.push({
          message: e.message || String(e),
          line: typeof e.line === "number" ? e.line : undefined,
          column: typeof e.column === "number" ? e.column : undefined,
        });
      }
    } else {
      details.push({
        message: err.message || "Solidity syntax error",
        line: typeof err.line === "number" ? err.line : undefined,
        column: typeof err.column === "number" ? err.column : undefined,
      });
    }

    const primaryMsg = details[0]?.message || "Failed to parse Solidity source";
    return { ok: false, error: new SolidityParseError(primaryMsg, details) };
  }
}

/**
 * Parse Solidity source code directly into SourceFacts.
 * Throws SolidityParseError if source contains syntax errors.
 */
export function parseSoliditySource(sourceCode: string): SourceFacts {
  const result = safeParseSolidityAST(sourceCode);
  if (!result.ok) {
    throw result.error;
  }
  return result.facts;
}
