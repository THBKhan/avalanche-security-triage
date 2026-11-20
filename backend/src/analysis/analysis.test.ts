/**
 * Comprehensive Unit Tests for Solidity Source & AST Analysis
 * Verifies parsing, facts extraction, line/column mapping, CRLF/LF handling,
 * error management, rule evidence extraction, and invariant guarantees.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  analyzeSoliditySource,
  parseSoliditySource,
  safeParseSolidityAST,
  SolidityParseError,
  isFloatingPragma,
  formatLineSpan,
  extractSnippet,
  loadRulesCatalog,
  resolveRulesCatalogPath,
  RULES_CATALOG,
  RuleCandidate,
} from "./index";

/**
 * Invariant verification helper:
 * For every candidate, source.slice(range[0], range[1] + 1) MUST strictly equal snippet.
 * If expression is provided, source.slice(exprRange[0], exprRange[1] + 1) MUST strictly equal exprSnippet.
 */
function assertEvidenceInvariants(sourceCode: string, candidates: RuleCandidate[]) {
  for (const c of candidates) {
    const primarySlice = sourceCode.slice(c.evidence.range[0], c.evidence.range[1] + 1);
    assert.equal(
      primarySlice,
      c.evidence.snippet,
      `[Invariant Violation] Rule ${c.ruleId} primary snippet does not match source.slice at range [${c.evidence.range[0]}, ${c.evidence.range[1]}]`
    );

    if (c.evidence.expression) {
      const exprSlice = sourceCode.slice(
        c.evidence.expression.range[0],
        c.evidence.expression.range[1] + 1
      );
      assert.equal(
        exprSlice,
        c.evidence.expression.snippet,
        `[Invariant Violation] Rule ${c.ruleId} expression snippet does not match source.slice at range [${c.evidence.expression.range[0]}, ${c.evidence.expression.range[1]}]`
      );
    }
  }
}

