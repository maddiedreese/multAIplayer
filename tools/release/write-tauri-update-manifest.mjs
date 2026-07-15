#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const releaseAssetOrigin = "https://github.com/maddiedreese/multAIplayer/releases/download";
const envelopeSchema = "multaiplayer-updater-envelope-v1";
const payloadSchema = "multaiplayer-updater-metadata-v1";

function releaseFields({ tag, packageVersion, assetName, archiveSignature }) {
  assert.match(tag, /^v[0-9A-Za-z][0-9A-Za-z.-]*$/, "release tag is not safe for an updater URL");
  assert.equal(tag, `v${packageVersion}`, "release tag must match the desktop package version");
  assert.match(assetName, /^[0-9A-Za-z._-]+\.app\.tar\.gz$/, "unexpected macOS updater asset name");
  assert.ok(archiveSignature.trim().length > 32, "updater archive signature is missing or truncated");
  return {
    version: packageVersion,
    url: `${releaseAssetOrigin}/${tag}/${assetName}`,
    archiveSignature: archiveSignature.trim(),
    notes: `See the ${tag} GitHub Release for reviewed release notes.`
  };
}

export function createAuthenticatedMetadataPayload(input) {
  const fields = releaseFields(input);
  return JSON.stringify({
    schema: payloadSchema,
    version: fields.version,
    url: fields.url,
    archiveSignature: fields.archiveSignature,
    notes: fields.notes
  });
}

export function createTauriUpdateManifest(input) {
  assert.ok(input.metadataSignature.trim().length > 32, "metadata signature is missing or truncated");
  const fields = releaseFields(input);
  const payload = createAuthenticatedMetadataPayload(input);
  return {
    version: fields.version,
    notes: JSON.stringify({
      schema: envelopeSchema,
      payload,
      signature: input.metadataSignature.trim()
    }),
    platforms: {
      "darwin-aarch64": {
        signature: fields.archiveSignature,
        url: fields.url
      }
    }
  };
}

async function readInputs({ tag, packagePath, assetName, archiveSignaturePath }) {
  const [packageText, archiveSignature] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(archiveSignaturePath, "utf8")
  ]);
  return { tag, packageVersion: JSON.parse(packageText).version, assetName, archiveSignature };
}

export async function writeAuthenticatedMetadataPayload({ outputPath, ...paths }) {
  const input = await readInputs(paths);
  await writeFile(outputPath, createAuthenticatedMetadataPayload(input), { mode: 0o644 });
}

export async function writeTauriUpdateManifest({ metadataSignaturePath, outputPath, ...paths }) {
  const [input, metadataSignature] = await Promise.all([readInputs(paths), readFile(metadataSignaturePath, "utf8")]);
  const manifest = createTauriUpdateManifest({ ...input, metadataSignature });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, tag, packagePath, assetName, archiveSignaturePath, fifthPath, sixthPath] = process.argv.slice(2);
  const common = { tag, packagePath, assetName, archiveSignaturePath };
  if (command === "payload") {
    assert.ok(
      tag && packagePath && assetName && archiveSignaturePath && fifthPath && !sixthPath,
      "invalid payload arguments"
    );
    await writeAuthenticatedMetadataPayload({ ...common, outputPath: fifthPath });
  } else if (command === "manifest") {
    assert.ok(
      tag && packagePath && assetName && archiveSignaturePath && fifthPath && sixthPath,
      "invalid manifest arguments"
    );
    await writeTauriUpdateManifest({ ...common, metadataSignaturePath: fifthPath, outputPath: sixthPath });
  } else {
    throw new Error("expected payload or manifest command");
  }
}
