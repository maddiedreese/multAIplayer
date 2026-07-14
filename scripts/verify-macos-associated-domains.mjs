import { execFileSync } from "node:child_process";
import process from "node:process";

const appPath = process.argv[2];
if (!appPath) {
  console.error("Usage: node scripts/verify-macos-associated-domains.mjs <path-to-app>");
  process.exit(1);
}

let entitlements;
try {
  entitlements = execFileSync("codesign", ["-d", "--entitlements", ":-", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
} catch (error) {
  const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
  if (!stdout) throw error;
  entitlements = stdout;
}

for (const domain of ["applinks:multaiplayer.com", "applinks:open.multaiplayer.com"]) {
  if (!entitlements.includes(`<string>${domain}</string>`)) {
    throw new Error(`Signed application is missing ${domain}.`);
  }
}
console.log("Verified signed macOS associated-domain entitlements.");
