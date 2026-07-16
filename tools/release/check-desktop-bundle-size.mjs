import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = join(root, "apps/desktop/dist");
// Monaco's complete TypeScript/JavaScript language service is intentionally shipped
// offline with the desktop app. Its minified worker is roughly 8 MiB by itself.
const maximumTotalBytes = 18 * 1024 * 1024;
const maximumAssetBytes = 9 * 1024 * 1024;

async function inventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await inventory(path)));
    else if (entry.isFile()) files.push({ path, bytes: (await stat(path)).size });
  }
  return files;
}

const files = (await inventory(dist)).sort((left, right) => right.bytes - left.bytes);
const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
const oversized = files.filter((file) => file.bytes > maximumAssetBytes);

console.log(`Desktop web assets: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB across ${files.length} files.`);
for (const file of files.slice(0, 5)) {
  console.log(`  ${(file.bytes / 1024 / 1024).toFixed(2)} MiB  ${file.path.slice(dist.length + 1)}`);
}

if (totalBytes > maximumTotalBytes) {
  throw new Error(`Desktop assets exceed the ${(maximumTotalBytes / 1024 / 1024).toFixed(0)} MiB release budget.`);
}
if (oversized.length > 0) {
  throw new Error(
    `Desktop asset exceeds the ${(maximumAssetBytes / 1024 / 1024).toFixed(0)} MiB per-file budget: ${oversized[0].path}`
  );
}
