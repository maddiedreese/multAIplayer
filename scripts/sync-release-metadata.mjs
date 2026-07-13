import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function synchronizeCargoLockVersion(lockfile, version) {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error("invalid release version");
  const packagePattern = /(\[\[package\]\]\nname = "multaiplayer"\nversion = ")[^"]+("\n)/g;
  const matches = Array.from(lockfile.matchAll(packagePattern));
  if (matches.length !== 1) throw new Error(`expected one multaiplayer package in Cargo.lock, found ${matches.length}`);
  return lockfile.replace(packagePattern, `$1${version}$2`);
}

function main() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const path = "apps/desktop/src-tauri/Cargo.lock";
  const before = readFileSync(path, "utf8");
  const after = synchronizeCargoLockVersion(before, version);
  if (after !== before) writeFileSync(path, after);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
