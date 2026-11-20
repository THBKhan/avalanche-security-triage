/**
 * RULE-TX-ORIGIN-003: Authorization via tx.origin
 * Detects presence of tx.origin in require/if conditional control-flow expressions.
 * Excludes tx.origin == msg.sender (standard EOA check pattern).
 * Excludes string literals, comments, and logging-only conditionals.
 * Reports factual observations without claiming unverified exploitability.
 */

import { visit } from "@solidity-parser/parser";
import { ContractFact, RuleCandidate, SourceLocation } from "../types";
import { formatLineSpan, extractSnippet } from "../format";
import { RULES_CATALOG } from "./catalog";

/**
 * Check if an AST node is a MemberAccess to tx.origin.
 */
export function isTxOrigin(node: any): boolean {
  return (
    Boolean(node) &&
    node.type === "MemberAccess" &&
    node.expression?.type === "Identifier" &&
    node.expression?.name === "tx" &&
    node.memberName === "origin"
  );
}

/**
 * Check if an AST node is a MemberAccess to msg.sender.
 */
export function isMsgSender(node: any): boolean {
  return (
    Boolean(node) &&
    node.type === "MemberAccess" &&
    node.expression?.type === "Identifier" &&
    node.expression?.name === "msg" &&
    node.memberName === "sender"
  );
}

/**
 * Check if a BinaryOperation is an EOA check (tx.origin == msg.sender or !=).
 */
export function isEoaCheck(binOp: any): boolean {
  if (!binOp || binOp.type !== "BinaryOperation") return false;
  if (binOp.operator !== "==" && binOp.operator !== "!=") return false;

  return (
    (isTxOrigin(binOp.left) && isMsgSender(binOp.right)) ||
    (isMsgSender(binOp.left) && isTxOrigin(binOp.right))
  );
}

/**
 * Check if a statement or block consists purely of event emission / logging,
 * with no revert, throw, return, or state mutation.
 */
function isStatementOnlyLogging(stmt: any): boolean {
  if (!stmt) return true;
  if (stmt.type === "EmitStatement") return true;
  if (stmt.type === "Block") {
    if (!Array.isArray(stmt.statements) || stmt.statements.length === 0) return true;
    return stmt.statements.every(isStatementOnlyLogging);
  }
  return false;
}

/**
 * Determine if an IfStatement is purely for logging / event emission.
 * (e.g. `if (tx.origin != address(0)) { emit Seen(); }`)
 */
function isLoggingOnlyIf(node: any): boolean {
  if (!node || node.type !== "IfStatement") return false;
  if (node.falseBody && !isStatementOnlyLogging(node.falseBody)) return false;
  if (!node.trueBody) return false;
  return isStatementOnlyLogging(node.trueBody);
}

interface FoundMatch {
  kind: "binop" | "helper";
  containerLoc: SourceLocation;
  containerRange: [number, number];
  expressionLoc: SourceLocation;
  expressionRange: [number, number];
  expressionSnippet: string;
  containerDesc: string;
}

/**
 * Inspect condition expressions (inside require/assert or IfStatement).
 */
function scanConditionExpression(
  condNode: any,
  containerNode: any,
  containerDesc: string,
  sourceCode: string
): FoundMatch[] {
  const matches: FoundMatch[] = [];

  visit(condNode, {
    BinaryOperation: (binOp: any) => {
      const hasTxOrigin = isTxOrigin(binOp.left) || isTxOrigin(binOp.right);
      if (hasTxOrigin) {
        if (isEoaCheck(binOp)) {
          // Standard EOA check pattern: tx.origin == msg.sender. Excluded per rules-catalog.
          return;
        }

        const binOpSnippet = extractSnippet(sourceCode, binOp.range);

        matches.push({
          kind: "binop",
          containerLoc: containerNode.loc,
          containerRange: containerNode.range,
          expressionLoc: binOp.loc,
          expressionRange: binOp.range,
          expressionSnippet: binOpSnippet,
          containerDesc,
        });
      }
    },
    FunctionCall: (callNode: any) => {
      // Check if tx.origin is passed as an argument to a helper function inside the condition
      if (Array.isArray(callNode.arguments) && callNode.arguments.some(isTxOrigin)) {
        const callSnippet = extractSnippet(sourceCode, callNode.range);

        matches.push({
          kind: "helper",
          containerLoc: containerNode.loc,
          containerRange: containerNode.range,
          expressionLoc: callNode.loc,
          expressionRange: callNode.range,
          expressionSnippet: callSnippet,
          containerDesc,
        });
      }
    },
  });

  return matches;
}

/**
 * Scan a function or modifier AST body for tx.origin conditional checks.
 */
