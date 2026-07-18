#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export const associatedDomainHosts = ["multaiplayer.com", "open.multaiplayer.com"];
export const bundleIdentifier = "com.multaiplayer.desktop";

function hasExactAppBinding(entry, appId) {
  if (entry.appID === appId) return entry.appIDs === undefined;
  return (
    entry.appID === undefined && Array.isArray(entry.appIDs) && entry.appIDs.length === 1 && entry.appIDs[0] === appId
  );
}

function componentPath(component, allowedPaths) {
  if (!component || typeof component !== "object" || Array.isArray(component)) return null;
  if (!Object.keys(component).every((key) => key === "/" || key === "comment")) return null;
  const path = component["/"];
  return typeof path === "string" && allowedPaths.has(path) ? path : null;
}

export function validateAssociationDocument(document, appId) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  const details = document.applinks?.details;
  if (!Array.isArray(details) || details.length !== 1) return false;
  const [entry] = details;
  if (!entry || !Array.isArray(entry.components)) return false;
  if (!hasExactAppBinding(entry, appId) || entry.components.length !== 2) return false;
  const allowedPaths = new Set(["/invite", "/invite/"]);
  const paths = new Set();
  for (const component of entry.components) {
    const path = componentPath(component, allowedPaths);
    if (!path) return false;
    paths.add(path);
  }
  return paths.size === allowedPaths.size;
}

export async function verifyLiveAssociations({ teamId, fetchImpl = fetch }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
    throw new Error("APPLE_TEAM_ID must be a 10-character Apple team identifier.");
  }
  const appId = `${teamId}.${bundleIdentifier}`;
  for (const host of associatedDomainHosts) {
    const response = await fetchImpl(`https://${host}/.well-known/apple-app-site-association`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" }
    });
    if (response.status !== 200) throw new Error(`${host} AASA returned HTTP ${response.status}.`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new Error(`${host} AASA must use application/json.`);
    }
    let document;
    try {
      document = await response.json();
    } catch {
      throw new Error(`${host} AASA is not valid JSON.`);
    }
    if (!validateAssociationDocument(document, appId)) {
      throw new Error(`${host} AASA does not bind ${appId} to only the invitation paths.`);
    }
  }
}

export function verifySignedAppEntitlements(appPath, { requireProvisioningProfile = false } = {}) {
  const provisioningProfile = join(appPath, "Contents", "embedded.provisionprofile");
  if (requireProvisioningProfile && !existsSync(provisioningProfile)) {
    throw new Error("Signed application is missing its Developer ID provisioning profile.");
  }
  let entitlements;
  try {
    entitlements = execFileSync("codesign", ["-d", "--entitlements", "-", appPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    if (!stdout) throw error;
    entitlements = stdout;
  }
  if (!entitlements.includes("[Key] com.apple.developer.associated-domains")) {
    throw new Error("Signed application is missing its Associated Domains entitlement.");
  }
  const domains = [...entitlements.matchAll(/^\s*\[String\] (applinks:[^\r\n]+)$/gm)].map((match) => match[1]);
  const expectedDomains = associatedDomainHosts.map((host) => `applinks:${host}`);
  if (JSON.stringify(domains) !== JSON.stringify(expectedDomains)) {
    throw new Error("Signed application has incorrect Associated Domains entitlements.");
  }
  if (entitlements.includes("[Key] com.apple.security.get-task-allow")) {
    throw new Error("Signed release application must not be debug-enabled.");
  }
}

async function main() {
  const [mode, appPath] = process.argv.slice(2);
  if (mode === "--live") {
    await verifyLiveAssociations({ teamId: process.env.APPLE_TEAM_ID });
    console.log("Verified live Apple app-site associations for both invitation hosts.");
    return;
  }
  if (mode === "--require-profile") {
    if (!appPath) {
      throw new Error("Usage: verify-macos-associated-domains.mjs --require-profile <path-to-app>");
    }
    verifySignedAppEntitlements(appPath, { requireProvisioningProfile: true });
    console.log("Verified signed macOS associated-domain entitlements and Developer ID provisioning profile.");
    return;
  }
  if (!mode || appPath) {
    throw new Error(
      "Usage: verify-macos-associated-domains.mjs --live | --require-profile <path-to-app> | <path-to-app>"
    );
  }
  verifySignedAppEntitlements(mode);
  console.log("Verified signed macOS associated-domain entitlements.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
