import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalize, createSnapshotStore, hashReport } from "../analysis/snapshot";
import { buildReport, priorityScore } from "../analysis/report";
import { analyzeSoliditySource, CandidateTriageService, MockLlmAdapter } from "../analysis";
import { RpcContextError, type TargetContractContext } from "../rpc/context";
import { createResponseValidator } from "./schema";
import { createSourceReportService } from "./source-report";

const sourceCode = "pragma solidity ^0.8.20; contract Demo {}";
const address = "0x1111111111111111111111111111111111111111";
const registry = "0x2222222222222222222222222222222222222222";
const target: TargetContractContext & { dataSource: "fuji-rpc" } = {
  address, network: "Avalanche Fuji Testnet", chainId: 43113,
  status: "available", balanceAvax: "5", bytecodeSize: 4, isContract: true,
  dataSource: "fuji-rpc",
  queriedAt: "2026-11-20T12:00:00Z",
};
const validate = createResponseValidator();
const mockPotentialIssue = new CandidateTriageService({
  adapter: new MockLlmAdapter(JSON.stringify({ assessments: [{
    candidateId: "cand-0", verdict: "potential-issue", confidence: "MEDIUM",
    explanation: "Pin the compiler version used for builds.", evidenceReferences: ["primary"],
  }] })),
});

test("JCS serializes numbers, strings and keys consistently before hashing", () => {
  assert.equal(
    canonicalize({ z: [-0, 1e30, 333333333.33333329, 0.002], "2": "€\n", "10": "\u000f" }),
    '{"10":"\\u000f","2":"€\\n","z":[0,1e+30,333333333.3333333,0.002]}',
  );
  assert.equal(canonicalize({ "\u{1F600}": 1, "\uFFFD": 2 }), '{"😀":1,"�":2}');
  assert.throws(() => canonicalize("\uD800"));
  assert.throws(() => canonicalize(Infinity));
  assert.equal(hashReport({ b: 1, a: 2 }).reportHash, hashReport({ a: 2, b: 1 }).reportHash);
  assert.notEqual(hashReport({ queriedAt: "A" }).reportHash, hashReport({ queriedAt: "B" }).reportHash);
  assert.equal(priorityScore(4, 3, 0), 3);
});

