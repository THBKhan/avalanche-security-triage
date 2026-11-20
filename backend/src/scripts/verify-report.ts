import { readFile } from "node:fs/promises";
import { hashReport } from "../analysis/snapshot";

async function verify() {
  const filename = process.argv[2];
  const expected = process.argv[3];
  if (!filename) {
    console.error("Usage: npm run verify:report -- <report.json> [expectedHash]");
    process.exitCode = 2;
    return;
  }
  const payload = JSON.parse(await readFile(filename, "utf8"));
  const detachedHash = expected ?? payload?.attestation?.reportHash;
  if (typeof detachedHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(detachedHash)) {
    console.error("Provide the expected hash or a downloaded source report.");
    process.exitCode = 2;
    return;
  }
  const { reportHash } = hashReport(payload?.report ?? payload);
  console.log(reportHash === detachedHash.toLowerCase() ? `MATCH ${reportHash}` : "HASH_MISMATCH");
  process.exitCode = reportHash === detachedHash.toLowerCase() ? 0 : 1;
}

void verify().catch(() => {
  console.error("Unable to verify this report file.");
  process.exitCode = 2;
});
