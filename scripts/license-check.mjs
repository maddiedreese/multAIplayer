import { readFileSync } from "node:fs";
import { join } from "node:path";

const expectedProjectLicense = "Apache-2.0";
const projectPackagePaths = [
  "package.json",
  "apps/desktop/package.json",
  "apps/relay/package.json",
  "packages/protocol/package.json",
  "packages/crypto/package.json",
  "packages/codex/package.json",
  "packages/git/package.json",
  "packages/github/package.json"
];
const internalPackagePrefix = "@multaiplayer/";
const deniedLicensePattern = /\b(AGPL|GPL|LGPL|SSPL|BUSL|Elastic)\b/i;

const failures = [];

for (const packagePath of projectPackagePaths) {
  const pkg = readJson(packagePath);
  if (pkg.license !== expectedProjectLicense) {
    failures.push(`${packagePath} must declare license ${expectedProjectLicense}`);
  }
}

const lock = readJson("package-lock.json");
for (const [packagePath, pkg] of Object.entries(lock.packages ?? {})) {
  if (!packagePath.startsWith("node_modules/")) continue;
  const name = packagePath.replace(/^node_modules\//, "");
  if (name.startsWith(internalPackagePrefix)) continue;
  const license = typeof pkg.license === "string" ? pkg.license : "";
  if (!license) {
    failures.push(`${name} is missing license metadata in package-lock.json`);
    continue;
  }
  if (deniedLicensePattern.test(license)) {
    failures.push(`${name} has denied license expression: ${license}`);
  }
}

if (failures.length > 0) {
  console.error("License check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("License check passed: project packages are Apache-2.0 and no denied dependency licenses were found.");

function readJson(path) {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
}