describe("Solidity Analysis Module", () => {
  describe("Helper Functions", () => {
    it("isFloatingPragma correctly categorizes version ranges vs locked versions", () => {
      // Floating / Range
      assert.equal(isFloatingPragma("^0.8.0"), true);
      assert.equal(isFloatingPragma(">=0.8.0 <0.9.0"), true);
      assert.equal(isFloatingPragma(">=0.8.20"), true);
      assert.equal(isFloatingPragma(">0.8.0"), true);
      assert.equal(isFloatingPragma("~0.8.0"), true);
      assert.equal(isFloatingPragma("0.8.0 - 0.8.20"), true);

      // Locked
      assert.equal(isFloatingPragma("0.8.20"), false);
      assert.equal(isFloatingPragma("=0.8.20"), false);
      assert.equal(isFloatingPragma("0.8.0"), false);
      assert.equal(isFloatingPragma("0.7.6"), false);
    });

    it("formatLineSpan produces correct span notation", () => {
      assert.equal(
        formatLineSpan({ start: { line: 5, column: 0 }, end: { line: 5, column: 20 } }),
        "L5"
      );
      assert.equal(
        formatLineSpan({ start: { line: 10, column: 2 }, end: { line: 18, column: 5 } }),
        "L10-L18"
      );
      assert.equal(formatLineSpan(null), "L?");
    });

    it("extractSnippet handles slice bounds cleanly", () => {
      const code = "contract Foo { uint256 a; }";
      assert.equal(extractSnippet(code, [0, 11]), "contract Foo");
      assert.equal(extractSnippet(code, [15, 23]), "uint256 a");
      assert.equal(extractSnippet(code, null), "");
      assert.equal(extractSnippet(code, [50, 60]), "");
    });
  });

  describe("Rules Catalog Single Source of Truth", () => {
    it("loads metadata dynamically from backend/rules/rules-catalog.json", () => {
      assert.ok(RULES_CATALOG);
      const ruleIds = Object.keys(RULES_CATALOG);
      assert.equal(ruleIds.length, 6);

      // Every rule has necessary metadata
      for (const id of ruleIds) {
        const r = RULES_CATALOG[id];
        assert.ok(r.id.startsWith("RULE-"));
        assert.ok(r.swc.startsWith("SWC-"));
        assert.ok(r.title.length > 0);
        assert.equal(typeof r.defaultExploitability, "number");
        assert.ok(Array.isArray(r.requiredEvidence));
      }
    });

    it("resolveRulesCatalogPath locates rules-catalog.json without relying solely on process.cwd()", () => {
      const resolved = resolveRulesCatalogPath();
      assert.ok(fs.existsSync(resolved));
      assert.ok(resolved.endsWith("rules-catalog.json"));
    });

    it("loadRulesCatalog rejects invalid JSON or malformed catalog files", () => {
      const tempPath = path.resolve(__dirname, "temp-invalid-catalog.json");
      fs.writeFileSync(tempPath, JSON.stringify({ invalid: true }));
      try {
        assert.throws(() => loadRulesCatalog(tempPath), /missing 'rules' array/);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });
  });

  describe("AST Parsing & Fact Extraction", () => {
    it("parses valid Solidity contract with multiple entities (contract, interface, library)", () => {
      const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.20;

        interface IVault {
            function deposit() external payable;
        }

        library SafeMath {
            function add(uint256 a, uint256 b) internal pure returns (uint256) {
                return a + b;
            }
        }

        contract Vault is IVault {
            uint256 public total;

            function deposit() external payable override {
                total += msg.value;
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { sourceFacts } = result.draft;
      assert.equal(sourceFacts.pragmas.length, 1);
      assert.equal(sourceFacts.pragmas[0].name, "solidity");
      assert.equal(sourceFacts.pragmas[0].value, "0.8.20");
      assert.equal(sourceFacts.pragmas[0].isFloating, false);

      assert.equal(sourceFacts.contracts.length, 3);

      const iface = sourceFacts.contracts.find((c) => c.name === "IVault");
      assert.ok(iface);
      assert.equal(iface.kind, "interface");
      assert.equal(iface.functions.length, 1);
      assert.equal(iface.functions[0].signature, "deposit()");
      assert.equal(iface.functions[0].visibility, "external");
      assert.equal(iface.functions[0].stateMutability, "payable");

      const lib = sourceFacts.contracts.find((c) => c.name === "SafeMath");
      assert.ok(lib);
      assert.equal(lib.kind, "library");
      assert.equal(lib.functions.length, 1);
      assert.equal(lib.functions[0].signature, "add(uint256,uint256)");
      assert.equal(lib.functions[0].visibility, "internal");
      assert.equal(lib.functions[0].stateMutability, "pure");

      const contract = sourceFacts.contracts.find((c) => c.name === "Vault");
      assert.ok(contract);
      assert.equal(contract.kind, "contract");
      assert.deepEqual(contract.baseContracts, ["IVault"]);
      assert.equal(contract.functions.length, 1);
      assert.equal(contract.functions[0].signature, "deposit()");
    });

    it("correctly identifies constructor, receive, fallback, and overloaded functions", () => {
      const source = `
        contract SpecialFns {
            uint256 public fee;

            constructor(uint256 _fee) {
                fee = _fee;
            }

            receive() external payable {}

            fallback() external payable {}

            function transfer(address to, uint256 amount) external {}

            function transfer(address to, uint256 amount, bytes calldata data) external {}
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const contract = result.draft.sourceFacts.contracts[0];
      assert.ok(contract);
      assert.equal(contract.functions.length, 5);

      const ctor = contract.functions.find((f) => f.kind === "constructor");
      assert.ok(ctor);
      assert.equal(ctor.displayName, "constructor");
      assert.equal(ctor.signature, "constructor(uint256)");
      assert.equal(ctor.parameters.length, 1);
      assert.equal(ctor.parameters[0].name, "_fee");
      assert.equal(ctor.parameters[0].type, "uint256");

      const receiveFn = contract.functions.find((f) => f.kind === "receive");
      assert.ok(receiveFn);
      assert.equal(receiveFn.displayName, "receive");
      assert.equal(receiveFn.signature, "receive()");
      assert.equal(receiveFn.stateMutability, "payable");
      assert.equal(receiveFn.visibility, "external");

      const fallbackFn = contract.functions.find((f) => f.kind === "fallback");
      assert.ok(fallbackFn);
      assert.equal(fallbackFn.displayName, "fallback");
      assert.equal(fallbackFn.signature, "fallback()");
      assert.equal(fallbackFn.stateMutability, "payable");
      assert.equal(fallbackFn.visibility, "external");

      const overloads = contract.functions.filter((f) => f.name === "transfer");
      assert.equal(overloads.length, 2);
      assert.equal(overloads[0].signature, "transfer(address,uint256)");
      assert.equal(overloads[1].signature, "transfer(address,uint256,bytes)");
    });

    it("preserves exact line, column, and range mapping for LF and CRLF line endings", () => {
      // LF source
      const lfSource = "pragma solidity ^0.8.0;\ncontract LFContract {\n    function ping() external {}\n}";
      const lfResult = analyzeSoliditySource(lfSource);
      assert.equal(lfResult.ok, true);
      if (!lfResult.ok) return;

      const lfFn = lfResult.draft.sourceFacts.contracts[0].functions[0];
      assert.equal(lfFn.location.start.line, 3);
      assert.equal(extractSnippet(lfSource, lfFn.range), "function ping() external {}");

      // CRLF source
      const crlfSource = "pragma solidity ^0.8.0;\r\ncontract CRLFContract {\r\n    function ping() external {}\r\n}";
      const crlfResult = analyzeSoliditySource(crlfSource);
      assert.equal(crlfResult.ok, true);
      if (!crlfResult.ok) return;

      const crlfFn = crlfResult.draft.sourceFacts.contracts[0].functions[0];
      assert.equal(crlfFn.location.start.line, 3);
      assert.equal(extractSnippet(crlfSource, crlfFn.range), "function ping() external {}");
    });

    it("handles Unicode characters and comments without shifting token positions", () => {
      const source = `// Tiếng Việt có dấu: Kiểm tra bảo mật Hợp đồng thông minh \u{1F512}
pragma solidity 0.8.20;

contract UnicodeTest {
    string public note = "Chào thế giới";
    function check() external pure returns (bool) {
        return true;
    }
}`;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const pragma = result.draft.sourceFacts.pragmas[0];
      assert.equal(pragma.location.start.line, 2);
      assert.equal(extractSnippet(source, pragma.range), "pragma solidity 0.8.20;");

      const fn = result.draft.sourceFacts.contracts[0].functions[0];
      assert.equal(fn.name, "check");
      assert.equal(fn.location.start.line, 6);
    });

    it("records unresolved imports in limitations", () => {
      const source = `
        pragma solidity 0.8.20;
        import "./interfaces/IVault.sol";
        import "@openzeppelin/contracts/access/Ownable.sol";

        contract MyVault {}
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { imports } = result.draft.sourceFacts;
      assert.equal(imports.length, 2);
      assert.equal(imports[0].path, "./interfaces/IVault.sol");
      assert.equal(imports[0].unresolved, true);
      assert.equal(imports[1].path, "@openzeppelin/contracts/access/Ownable.sol");

      const limitations = result.draft.limitations;
      assert.ok(
        limitations.some((l) => l.includes("./interfaces/IVault.sol")),
        "Expected limitation mentioning ./interfaces/IVault.sol"
      );
      assert.ok(
        limitations.some((l) => l.includes("@openzeppelin/contracts/access/Ownable.sol")),
        "Expected limitation mentioning OpenZeppelin Ownable.sol"
      );
    });
  });

  describe("Syntax Error Management", () => {
    it("returns structured syntax error without throwing or crashing on invalid Solidity", () => {
      const invalidSource = "contract Broken { function ( }";
      const result = analyzeSoliditySource(invalidSource);

      assert.equal(result.ok, false);
      if (result.ok) return;

      assert.equal(result.error.code, "SYNTAX_ERROR");
      assert.ok(typeof result.error.message === "string" && result.error.message.length > 0);
      assert.ok(Array.isArray(result.error.details));
      assert.ok(result.error.details.length > 0);
    });

    it("safeParseSolidityAST captures line and column on syntax errors", () => {
      const broken = "contract MissingBrace {";
      const res = safeParseSolidityAST(broken);

      assert.equal(res.ok, false);
      if (res.ok) return;

      assert.ok(res.error instanceof SolidityParseError);
      assert.equal(typeof res.error.line, "number");
      assert.equal(typeof res.error.column, "number");
      assert.ok(res.error.errors.length > 0);
    });

    it("parseSoliditySource throws structured SolidityParseError when directly invoked", () => {
      assert.throws(
        () => parseSoliditySource("contract BadSyntax {{{"),
        (err: any) => {
          return err instanceof SolidityParseError && err.errors.length > 0;
        }
      );
    });
  });

  describe("Rule Evidence Extraction: RULE-PRAGMA-006", () => {
    it("detects floating pragma (^0.8.0) and generates candidate finding", () => {
      const source = `
        pragma solidity ^0.8.0;
        contract FloatingPragma {
            uint256 public x;
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-PRAGMA-006"
      );
      assert.equal(candidates.length, 1);
      const pragmaCandidate = candidates[0];

      assert.equal(pragmaCandidate.title, "Floating Pragma & Outdated Compiler Version");
      assert.equal(pragmaCandidate.swc, "SWC-103");
      assert.equal(pragmaCandidate.target.functionName, "Global");
      assert.equal(pragmaCandidate.target.visibility, "n/a");
      assert.equal(pragmaCandidate.confidence, "HIGH");
      assert.equal(pragmaCandidate.evidence.lines, "L2");
      assert.equal(pragmaCandidate.evidence.snippet, "pragma solidity ^0.8.0;");
      assert.ok(pragmaCandidate.evidence.reasoning.includes("^0.8.0"));

      // Invariant check
      assertEvidenceInvariants(source, candidates);

      // Must NOT assert compiler CVEs or vulnerabilities
      assert.ok(
        !pragmaCandidate.evidence.reasoning.toLowerCase().includes("vulnerable compiler")
      );
    });

    it("detects range pragma (>=0.8.0 <0.9.0) with invariant check", () => {
      const source = `pragma solidity >=0.8.0 <0.9.0;\ncontract RangeTest {}`;
      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const pragmaCandidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-PRAGMA-006"
      );
      assert.equal(pragmaCandidates.length, 1);
      assert.equal(pragmaCandidates[0].evidence.snippet, "pragma solidity >=0.8.0 <0.9.0;");
      assertEvidenceInvariants(source, pragmaCandidates);
    });

    it("does NOT generate RULE-PRAGMA-006 candidate when pragma is locked (0.8.20)", () => {
      const source = `
        pragma solidity 0.8.20;
        contract LockedPragma {
            uint256 public y;
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const pragmaCandidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-PRAGMA-006"
      );
      assert.equal(pragmaCandidates.length, 0);
    });
  });

  describe("Rule Evidence Extraction: RULE-TX-ORIGIN-003 & Overload Resolution", () => {
    it("Regression 1: distinguishes overloaded functions, keeps separate signatures, visibility, and modifiers", () => {
      const source = `
contract A {
  address owner;
  modifier guarded() { _; }
  function f(uint x) external guarded {
    require(tx.origin == owner);
  }
  function f(address x) public {
    require(tx.origin == owner);
  }
}
      `.trim();

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 2, "Expected exactly 2 candidates for the 2 overloaded functions");

      const [first, second] = candidates;

      // 1. Must have distinct signatures
      assert.notEqual(
        first.target.signature,
        second.target.signature,
        "Signatures of overloaded functions must be distinct"
      );
      assert.equal(first.target.signature, "f(uint)");
      assert.equal(second.target.signature, "f(address)");

      // 2. First function must be external with guarded modifier
      assert.equal(first.target.visibility, "external");
      assert.deepEqual(first.target.modifiers, ["guarded"]);

      // 3. Second function must be public without guarded modifier
      assert.equal(second.target.visibility, "public");
      assert.deepEqual(second.target.modifiers, [], "Second overload f(address) must not inherit guarded");

      // 4. Invariant check on both candidates
      assertEvidenceInvariants(source, candidates);
    });

    it("Regression 2: evidence fields are synchronized to container node with strict invariant check", () => {
      const source = `
        contract InvariantTest {
            address owner;
            function testMultiLine() public {
                require(
                    tx.origin == owner,
                    "Multi-line condition"
                );
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 1);
      assertEvidenceInvariants(source, candidates);

      // Verify lines span matches container multi-line span
      const c = candidates[0];
      assert.ok(c.evidence.lines.includes("-"), `Expected multi-line span, got ${c.evidence.lines}`);
      assert.ok(c.evidence.snippet.startsWith("require("));
      assert.ok(c.evidence.snippet.endsWith(')'));
    });

    it("Regression 3: does NOT flag logging-only if-statement as an authorization vulnerability", () => {
      const source = `
        contract LoggingOnlyTest {
            event Seen();
            function logOnly() external {
                if (tx.origin != address(0)) { emit Seen(); }
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(
        candidates.length,
        0,
        "Logging-only conditional without revert/return should not generate RULE-TX-ORIGIN-003 candidate"
      );
    });

    it("detects tx.origin in if-revert with MEDIUM confidence and factual observation reasoning", () => {
      const source = `
        contract IfAuth {
            address public admin;

            function restricted() public {
                if (tx.origin != admin) revert();
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 1);
      const c = candidates[0];

      assert.equal(c.target.functionName, "restricted()");
      assert.equal(c.target.visibility, "public");
      assert.equal(c.confidence, "MEDIUM");
      assert.equal(c.evidence.lines, "L6");
      assert.equal(c.evidence.snippet, "if (tx.origin != admin) revert();");
      assert.ok(c.evidence.reasoning.includes("Observed tx.origin in conditional expression"));
      assert.ok(c.limitations.some((l) => l.includes("does not prove whether the check is intended for authorization")));

      assertEvidenceInvariants(source, candidates);
    });

    it("detects tx.origin authorization inside modifier", () => {
      const source = `
        contract ModifierAuth {
            address public owner;

            modifier onlyOrigin() {
                require(tx.origin == owner, "Modifier check");
                _;
            }

            function doSomething() external onlyOrigin {}
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].target.functionName, "modifier:onlyOrigin");
      assert.equal(candidates[0].target.isModifier, true);
      assert.equal(candidates[0].target.visibility, "n/a");
      assert.equal(candidates[0].evidence.lines, "L6");

      assertEvidenceInvariants(source, candidates);
    });

    it("excludes tx.origin == msg.sender and msg.sender == tx.origin (EOA checks)", () => {
      const source = `
        contract EoaChecks {
            function eoa1() external {
                require(tx.origin == msg.sender, "Must be EOA");
            }

            function eoa2() external {
                require(msg.sender == tx.origin, "Must be EOA");
            }

            function eoa3() external {
                if (msg.sender != tx.origin) revert();
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 0, "EOA checks must be excluded from RULE-TX-ORIGIN-003");
    });

    it("does NOT trigger false positives for tx.origin in comments, strings, or event logs", () => {
      const source = `
        contract NonAuthUsages {
            event OriginLogged(address sender);

            // require(tx.origin == owner);
            /* multi-line comment: tx.origin != admin */

            function logOnly() external {
                string memory msgText = "Warning: tx.origin == owner is bad";
                emit OriginLogged(tx.origin);
                address reader = tx.origin;
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 0);
    });

    it("flags helper calls with tx.origin as parameter with LOW confidence and limitation note", () => {
      const source = `
        contract HelperCheck {
            function checkUser() external {
                require(isAuthorized(tx.origin));
            }

            function isAuthorized(address a) internal pure returns (bool) {
                return a != address(0);
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].confidence, "LOW");
      assert.ok(
        candidates[0].limitations.some((l) => l.includes("Helper function internals not resolved")),
        "Expected helper limitation note"
      );

      assertEvidenceInvariants(source, candidates);
    });

    it("preserves visibility default and records limitation when function has no visibility keyword", () => {
      const source = `
        contract DefaultVis {
            address owner;
            function foo() {
                require(tx.origin == owner);
            }
        }
      `;

      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const candidates = result.draft.candidates.filter(
        (c) => c.ruleId === "RULE-TX-ORIGIN-003"
      );
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].target.visibility, "default");
      assert.ok(
        candidates[0].limitations.some((l) => l.includes("Function visibility is not explicitly declared")),
        "Expected default visibility limitation note"
      );
      assertEvidenceInvariants(source, candidates);
    });
  });

  describe("Coverage and Unanalyzed Rules Registry", () => {
    it("reports analyzed vs unanalyzed rules matching rules-catalog.json with neutral descriptions", () => {
      const source = `pragma solidity 0.8.20;\ncontract Empty {}`;
      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { coverage } = result.draft;
      assert.deepEqual(coverage.analyzedRules, ["RULE-PRAGMA-006", "RULE-TX-ORIGIN-003"]);
      assert.deepEqual(coverage.unanalyzedRules, [
        "RULE-REENTRANCY-001",
        "RULE-ACCESS-002",
        "RULE-UNCHECKED-CALL-004",
        "RULE-DELEGATECALL-005",
      ]);

      // Every unanalyzed rule has an explicit neutral reason
      for (const ruleId of coverage.unanalyzedRules) {
        assert.ok(
          coverage.notes[ruleId],
          `Missing unanalyzed reason for ${ruleId}`
        );
        assert.ok(
          coverage.notes[ruleId].includes("not implemented in the current static analysis module")
        );
      }
    });

    it("does NOT produce fabricated priorityScore, severity, or reportHash in draft", () => {
      const source = `pragma solidity ^0.8.0;\ncontract Test {}`;
      const result = analyzeSoliditySource(source);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const draft = result.draft as any;
      assert.equal(draft.priorityScore, undefined);
      assert.equal(draft.severity, undefined);
      assert.equal(draft.reportHash, undefined);
      assert.equal(draft.pillarScores, undefined);

      for (const candidate of draft.candidates) {
        assert.equal(candidate.scores, undefined);
        assert.equal(candidate.severity, undefined);
      }
    });
  });

  describe("Real Repository Fixtures Verification", () => {
    it("analyzes VulnerableVaultFixture.sol accurately with invariant checks", () => {
      const fixturePath = path.resolve(
        __dirname,
        "../../../contracts/contracts/fixtures/VulnerableVaultFixture.sol"
      );
      const fixtureSource = fs.readFileSync(fixturePath, "utf-8");

      const result = analyzeSoliditySource(fixtureSource);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { sourceFacts, candidates } = result.draft;

      // Check contract facts
      assert.equal(sourceFacts.contracts.length, 1);
      const contract = sourceFacts.contracts[0];
      assert.equal(contract.name, "VulnerableVaultFixture");

      const fnNames = contract.functions.map((f) => f.displayName);
      assert.ok(fnNames.includes("constructor"));
      assert.ok(fnNames.includes("deposit"));
      assert.ok(fnNames.includes("withdraw"));
      assert.ok(fnNames.includes("emergencyDrain"));
      assert.ok(fnNames.includes("setProtocolFee"));
      assert.ok(fnNames.includes("receive"));

      // Check RULE-PRAGMA-006: line 4 ^0.8.0
      const pragmaCandidate = candidates.find((c) => c.ruleId === "RULE-PRAGMA-006");
      assert.ok(pragmaCandidate, "Expected RULE-PRAGMA-006 on VulnerableVaultFixture");
      assert.equal(pragmaCandidate.evidence.lines, "L4");
      assert.equal(pragmaCandidate.evidence.snippet, "pragma solidity ^0.8.0;");

      // Check RULE-TX-ORIGIN-003: line 67 in setProtocolFee
      const txOriginCandidate = candidates.find((c) => c.ruleId === "RULE-TX-ORIGIN-003");
      assert.ok(txOriginCandidate, "Expected RULE-TX-ORIGIN-003 on VulnerableVaultFixture");
      assert.equal(txOriginCandidate.target.functionName, "setProtocolFee(uint256)");
      assert.equal(txOriginCandidate.target.visibility, "external");
      assert.equal(txOriginCandidate.confidence, "MEDIUM");
      assert.equal(txOriginCandidate.evidence.lines, "L67");
      assert.ok(txOriginCandidate.evidence.snippet.includes("tx.origin == owner"));

      // Strict invariant check across all fixture candidates
      assertEvidenceInvariants(fixtureSource, candidates);
    });

    it("analyzes SafeVaultFixture.sol without false positives on pragma or tx.origin", () => {
      const fixturePath = path.resolve(
        __dirname,
        "../../../contracts/contracts/fixtures/SafeVaultFixture.sol"
      );
      const fixtureSource = fs.readFileSync(fixturePath, "utf-8");

      const result = analyzeSoliditySource(fixtureSource);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { sourceFacts, candidates } = result.draft;

      assert.equal(sourceFacts.contracts.length, 1);
      const contract = sourceFacts.contracts[0];
      assert.equal(contract.name, "SafeVaultFixture");
      assert.deepEqual(contract.modifiers, ["onlyOwner", "whenNotPaused", "nonReentrant"]);

      // Neither RULE-PRAGMA-006 nor RULE-TX-ORIGIN-003 should be triggered
      const pragmaCandidate = candidates.find((c) => c.ruleId === "RULE-PRAGMA-006");
      assert.equal(pragmaCandidate, undefined, "SafeVault has locked 0.8.20 pragma");

      const txOriginCandidate = candidates.find((c) => c.ruleId === "RULE-TX-ORIGIN-003");
      assert.equal(txOriginCandidate, undefined, "SafeVault has no tx.origin");
    });
  });
});
