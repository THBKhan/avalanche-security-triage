# 🛡️ Security Scoring Matrix: Exploitability & Exposure

> **Owner:** Alexvuong2006 (InfoSec Lead)  
> **Scope:** `/backend/rules/`  
> **Formula:** $\text{Priority Score} = (0.4 \times \text{Exploitability}) + (0.3 \times \text{Exposure}) + (0.3 \times \text{Asset Impact})$

---

## 1. Exploitability Matrix (Weight: 40%, Scale: 0–100)

Measures the technical feasibility of triggering the flaw to cause a concrete security impact (fund loss, unauthorized state change, denial of service).

| Score Range | Tier | Criteria & Required Evidence | Example |
| :---: | :--- | :--- | :--- |
| **90 – 100** | **Trivial / Direct** | Direct, single-transaction or standard-callback exploit path with no privileged preconditions. Concrete code evidence (e.g., external call before state update, missing auth on fund sweep). | `emergencyDrain()` with no `onlyOwner`; `withdraw()` with CEI violation and no `nonReentrant`. |
| **70 – 89** | **Practical / Conditional** | Exploitable under realistic on-chain conditions (e.g., phishing via `tx.origin`, unchecked low-level call return value, flash-loanable spot price). | `require(tx.origin == owner)` in admin setter. |
| **40 – 69** | **Constrained / Complex** | Requires specific contract state, multi-step sequencing, or compromised/malicious semi-trusted role. | Privileged `delegatecall` to mutable address; race condition requiring specific block timing. |
| **15 – 39** | **Low / Hardened** | Mitigated by partial guards (e.g., `nonReentrant`, `whenNotPaused`, bounded values) or limited impact. | Informational gas/logic issue with no fund-loss path. |
| **0 – 14** | **Theoretical / Insufficient Evidence** | Best-practice warning (e.g., floating pragma) or hypothesis lacking concrete code/AST evidence. | `pragma solidity ^0.8.0;` |

---

## 2. Exposure Matrix (Weight: 30%, Scale: 0–100)

Measures who can reach the vulnerable code path and under what contract state constraints.

| Visibility | Access / State Modifiers | Base Exposure | Rationale |
| :--- | :--- | :---: | :--- |
| `external` / `public` | None (unrestricted) | **100** | Any EOA or contract on Avalanche can invoke immediately. |
| `external` / `public` | `whenNotPaused` only | **75** | Publicly callable whenever contract is unpaused (normal operation). |
| `external` / `public` | Custom role / allowlist (e.g., `onlyKeeper`, `onlyMinter`) | **45** | Restricted to a smaller set of addresses; still exposed if role key is compromised. |
| `external` / `public` | `onlyOwner` / `onlyGovernance` / `Timelock` | **20** | High barrier; requires owner/governance compromise or malicious admin. |
| `internal` / `private` | Called only from `onlyOwner` path | **10** | Not directly reachable externally. |
| `Global` (pragma / compiler) | `n/a` | **10** | Not a callable runtime entry point. |

> **Exposure Guard Adjustments:**
> - If a function is `external`/`public` AND has `nonReentrant`, subtract `35` from Reentrancy-specific Exploitability (do not reduce Exposure, as the function is still publicly callable).
> - If a contract is verified as `paused == true` via live RPC state, reduce effective Exposure by `50%` and mark `liveContext.isPaused = true`.

---

## 3. Severity Classification (Priority Score)

| Priority Score | Severity Label | Triage Action |
| :---: | :--- | :--- |
| **80 – 100** | `CRITICAL` | Immediate remediation required before deployment or fund deposit. |
| **60 – 79** | `HIGH` | High-priority fix; verify preconditions and on-chain exposure. |
| **40 – 59** | `MEDIUM` | Schedule fix; assess compensating controls (`onlyOwner`, `whenNotPaused`). |
| **0 – 39** | `LOW` | Informational / best-practice; address during routine cleanup. |

---

## 4. Assumptions & Limitations

1. **Static + Context Boundary:** Static/AST inspection cannot prove arbitrary runtime storage invariants without symbolic execution or fuzzing. Findings without concrete AST/line evidence MUST be marked `INSUFFICIENT_EVIDENCE` rather than asserted as confirmed.
2. **On-Chain Facts vs. Inference:** RPC queries (`eth_getBalance`, `eth_getCode`, `chainId`) represent verifiable **on-chain facts** at a specific timestamp. Exploitability and Exposure scores are **security inferences** derived from source code and rules.
3. **Missing RPC Data:** When a contract is not deployed on Fuji or RPC is unreachable, `assetImpact` MUST be marked as unavailable (`onChainDataAvailable: false`) and the report must clearly state that Asset Impact is unverified or defaulted.
4. **Human-in-the-Loop:** AI-generated diff patches are recommendations only and MUST be reviewed and tested by a human engineer before deployment.

