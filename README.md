# 🛡️ AI-Powered Smart Contract Vulnerability Triage on Avalanche

> **Track:** AI Agents & Security  
> **Network:** Avalanche Fuji Testnet · Chain ID 43113

## 🎯 The Problem
Traditional smart contract scanners dump dozens of theoretical warnings, causing severe **alert fatigue**. Developers waste hours investigating false positives while missing the 1-2 critical flaws that can actually drain funds on-chain.

## 💡 Our Solution
Instead of static-only listing, our AI Security Assistant prioritizes vulnerabilities based on **Real-World Risk** by combining three pillars:
1. **Exploitability (40%):** Can this bug be practically triggered?
2. **Exposure (30%):** Is the function publicly callable (`external`/`public`) or restricted (`onlyOwner`/`whenNotPaused`)?
3. **Asset Impact (30%):** The demo shows native AVAX balance as context and marks the asset exposure score as unverified.

$$\text{Priority Score} = (0.4 \times \text{Exploitability}) + (0.3 \times \text{Exposure}) + (0.3 \times \text{Asset Impact})$$

---

## 🔺 Avalanche Integration
- **Fuji RPC:** Reads native balance, deployed code and optional owner/paused state.
- **Fuji attestation:** The browser wallet can record the report hash and integer demo score once a verified registry is configured. See [deployment status](./contracts/DEPLOYED_ADDRESSES.md).

---

## 🏗️ Repository Structure
- `/contracts`: `AvaTriageRegistry.sol`, its ABI and local test fixtures.
- `/backend`: Core Triage Engine (Static/AST parser + Avalanche RPC Context Fetcher + LLM Remediation Generator).
- `/frontend`: Interactive Risk Matrix Dashboard & On-chain Attestation UI.
- `/docs`: Full [System Architecture Document](./docs/ARCHITECTURE.md) and JSON API specifications.

## 🚀 Quick Start
Use Node.js 24 and npm. From the repository root:

```powershell
cd backend
npm ci
npm run dev
```

Open http://localhost:3001 and choose **Thử dữ liệu mẫu**. Click **Phân tích** to run the real static checks on the example source. The dashboard and API are served by the same process.

### Demo behavior (implementation contract)

- An address-only request returns on-chain context, without a vulnerability analysis or `priorityScore`. **Attest on Avalanche Fuji** is disabled for this result by design; this is not a demo error. Bytecode is not equivalent to Solidity source.
- Attestation requires a report with a valid integer score and hash, plus a valid target address and registry configuration. Backend finalizes the score before hashing; the UI uses the saved report snapshot and never reruns analysis to prepare an attestation.
- Static analysis covers the floating pragma and `tx.origin` candidate checks. The report lists checks that are still outside the analyzer's scope.
- Gemini review is optional and requires explicit opt-in for each request. Configure `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` in the backend environment to enable it.
- The demo scoring policy rounds each candidate to the nearest integer, with halves rounded up, and takes the highest candidate as the report score. An empty report cannot be attested.
- See [API examples](./docs/api-examples.md), [deployment and demo instructions](./docs/DEMO.md), and the [implementation plan](./docs/SE_WEB_RPC_IMPLEMENTATION_PLAN.md).
