/**
 * JSON Schema Loading & Validation for /api/analyze
 * Compiles schemas once on application creation.
 * Enforces strict input validation without coercion or secret leakage.
 */

import fs from "node:fs";
import path from "node:path";
import Ajv2020, { ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

export interface SafeValidationError {
  path: string;
  message: string;
}

export interface RequestValidationResult {
  valid: boolean;
  isZeroAddress?: boolean;
  issues?: SafeValidationError[];
}

export function resolveSchemaPath(filename: string): string {
  const candidates = [
    // 1. Production bundle / local dist schema directory
    path.resolve(__dirname, "../schema", filename),
    path.resolve(__dirname, "./schema", filename),
    // 2. Monorepo / repo root relative to src or dist
    path.resolve(__dirname, "../../docs/schema", filename),
    path.resolve(__dirname, "../../../docs/schema", filename),
    // 3. Fallback relative to process.cwd()
    path.resolve(process.cwd(), "docs/schema", filename),
    path.resolve(process.cwd(), "../docs/schema", filename),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Schema file not found: ${filename}. Checked: ${candidates.join(", ")}`);
}

export function loadJsonSchema(filename: string): Record<string, unknown> {
  const resolved = resolveSchemaPath(filename);
  const content = fs.readFileSync(resolved, "utf8");
  return JSON.parse(content);
}

export function createRequestValidator(): (data: unknown) => RequestValidationResult {
  const schema = loadJsonSchema("analyze-request.schema.json");
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  addFormats(ajv);

  const validate = ajv.compile(schema);

  return (data: unknown): RequestValidationResult => {
    // 1. Check for zero address specifically
    if (
      typeof data === "object" &&
      data !== null &&
      "contractAddress" in data &&
      typeof (data as any).contractAddress === "string" &&
      /^0x0{40}$/i.test((data as any).contractAddress.trim())
    ) {
      return {
        valid: false,
        isZeroAddress: true,
        issues: [
          {
            path: "/contractAddress",
            message: "Contract address cannot be the zero address",
          },
        ],
      };
    }

    // 2. Schema validation
    const valid = validate(data);
    if (valid) {
      return { valid: true };
    }

    const issues: SafeValidationError[] = (validate.errors || []).map((err) => ({
      path: err.instancePath || "/",
      message: err.message || "Invalid payload structure",
    }));

    return {
      valid: false,
      issues,
    };
  };
}

export function createResponseValidator(): ValidateFunction {
  const schema = loadJsonSchema("analyze-response.schema.json");
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  addFormats(ajv);

  return ajv.compile(schema);
}