test("persists exactly the bytes used to hash the displayed report before returning an attestable result", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ava-report-"));
  try {
    const analyze = createSourceReportService({ fetchContext: async () => target }, createSnapshotStore(directory), validate, registry, mockPotentialIssue);
    const { status, body } = await analyze({ sourceCode, contractAddress: address, reviewWithGemini: true });
    const payload = body as any;
    assert.equal(status, 200);
    assert.equal(payload.attestation.status, "READY_TO_ATTEST");
    assert.equal(payload.attestation.registryAddress, registry);
    assert.equal(payload.report.summary.priorityScore, 7);
    assert.equal(payload.report.summary.scoredFindingCount, 1);
    assert.equal(payload.report.findings[0].scores.assetImpact, 0);
    assert.equal(payload.report.targetContract.dataSource, "fuji-rpc");
    assert.equal(payload.report.targetContract.queriedAt, target.queriedAt);
    assert.match(payload.report.scoreExplanation, /report score is 7/);
    const { canonical, reportHash } = hashReport(payload.report);
    assert.equal(payload.attestation.reportHash, reportHash);
    assert.equal(await readFile(path.join(directory, reportHash + ".json"), "utf8"), canonical);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("optional Gemini review preserves static facts, missing RPC stays unavailable, and invalid source is rejected", async () => {
  let writes = 0;
  let invocations = 0;
  const triage = new CandidateTriageService({
    adapter: new MockLlmAdapter(() => {
      invocations++;
      return JSON.stringify({ assessments: [{
        candidateId: "cand-0", verdict: "needs-review", confidence: "MEDIUM",
        explanation: "Confirm the version used for compilation.", evidenceReferences: ["primary"],
      }] });
    }),
  });
  const analyze = createSourceReportService(
    { fetchContext: async () => { throw new RpcContextError("RPC_TIMEOUT", "private error"); } },
    { save: async () => { writes++; } }, validate, registry, triage,
  );
  assert.equal((await analyze({ sourceCode: "contract Broken {" })).status, 400);
  const local = (await analyze({ sourceCode, contractAddress: address })).body as any;
  assert.equal(local.report.targetContract.status, "unavailable");
  assert.equal(local.report.targetContract.dataSource, "fuji-rpc");
  assert.match(local.report.targetContract.attemptedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(local.report.targetContract.queriedAt, undefined);
  assert.equal(local.attestation.status, "NOT_ATTESTABLE");
  assert.equal(invocations, 0);
  const reviewed = (await analyze({ sourceCode, reviewWithGemini: true })).body as any;
  assert.equal(reviewed.report.reviewMode, "gemini");
  assert.equal(reviewed.report.findings[0].review.verdict, "needs-review");
  assert.equal(reviewed.report.summary.priorityScore, 0);
  assert.equal(reviewed.report.summary.scoredFindingCount, 0);
  assert.equal(writes, 2);
  assert.equal(invocations, 1);
});

test("uses only potential-issue findings for the report score and preserves all candidates", async () => {
  const source = "pragma solidity ^0.8.20; contract Demo { address owner; function check() external view { require(tx.origin == owner); } }";
  const analysis = analyzeSoliditySource(source);
  assert.ok(analysis.ok);
  const draft = analysis.draft;
  const highest = draft.candidates.findIndex((candidate) => candidate.ruleId === "RULE-TX-ORIGIN-003");
  const lower = draft.candidates.findIndex((candidate) => candidate.ruleId === "RULE-PRAGMA-006");
  assert.ok(highest >= 0 && lower >= 0);
  const assessment = (index: number, verdict: string) => ({
    candidateId: `cand-${index}`, verdict, confidence: "MEDIUM",
    explanation: "Static observation requires context.", evidenceReferences: ["primary"],
  });
  for (const verdict of ["dismissed", "needs-review", undefined]) {
    const triage = new CandidateTriageService({
      adapter: new MockLlmAdapter(JSON.stringify({ assessments: [
        assessment(lower, "potential-issue"), ...(verdict ? [assessment(highest, verdict)] : []),
      ] })),
    });
    const review = await triage.reviewCandidates({ sourceCode: source, draft });
    const report = buildReport(source, draft, target, review);
    assert.equal(report.findings.length, 2);
    assert.ok(report.findings[0].scores.priorityScore > 7);
    assert.equal(report.summary.priorityScore, 7);
    assert.equal(report.summary.scoredFindingCount, 1);
  }
  const staticReport = buildReport(source, draft, target);
  assert.equal(staticReport.summary.priorityScore, 0);
  assert.equal(staticReport.summary.scoredFindingCount, 0);
});

test("reports without any potential issue remain non-attestable even with registry and deployed target", async () => {
  const analyze = createSourceReportService(
    { fetchContext: async () => target }, { save: async () => {} }, validate, registry,
  );
  const { body } = await analyze({ sourceCode, contractAddress: address });
  const payload = body as any;
  assert.equal(payload.attestation.status, "NOT_ATTESTABLE");
  assert.equal(payload.report.summary.priorityScore, 0);
  assert.equal(payload.report.findings[0].scores.priorityScore, 7);
});

test("the Fuji smoke report stores a labeled zero-score snapshot for the registry only", async () => {
  const writes: ReturnType<typeof hashReport>[] = [];
  const analyze = createSourceReportService(
    { fetchContext: async (requested) => ({ ...target, address: requested }) },
    { save: async (snapshot) => { writes.push(snapshot); } },
    validate, registry,
  );
  const request = { sourceCode: "pragma solidity 0.8.20; contract Demo {}", contractAddress: registry };
  const ordinary = await analyze(request);
  assert.equal((ordinary.body as any).attestation.status, "NOT_ATTESTABLE");
  assert.equal((ordinary.body as any).fujiSmoke, undefined);

  const smoke = await analyze(request, "fuji-smoke");
  assert.equal(smoke.status, 200);
  const payload = smoke.body as any;
  assert.equal(payload.attestation.status, "NOT_ATTESTABLE");
  assert.deepEqual(payload.fujiSmoke, { registryAddress: registry, ipfsUri: "" });
  assert.equal(payload.report.summary.priorityScore, 0);
  assert.ok(payload.report.limitations.some((note: string) => note.startsWith("Fuji smoke test")));
  assert.deepEqual(writes.at(-1), hashReport(payload.report));
  assert.equal(writes.at(-1)?.reportHash, payload.attestation.reportHash);

  const wrongTarget = await analyze({ ...request, contractAddress: address }, "fuji-smoke");
  assert.equal(wrongTarget.status, 502);
  assert.equal(writes.length, 2);
});

test("a failed snapshot write never returns an attestable report", async () => {
  const analyze = createSourceReportService(
    { fetchContext: async () => target },
    { save: async () => { throw new Error("disk full"); } }, validate, registry,
  );
  await assert.rejects(() => analyze({ sourceCode, contractAddress: address }), /disk full/);
});
