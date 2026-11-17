/**
 * AST Node Formatting and Source Slicing Helpers
 */

import { SourceLocation } from "./types";

/**
 * Format a Solidity AST TypeName node into a clean string representation.
 */
export function formatTypeName(node: any): string {
  if (!node) return "unknown";

  switch (node.type) {
    case "ElementaryTypeName": {
      if (node.name === "address" && node.stateMutability === "payable") {
        return "address payable";
      }
      return node.name || "unknown";
    }

    case "UserDefinedTypeName": {
      return node.namePath || "unknown";
    }

    case "ArrayTypeName": {
      const base = formatTypeName(node.baseTypeName);
      const length = node.length ? formatExpression(node.length) : "";
      return `${base}[${length}]`;
    }

    case "Mapping": {
      const key = formatTypeName(node.keyType);
      const val = formatTypeName(node.valueType);
      return `mapping(${key} => ${val})`;
    }

    case "FunctionTypeName": {
      const paramTypes = Array.isArray(node.parameterTypes)
        ? node.parameterTypes.map((p: any) => formatTypeName(p.typeName)).join(", ")
        : "";
      return `function(${paramTypes})`;
    }

    default:
      return node.name || node.type || "unknown";
  }
}

/**
 * Format simple expression nodes into string representation (e.g. for array length).
 */
export function formatExpression(node: any): string {
  if (!node) return "";
  if (node.type === "NumberLiteral") return String(node.number);
  if (node.type === "Identifier") return node.name;
  return "";
}

/**
 * Extract human-readable line span string (e.g. "L12" or "L12-L15").
 */
export function formatLineSpan(loc?: SourceLocation | null): string {
  if (!loc || !loc.start) return "L?";
  const startLine = loc.start.line;
  const endLine = loc.end?.line ?? startLine;
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
}

/**
 * Extract exact code snippet from sourceCode using AST [start, end] range.
 * Note: @solidity-parser/parser AST ranges are [inclusiveStart, inclusiveEnd].
 */
export function extractSnippet(sourceCode: string, range?: [number, number] | null): string {
  if (!range || range.length < 2) return "";
  const [start, end] = range;
  if (start < 0 || end < start || start >= sourceCode.length) return "";
  return sourceCode.slice(start, end + 1);
}
