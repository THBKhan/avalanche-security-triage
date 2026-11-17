# 📜 Smart Contracts (`/contracts`)

> **Owner:** Alexvuong2006 (InfoSec Lead)  
> **Branch:** `feat/infosec-contracts-rules`  
> **Target Network:** Avalanche Fuji Testnet (`chainId: 43113`)

## Contents

1. **`contracts/AvaTriageRegistry.sol`**:
   - On-chain attestation registry for Avalanche Fuji.
   - Exposes `recordAttestation(address targetContract, bytes32 reportHash, uint256 priorityScore, string ipfsUri)` with input validation (`ZeroAddress`, `InvalidReportHash`, `InvalidPriorityScore`, `IpfsUriTooLong`, `DuplicateAttestation`).
   - Provides read-only helpers: `totalAttestations()`, `getAttestation(id)`, `getAttestationIdsByTarget(target)`, `getLatestAttestation(target)`.
2. **`contracts/fixtures/` (Local / Isolated Test Fixtures ONLY)**:
   - `VulnerableVaultFixture.sol`: Intentionally vulnerable vault (`withdraw` reentrancy, `emergencyDrain` missing access control, `tx.origin` check, floating pragma) for local testing.
   - `SafeVaultFixture.sol`: Remediated reference vault (`onlyOwner`, `whenNotPaused`, `nonReentrant`, CEI pattern).
   - `ReentrancyAttackerFixture.sol`: Local test harness for verifying reentrancy exploitability.
   - **Security Rule:** Fixtures MUST NEVER be deployed to Fuji or Mainnet, and MUST NEVER be funded with real or testnet AVAX.
3. **`abi/AvaTriageRegistry.json`**:
   - Exported ABI for `/frontend` (Wagmi/RainbowKit) and `/backend` integration.
4. **`DEPLOYED_ADDRESSES.md`**:
   - Tracks deployed registry address, chain ID, and Snowtrace Fuji explorer link.

## Commands

```bash
cd contracts
npm install
npm run compile
npm test
npm run export-abi
```

## Deploying `AvaTriageRegistry` to Avalanche Fuji

1. Copy `.env.example` to `.env` and fill in `DEPLOYER_PRIVATE_KEY` (never commit `.env`).
2. Run `npm run deploy:fuji`.
3. Record the deployed address and transaction hash in [DEPLOYED_ADDRESSES.md](./DEPLOYED_ADDRESSES.md).
