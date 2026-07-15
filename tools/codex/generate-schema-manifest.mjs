#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Usage: generate-codex-schema-manifest --schema-dir DIR --codex-version VERSION --out FILE");
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["schema-dir", "codex-version", "out"]) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function methodNames(schema) {
  return [...new Set((schema.oneOf ?? []).flatMap((entry) => entry.properties?.method?.enum ?? []))].sort();
}

function enumValues(schema) {
  if (Array.isArray(schema.enum)) return [...schema.enum].sort();
  return [...new Set((schema.oneOf ?? schema.anyOf ?? []).flatMap((entry) => entry.enum ?? []))].sort();
}

function threadItemTypes(schema) {
  return [...new Set((schema.oneOf ?? []).flatMap((entry) => entry.properties?.type?.enum ?? []))].sort();
}

const args = parseArgs(process.argv.slice(2));
const schemaDir = path.resolve(args["schema-dir"]);
const [requestId, serverRequests, clientRequests, notifications, bundleText] = await Promise.all([
  readJson(path.join(schemaDir, "RequestId.json")),
  readJson(path.join(schemaDir, "ServerRequest.json")),
  readJson(path.join(schemaDir, "ClientRequest.json")),
  readJson(path.join(schemaDir, "ServerNotification.json")),
  readFile(path.join(schemaDir, "codex_app_server_protocol.v2.schemas.json"), "utf8")
]);
const bundle = JSON.parse(bundleText);
const definitions = bundle.definitions ?? {};
const initializeCapabilities = definitions.InitializeCapabilities?.properties ?? {};

const manifest = {
  manifestVersion: 1,
  codexVersion: args["codex-version"],
  sourceBundleSha256: createHash("sha256").update(bundleText).digest("hex"),
  requestIdTypes: [...new Set((requestId.anyOf ?? []).map((entry) => entry.type).filter(Boolean))].sort(),
  clientRequestMethods: methodNames(clientRequests),
  serverRequestMethods: methodNames(serverRequests),
  serverNotificationMethods: methodNames(notifications),
  initializeCapabilities: Object.keys(initializeCapabilities).sort(),
  authModes: enumValues(definitions.AuthMode ?? {}),
  appToolApprovalModes: enumValues(definitions.AppToolApproval ?? {}),
  threadItemTypes: threadItemTypes(definitions.ThreadItem ?? {})
};

await writeFile(path.resolve(args.out), `${JSON.stringify(manifest, null, 2)}\n`);
