/**
 * Automatically syncs JSON Schemas, Rules Catalog, and Prompt Templates
 * into backend/dist/ upon build to ensure standalone deployment and dist execution.
 * Fails fast with exit code 1 if any mandatory resource is missing.
 */

const fs = require("fs");
const path = require("path");

// 1. Sync JSON Schemas (docs/schema -> dist/schema)
const sourceDir = path.resolve(__dirname, "../../docs/schema");
const targetDir = path.resolve(__dirname, "../dist/schema");

if (!fs.existsSync(sourceDir)) {
  console.error(`[copy-schemas] Mandatory source directory not found: ${sourceDir}`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith(".schema.json"));
for (const file of files) {
  const src = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  fs.copyFileSync(src, dest);
  console.log(`[copy-schemas] Synchronized schema: ${file} -> dist/schema/${file}`);
}

// 2. Sync Rules Catalog & Prompt Templates (rules/ -> dist/rules/)
const rulesTargetDir = path.resolve(__dirname, "../dist/rules");
if (!fs.existsSync(rulesTargetDir)) {
  fs.mkdirSync(rulesTargetDir, { recursive: true });
}

const mandatoryRuleFiles = ["rules-catalog.json", "candidate_review_prompt.txt"];

for (const fileName of mandatoryRuleFiles) {
  const src = path.resolve(__dirname, "../rules", fileName);
  if (!fs.existsSync(src)) {
    console.error(`[copy-schemas] Mandatory resource missing: ${src}`);
    process.exit(1);
  }
  const dest = path.join(rulesTargetDir, fileName);
  fs.copyFileSync(src, dest);
  console.log(`[copy-schemas] Synchronized resource: ${fileName} -> dist/rules/${fileName}`);
}
