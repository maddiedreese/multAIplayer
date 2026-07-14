import process from "node:process";
import { pathToFileURL } from "node:url";

export const associatedDomainHosts = ["multaiplayer.com", "open.multaiplayer.com"];
export const bundleIdentifier = "com.multaiplayer.desktop";

export function validateAssociationDocument(document, appId) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  const details = document.applinks?.details;
  if (!Array.isArray(details) || details.length !== 1) return false;
  const [entry] = details;
  if (!entry || !Array.isArray(entry.components)) return false;
  const exactAppBinding =
    (entry.appID === appId && entry.appIDs === undefined) ||
    (entry.appID === undefined &&
      Array.isArray(entry.appIDs) &&
      entry.appIDs.length === 1 &&
      entry.appIDs[0] === appId);
  if (!exactAppBinding || entry.components.length !== 2) return false;
  const allowedPaths = new Set(["/invite", "/invite/"]);
  const paths = new Set();
  for (const component of entry.components) {
    if (!component || typeof component !== "object" || Array.isArray(component)) return false;
    if (!Object.keys(component).every((key) => key === "/" || key === "comment")) return false;
    if (typeof component["/"] !== "string" || !allowedPaths.has(component["/"])) return false;
    paths.add(component["/"]);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyLiveAssociations({ teamId: process.env.APPLE_TEAM_ID })
    .then(() => console.log("Verified live Apple app-site associations for both invitation hosts."))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
