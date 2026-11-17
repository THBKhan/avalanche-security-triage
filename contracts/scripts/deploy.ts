import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const allowedChains = [31337, 43113]; // Hardhat local & Avalanche Fuji Testnet

  if (!allowedChains.includes(chainId)) {
    throw new Error(
      `Refusing to deploy on unsupported chainId=${chainId}. Allowed: 31337 (local), 43113 (Avalanche Fuji).`
    );
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Deploying AvaTriageRegistry...");
  console.log(`Network: ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} AVAX`);

  if (chainId === 43113 && balance === 0n) {
    throw new Error("Deployer has 0 AVAX on Fuji. Fund deployer via Avalanche Fuji Faucet first.");
  }

  // NOTE: Never deploy test fixtures (VulnerableVaultFixture) to Fuji or Mainnet.
  const Registry = await ethers.getContractFactory("AvaTriageRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const txHash = registry.deploymentTransaction()?.hash ?? "unknown";

  console.log(`AvaTriageRegistry deployed to: ${address}`);
  console.log(`Deployment tx: ${txHash}`);

  if (chainId === 43113) {
    console.log(`Snowtrace Fuji: https://testnet.snowtrace.io/address/${address}`);
  }

  // Export ABI alongside deployment for frontend/backend consumption
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/AvaTriageRegistry.sol/AvaTriageRegistry.json"
  );
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abiDir = path.join(__dirname, "../abi");
    fs.mkdirSync(abiDir, { recursive: true });
    fs.writeFileSync(
      path.join(abiDir, "AvaTriageRegistry.json"),
      JSON.stringify({ contractName: artifact.contractName, abi: artifact.abi }, null, 2)
    );
    console.log("Exported ABI to contracts/abi/AvaTriageRegistry.json");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

