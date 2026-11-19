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
| `AvaTriageRegistry` | `0xB94F639079de5b1D3AF27f18F09b417f04742107` | [Deployment transaction](https://testnet.snowtrace.io/tx/0xd813393bfcd1d9acdedde9bd5d82ced1312c657d20ba473cdef1380174254585) | [Registry on Fuji](https://testnet.snowtrace.io/address/0xB94F639079de5b1D3AF27f18F09b417f04742107) | Deployed and verified at block `61343895` |

The Fuji receipt confirms successful contract creation. The deployed runtime bytecode matches the local Solidity 0.8.20 build of `AvaTriageRegistry`.

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

