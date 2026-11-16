const fs = require("fs");
const path = require("path");

const artifactPath = path.join(
  __dirname,
  "../artifacts/contracts/AvaTriageRegistry.sol/AvaTriageRegistry.json"
);

if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found. Run `npm run compile` first.");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abiDir = path.join(__dirname, "../abi");
fs.mkdirSync(abiDir, { recursive: true });

const outputPath = path.join(abiDir, "AvaTriageRegistry.json");
fs.writeFileSync(
  outputPath,
  JSON.stringify({ contractName: artifact.contractName, abi: artifact.abi }, null, 2)
);

console.log(`Exported ABI to ${outputPath}`);

