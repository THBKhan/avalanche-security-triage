import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { keccak256, stringToHex } from "viem";

export function isWellFormedUnicode(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

/** RFC 8785 for JSON values, using ECMAScript serialization and UTF-16 key order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) throw new TypeError("Invalid Unicode in report");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number in report");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Expected a JSON value");
  }
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) =>
    canonicalize(key) + ":" + canonicalize(object[key])
  ).join(",") + "}";
}

export function hashReport(report: unknown) {
  const canonical = canonicalize(report);
  return { canonical, reportHash: keccak256(stringToHex(canonical)) };
}

export interface SnapshotStore {
  save(snapshot: ReturnType<typeof hashReport>): Promise<void>;
}

export function createSnapshotStore(directory: string): SnapshotStore {
  return {
    async save({ canonical, reportHash }) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const destination = path.join(directory, reportHash + ".json");
      const temporary = path.join(directory, randomUUID() + ".tmp");
      try {
        await writeFile(temporary, canonical, { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}