function scanBodyForTxOrigin(bodyNode: any, sourceCode: string): FoundMatch[] {
  if (!bodyNode) return [];
  const matches: FoundMatch[] = [];

  visit(bodyNode, {
    FunctionCall: (node: any) => {
      if (
        node.expression?.type === "Identifier" &&
        (node.expression.name === "require" || node.expression.name === "assert") &&
        Array.isArray(node.arguments) &&
        node.arguments.length > 0
      ) {
        const found = scanConditionExpression(
          node.arguments[0],
          node,
          `${node.expression.name} condition`,
          sourceCode
        );
        matches.push(...found);
      }
    },
    IfStatement: (node: any) => {
      // If the if-statement is purely logging (e.g. only contains emit Seen()), omit it
      if (isLoggingOnlyIf(node)) {
        return;
      }

      if (node.condition) {
        const found = scanConditionExpression(
          node.condition,
          node,
          "if condition",
          sourceCode
        );
        matches.push(...found);
      }
    },
  });

  return matches;
}

/**
 * Check contracts and AST for RULE-TX-ORIGIN-003 candidates.
 * Distinguishes overloaded functions by byte range and reports exact signatures.
 */
export function checkTxOrigin(
  contractAstNodes: any[],
  contractFacts: ContractFact[],
  sourceCode: string
): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  const meta = RULES_CATALOG["RULE-TX-ORIGIN-003"];

  for (const contractAst of contractAstNodes) {
    if (!contractAst || contractAst.type !== "ContractDefinition") continue;

    const contractName = contractAst.name;
    const contractFact = contractFacts.find((c) => c.name === contractName);

    for (const subNode of contractAst.subNodes || []) {
      const isFunction = subNode.type === "FunctionDefinition";
      const isModifier = subNode.type === "ModifierDefinition";

      if (isFunction || isModifier) {
        let functionName: string;
        let signature: string;
        let visibility: "external" | "public" | "internal" | "private" | "default" | "n/a";
        let modifiers: string[] = [];
        let hasDefaultVisibility = false;

        if (isModifier) {
          functionName = `modifier:${subNode.name}`;
          signature = `modifier:${subNode.name}`;
          visibility = "n/a";
          modifiers = [];
        } else {
          // Match EXACT FunctionFact by byte range to prevent overload collision
          const matchingFnFact = contractFact?.functions.find(
            (f) => f.range[0] === subNode.range[0] && f.range[1] === subNode.range[1]
          );

          signature =
            matchingFnFact?.signature ||
            `${subNode.name || (subNode.isConstructor ? "constructor" : "anonymous")}()`;
          functionName = signature;

          visibility = matchingFnFact?.visibility || subNode.visibility || "default";
          modifiers = matchingFnFact?.modifiers ? [...matchingFnFact.modifiers] : [];
          hasDefaultVisibility = visibility === "default";
        }

        const matches = scanBodyForTxOrigin(subNode.body, sourceCode);

        for (const match of matches) {
          // Single source of truth for primary evidence: containerNode
          const snippet = extractSnippet(sourceCode, match.containerRange);
          const lines = formatLineSpan(match.containerLoc);
          const isHelper = match.kind === "helper";

          const reasoning = isHelper
            ? `Observed tx.origin passed to helper call ('${match.expressionSnippet}') inside conditional check. Authorization intent requires verification.`
            : `Observed tx.origin in conditional expression ('${match.expressionSnippet}'). Static AST confirms tx.origin in control flow; authorization intent and exploitability require verification.`;

          const limitations: string[] = [
            "Static AST observation confirms tx.origin in conditional control flow; does not prove whether the check is intended for authorization, access control, or logging.",
            "Vulnerability exploitability (e.g. phishing or unauthorized call) requires semantic review of surrounding business logic.",
          ];

          if (isHelper) {
            limitations.push(
              "Helper function internals not resolved; manual or AI triage required to verify if helper enforces access control."
            );
          }

          if (hasDefaultVisibility) {
            limitations.push(
              "Function visibility is not explicitly declared (default in AST); semantic visibility depends on Solidity compiler version."
            );
          }

          candidates.push({
            ruleId: meta.id,
            title: meta.title,
            swc: meta.swc,
            target: {
              contractName,
              functionName,
              signature,
              kind: isModifier ? "modifier" : "function",
              visibility,
              modifiers,
              isConstructor: Boolean(subNode.isConstructor),
              isFallback: Boolean(subNode.isFallback),
              isReceiveEther: Boolean(subNode.isReceiveEther),
              isModifier,
            },
            evidence: {
              lines,
              snippet,
              reasoning,
              location: match.containerLoc,
              range: match.containerRange,
              expression: {
                lines: formatLineSpan(match.expressionLoc),
                snippet: match.expressionSnippet,
                location: match.expressionLoc,
                range: match.expressionRange,
              },
            },
            confidence: isHelper ? "LOW" : "MEDIUM",
            limitations,
          });
        }
      }
    }
  }

  return candidates;
}
