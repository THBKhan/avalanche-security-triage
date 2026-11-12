# 🧠 Backend Triage Engine (`/backend`)

## Role 2: Static Analysis + Avalanche RPC + AI Triage

This folder contains the core prioritization engine:

1. **AST & Code Parser**: Extracts functions, modifiers, visibility, and external call patterns.
2. **Avalanche RPC Client**: Queries Avalanche C-Chain / Fuji RPC (`https://api.avax-test.network/ext/bc/C/rpc`) for real-time TVL and state variables.
3. **AI Exploit & Remediation Agent**: Prompts LLM with contract code + live chain state to assess exploitability and generate patches.
4. **Tri-Pillar Score Calculator**: Computes final priority scores based on Exploitability (40%), Exposure (30%), and Asset Impact (30%).

### Branch
Work on this module in branch:
```bash
git checkout -b feat/backend-engine
```
