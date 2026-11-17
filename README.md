# 🛡️ AI-Powered Smart Contract Vulnerability Triage on Avalanche

> **Track:** AI Agents & Security  
> **Network:** Avalanche Fuji Testnet / C-Chain Mainnet

## 🎯 The Problem
Traditional smart contract scanners dump dozens of theoretical warnings, causing severe **alert fatigue**. Developers waste hours investigating false positives while missing the 1-2 critical flaws that can actually drain funds on-chain.

## 💡 Our Solution
Instead of static-only listing, our AI Security Assistant prioritizes vulnerabilities based on **Real-World Risk** by combining three pillars:
1. **Exploitability (40%):** Can this bug be practically triggered?
2. **Exposure (30%):** Is the function publicly callable (`external`/`public`) or restricted (`onlyOwner`/`whenNotPaused`)?
3. **Avalanche On-Chain Asset Impact (30%):** Live RPC query to check actual AVAX/Token TVL at risk on Avalanche.

$$\text{Priority Score} = (0.4 \times \text{Exploitability}) + (0.3 \times \text{Exposure}) + (0.3 \times \text{Asset Impact})$$

---

## 🔺 Avalanche Integration
- **Live On-Chain State Reader:** Connects directly to Avalanche C-Chain & Fuji RPC (`https://api.avax-test.network/ext/bc/C/rpc`) to evaluate real-time TVL and contract state variables.
- **On-Chain Security Attestation (Fuji Testnet):** Developers can record verified risk scores and audit hashes on-chain via our deployed Registry Contract.
  - **Registry Contract (Fuji):** `0x... (Sẽ cập nhật sau khi deploy)`
  - **Demo Target Vault (Fuji):** `0x... (Sẽ cập nhật sau khi deploy)`

---

## 🏗️ Repository Structure
- `/contracts`: Solidity smart contracts (`SecurityRegistry.sol`, `VulnerableVault.sol`) deployed on Avalanche Fuji.
- `/backend`: Core Triage Engine (Static/AST parser + Avalanche RPC Context Fetcher + LLM Remediation Generator).
- `/frontend`: Interactive Risk Matrix Dashboard & On-chain Attestation UI.
- `/docs`: Full [System Architecture Document](./docs/ARCHITECTURE.md) and JSON API specifications.

## 🚀 Quick Start
*(Hướng dẫn chạy local sẽ được cập nhật tại đây)*

### Demo behavior (implementation contract)

- An address-only request returns on-chain context, without a vulnerability analysis or `priorityScore`. **Attest on Avalanche Fuji** is disabled for this result by design; this is not a demo error. Bytecode is not equivalent to Solidity source.
- Attestation requires a report with a valid integer score and hash, plus a valid target address and registry configuration. Backend finalizes the score before hashing; the UI uses the saved report snapshot and never reruns analysis to prepare an attestation.
- See the [SE Web & RPC implementation plan](./docs/SE_WEB_RPC_IMPLEMENTATION_PLAN.md) for the agreed workflow and completion checklist. These behaviors describe the implementation requirements; the demo setup is still being documented.
