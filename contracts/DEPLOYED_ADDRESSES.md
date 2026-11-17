# Deployed Contract Addresses

> **Security Policy:** Never commit private keys, seed phrases, or `.env` files to this repository.
> Only `AvaTriageRegistry` is permitted for deployment to Avalanche Fuji Testnet.
> Test fixtures under `contracts/contracts/fixtures/` MUST remain strictly local/isolated.

## Avalanche Fuji Testnet

- **Network:** Avalanche Fuji C-Chain Testnet
- **Chain ID:** `43113`
- **RPC URL:** `https://api.avax-test.network/ext/bc/C/rpc`
- **Explorer:** https://testnet.snowtrace.io/

| Contract | Address | Deployment Tx | Explorer Link | Status |
| :--- | :--- | :--- | :--- | :--- |
| `AvaTriageRegistry` | `Pending deployment` | `Pending` | `https://testnet.snowtrace.io/address/<ADDRESS>` | Ready to deploy |

## How to Deploy to Fuji

1. Copy `contracts/.env.example` to `contracts/.env` and set `DEPLOYER_PRIVATE_KEY` (funded with Fuji test AVAX).
2. Run:
   ```bash
   cd contracts
   npm install
   npm run compile
   npm run deploy:fuji
   ```
3. Update the table above with the deployed contract address, transaction hash, and Snowtrace Fuji link.

