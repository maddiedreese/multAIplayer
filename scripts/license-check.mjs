import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeniedLicenseExpression } from "./license-policy.mjs";

const expectedProjectLicense = "Apache-2.0";
const projectPackagePaths = [
  "package.json",
  "apps/desktop/package.json",
  "apps/relay/package.json",
  "packages/protocol/package.json"
];
const internalPackagePrefix = "@multaiplayer/";
// npm omits license metadata for this exact legacy package even though its
// packaged README contains the complete MIT license text. Keep overrides
// version-specific so an upgrade requires a fresh review.
const verifiedLicenseMetadata = new Map([["css-value@0.0.1", "MIT"]]);

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
  const license =
    typeof pkg.license === "string"
      ? pkg.license
      : (verifiedLicenseMetadata.get(`${name}@${String(pkg.version ?? "")}`) ?? "");
  if (!license) {
    failures.push(`${name} is missing license metadata in package-lock.json`);
    continue;
  }
  if (isDeniedLicenseExpression(license)) {
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
