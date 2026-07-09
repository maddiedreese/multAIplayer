import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packageLock = JSON.parse(await readFile(join(repoRoot, "package-lock.json"), "utf8"));
const installedDomPurify = packageLock.packages?.["node_modules/dompurify"]?.version;

if (installedDomPurify !== "3.4.11") {
  throw new Error(`Expected DOMPurify 3.4.11 in package-lock.json, found ${installedDomPurify ?? "nothing"}.`);
}

const assetsDirectory = join(repoRoot, "apps/desktop/dist/assets");
const assetNames = await readdir(assetsDirectory);
const javascriptAssets = assetNames.filter((name) => name.endsWith(".js"));
const bundledSources = await Promise.all(
  javascriptAssets.map((name) => readFile(join(assetsDirectory, name), "utf8"))
);
const domPurifySources = bundledSources.filter((source) => source.includes("DOMPurify"));

if (!domPurifySources.some((source) => source.includes("DOMPurify 3.4.11"))) {
  throw new Error("The desktop bundle does not contain the required DOMPurify 3.4.11 implementation.");
}

if (domPurifySources.some((source) => source.includes("DOMPurify 3.2.7"))) {
  throw new Error("The desktop bundle still contains Monaco's vulnerable DOMPurify 3.2.7 implementation.");
}

console.log("Verified desktop bundle uses DOMPurify 3.4.11 and excludes DOMPurify 3.2.7.");
