import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const requiredDomPurifyVersion = "3.4.12";
const requiredMonacoVersion = "0.55.1";
const rootPackage = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(await readFile(join(repoRoot, "apps/desktop/package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(join(repoRoot, "package-lock.json"), "utf8"));
// npm applies workspace overrides only from the root manifest. The exact root
// DOMPurify pin supplies the patched implementation forced into Monaco below.
const installedDomPurify = packageLock.packages?.["node_modules/dompurify"]?.version;

if (rootPackage.devDependencies?.dompurify !== requiredDomPurifyVersion) {
  throw new Error(`Root package.json must pin DOMPurify ${requiredDomPurifyVersion} for the workspace override.`);
}
if (rootPackage.overrides?.["monaco-editor"]?.dompurify !== "$dompurify") {
  throw new Error("Root package.json must force Monaco to use the pinned DOMPurify package.");
}
if (rootPackage.devDependencies?.["monaco-editor"] !== undefined) {
  throw new Error("Monaco belongs to the desktop workspace, not the repository root.");
}
if (desktopPackage.devDependencies?.["monaco-editor"] !== requiredMonacoVersion) {
  throw new Error(`Desktop package.json must own Monaco ${requiredMonacoVersion}.`);
}
if (installedDomPurify !== requiredDomPurifyVersion) {
  throw new Error(
    `Expected DOMPurify ${requiredDomPurifyVersion} in package-lock.json, found ${installedDomPurify ?? "nothing"}.`
  );
}

const assetsDirectory = join(repoRoot, "apps/desktop/dist/assets");
const assetNames = await readdir(assetsDirectory);
const javascriptAssets = assetNames.filter((name) => name.endsWith(".js"));
const bundledSources = await Promise.all(javascriptAssets.map((name) => readFile(join(assetsDirectory, name), "utf8")));
const domPurifySources = bundledSources.filter((source) => source.includes("DOMPurify"));

// Minifiers may separate the license name and version while retaining both in
// the same emitted module. Check the implementation-bearing asset rather than
// depending on one exact comment layout.
if (!domPurifySources.some((source) => source.includes(requiredDomPurifyVersion))) {
  throw new Error(
    `The desktop bundle does not contain the required DOMPurify ${requiredDomPurifyVersion} implementation.`
  );
}

if (domPurifySources.some((source) => source.includes("3.2.7"))) {
  throw new Error("The desktop bundle still contains Monaco's vulnerable DOMPurify 3.2.7 implementation.");
}

console.log(`Verified desktop bundle uses DOMPurify ${requiredDomPurifyVersion} and excludes DOMPurify 3.2.7.`);
