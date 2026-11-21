/**
 * Schema Validation Test Runner
 * Validates JSON Schema draft 2020-12 schemas, positive fixtures, and negative test cases.
 */

const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ ${message}`);
    totalPassed++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    totalFailed++;
  }
}

function scoresMatchPolicy(payload) {
  return (payload.report?.findings ?? []).every(({ scores, severity }) => {
    const expected = Math.round((4 * scores.exploitability + 3 * scores.exposure + 3 * scores.assetImpact) / 10);
    const expectedSeverity = expected >= 80 ? "CRITICAL" : expected >= 60 ? "HIGH" : expected >= 40 ? "MEDIUM" : "LOW";
    return scores.priorityScore === expected && severity === expectedSeverity;
  });
}

console.log("=== BẮT ĐẦU KIỂM TRA SCHEMA & FIXTURES ===");

// 1. Compile Schemas
console.log("\n[1] Biên dịch Schemas (Draft 2020-12):");
let validateRequest, validateResponse;

try {
  const requestSchemaPath = path.join(__dirname, "../docs/schema/analyze-request.schema.json");
  const requestSchema = JSON.parse(fs.readFileSync(requestSchemaPath, "utf8"));
  validateRequest = ajv.compile(requestSchema);
  assert(typeof validateRequest === "function", "analyze-request.schema.json compiled successfully");
} catch (err) {
  assert(false, `Lỗi compile analyze-request.schema.json: ${err.message}`);
}

try {
  const responseSchemaPath = path.join(__dirname, "../docs/schema/analyze-response.schema.json");
  const responseSchema = JSON.parse(fs.readFileSync(responseSchemaPath, "utf8"));
  validateResponse = ajv.compile(responseSchema);
  assert(typeof validateResponse === "function", "analyze-response.schema.json compiled successfully");
} catch (err) {
  assert(false, `Lỗi compile analyze-response.schema.json: ${err.message}`);
}

// 2. Validate Positive Fixtures
console.log("\n[2] Kiểm tra Positive Fixtures (Bắt buộc phải hợp lệ):");
const fixturesDir = path.join(__dirname, "../docs/schema/fixtures");
const fixtureFiles = [
  "illustrative-integer-source-analysis.json",
  "illustrative-ready-to-attest.json",
  "context-only-response.json",
  "source-with-rpc-error-200.json",
  "address-rpc-error-502.json",
];

for (const file of fixtureFiles) {
  const filePath = path.join(fixturesDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const valid = validateResponse(data);
    if (valid) {
      assert(true, `Fixture hợp lệ: ${file}`);
      assert(scoresMatchPolicy(data), `Điểm và severity của fixture khớp chính sách: ${file}`);
    } else {
      assert(false, `Fixture vi phạm schema: ${file}\n${JSON.stringify(validateResponse.errors, null, 2)}`);
    }
  } catch (err) {
    assert(false, `Lỗi đọc fixture ${file}: ${err.message}`);
  }
}

try {
  const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/mock-data.json"), "utf8"));
  assert(validateResponse(mock), `docs/mock-data.json hợp lệ theo response schema: ${JSON.stringify(validateResponse.errors)}`);
  assert(mock.report?.findings?.every((finding) => finding.scores.assetImpact === 0),
    "Mock không gán Asset Impact từ số dư chưa xác minh");
  assert(scoresMatchPolicy(mock), "Điểm và severity của mock khớp chính sách");
} catch (err) {
  assert(false, `Lỗi kiểm tra docs/mock-data.json: ${err.message}`);
}

// 3. Validate Positive Request & Response Cases
console.log("\n[3] Kiểm tra Positive Request & Response Cases:");
const validRequests = [
  { name: "Source-only request", data: { sourceCode: "pragma solidity 0.8.20; contract A {}" } },
  { name: "Address-only request", data: { contractAddress: "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754" } },
  {
    name: "Source and address request",
    data: {
      sourceCode: "contract B {}",
      contractAddress: "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754",
    },
  },
];

for (const req of validRequests) {
  const valid = validateRequest(req.data);
  assert(valid, `Request hợp lệ: ${req.name}`);
}

const validSourceOnlyResponse = {
  mode: "source-analysis",
  report: {
    targetContract: {
      status: "unspecified",
    },
    summary: {
      totalVulnerabilities: 1,
      criticalCount: 0,
      highCount: 1,
      mediumCount: 0,
      lowCount: 0,
      priorityScore: 60,
    },
    findings: [
      {
        id: "VULN-001",
        ruleId: "RULE-TX-ORIGIN-003",
        title: "Authorization via tx.origin",
        function: "setOwner(address newOwner)",
        visibility: "public",
        modifiers: [],
        scores: {
          exploitability: 75,
          exposure: 100,
          assetImpact: 0,
          priorityScore: 60,
        },
        severity: "HIGH",
        description: "Uses tx.origin",
        evidence: ["require(tx.origin == owner)"],
        confidence: "HIGH",
        patchDiff: "--- diff",
        liveContext: {
          status: "unspecified",
          note: "Source-only analysis, on-chain state not queried",
        },
      },
    ],
  },
  attestation: {
    status: "NOT_ATTESTABLE",
    disabledReason: "Source-only analysis: Target contract address not specified on Avalanche Fuji",
  },
};
assert(validateResponse(validSourceOnlyResponse), "Response hợp lệ: Source-only phân tích thành công và mang trạng thái NOT_ATTESTABLE");

// 4. Negative Request Tests (Bắt buộc phải bị từ chối)
console.log("\n[4] Kiểm tra Negative Request Cases (Phải bị từ chối):");
const negativeRequests = [
  { name: "Empty request object {}", data: {} },
  { name: "Empty sourceCode string", data: { sourceCode: "" } },
  { name: "Whitespace-only sourceCode", data: { sourceCode: "   \n\t  " } },
  { name: "Malformed contractAddress (short)", data: { contractAddress: "0x123" } },
  { name: "Invalid hex contractAddress", data: { contractAddress: "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ" } },
  { name: "Unknown property outside schema", data: { sourceCode: "contract C {}", maliciousPayload: true } },
  { name: "Zero address contractAddress", data: { contractAddress: "0x0000000000000000000000000000000000000000" } },
  { name: "SourceCode exceeding 204,800 characters", data: { sourceCode: "a".repeat(204801) } },
];

for (const neg of negativeRequests) {
  const valid = validateRequest(neg.data);
  assert(!valid, `Bị từ chối chính xác: ${neg.name}`);
}

// 5. Negative Response Tests (Bắt buộc phải bị từ chối)
console.log("\n[5] Kiểm tra Negative Response Cases (Phải bị từ chối):");

// Load valid base fixture to mutate
const baseFixture = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, "illustrative-ready-to-attest.json"), "utf8")
);

const negativeResponses = [
  {
    name: "Decimal priorityScore in summary (84.5)",
    mutate: (f) => {
      f.report.summary.priorityScore = 84.5;
    },
  },
  {
    name: "Decimal priorityScore in finding (95.5)",
    mutate: (f) => {
      f.report.findings[0].scores.priorityScore = 95.5;
    },
  },
  {
    name: "PriorityScore exceeding 100 (105)",
    mutate: (f) => {
      f.report.summary.priorityScore = 105;
    },
  },
  {
    name: "Negative priorityScore (-5)",
    mutate: (f) => {
      f.report.summary.priorityScore = -5;
    },
  },
  {
    name: "Context-only mode incorrectly containing findings",
    mutate: () => ({
      mode: "context-only",
      targetContract: {
        address: "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754",
        network: "Avalanche Fuji Testnet",
        chainId: 43113,
        balanceAvax: "10.0",
        isContract: true,
        bytecodeSize: 100,
        queriedAt: "2026-11-17T16:00:00.000Z",
        status: "available",
      },
      findings: [{ id: "VULN-001" }],
      attestation: { status: "DISABLED", disabledReason: "Reason" },
    }),
  },
  {
    name: "Context-only mode incorrectly containing reportHash",
    mutate: () => ({
      mode: "context-only",
      targetContract: {
        address: "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754",
        network: "Avalanche Fuji Testnet",
        chainId: 43113,
        balanceAvax: "10.0",
        isContract: true,
        bytecodeSize: 100,
        queriedAt: "2026-11-17T16:00:00.000Z",
        status: "available",
      },
      attestation: {
        status: "DISABLED",
        disabledReason: "Address-only request",
        reportHash: "0xd3f8c4e58b1086e3fdf7183e29f52f4167e43697921a8f98c76fa968e734bc1a",
      },
    }),
  },
  {
    name: "READY_TO_ATTEST missing targetContract",
    mutate: (f) => {
      delete f.report.targetContract;
    },
  },
  {
    name: "READY_TO_ATTEST missing address in targetContract",
    mutate: (f) => {
      delete f.report.targetContract.address;
    },
  },
  {
    name: "READY_TO_ATTEST missing reportHash",
    mutate: (f) => {
      delete f.attestation.reportHash;
    },
  },
  {
    name: "READY_TO_ATTEST with bytes32(0) all-zero reportHash",
    mutate: (f) => {
      f.attestation.reportHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    },
  },
  {
    name: "READY_TO_ATTEST with zero targetContract address",
    mutate: (f) => {
      f.report.targetContract.address = "0x0000000000000000000000000000000000000000";
    },
  },
  {
    name: "Invalid date-time format for queriedAt",
    mutate: (f) => {
      f.report.queriedAt = "2026-99-99 not-a-timestamp";
    },
  },
  {
    name: "Negative vulnerability count (-1)",
    mutate: (f) => {
      f.report.summary.totalVulnerabilities = -1;
    },
  },
  {
    name: "Non-Fuji network (Ethereum Mainnet)",
    mutate: (f) => {
      f.report.targetContract.network = "Ethereum Mainnet";
    },
  },
  {
    name: "Extra property outside schema in root response",
    mutate: (f) => {
      f.maliciousInjectedField = true;
    },
  },
];

for (const neg of negativeResponses) {
  const cloned = JSON.parse(JSON.stringify(baseFixture));
  const mutated = neg.mutate(cloned) || cloned;
  const valid = validateResponse(mutated);
  assert(!valid, `Bị từ chối chính xác: ${neg.name}`);
}

console.log("\n=== TỔNG KẾT KIỂM TRA ===");
console.log(`Số ca kiểm thử đạt: ${totalPassed}`);
console.log(`Số ca kiểm thử hỏng: ${totalFailed}`);

if (totalFailed > 0) {
  console.error("❌ CÓ CA KIỂM THỬ THẤT BẠI!");
  process.exit(1);
} else {
  console.log("✅ TẤT CẢ CÁC KIỂM TRA SCHEMA & FIXTURES ĐÃ VƯỢT QUA!");
  process.exit(0);
}
