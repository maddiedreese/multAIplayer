import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supportedVersions = ["0.133.0", "0.143.0", "0.144.0"];
const supportPolicy = JSON.parse(
  await readFile(new URL("../contracts/codex-app-server/support-policy.json", import.meta.url), "utf8")
);
const compatibilityDocumentation = [
  "README.md",
  "docs/alpha-limitations.md",
  "docs/codex-hosting.md",
  "docs/faq.md",
  "docs/threat-model.md",
  "docs/using-the-app.md"
];
const manifests = new Map(
  await Promise.all(
    supportedVersions.map(async (version) => [
      version,
      JSON.parse(await readFile(new URL(`../contracts/codex-app-server/${version}.json`, import.meta.url), "utf8"))
    ])
  )
);

const requiredClientMethods = ["initialize", "model/list", "thread/resume", "thread/start", "turn/start", "turn/steer"];
const requiredNotifications = ["item/agentMessage/delta", "item/completed", "item/started", "turn/completed"];
const requiredServerRequests = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request"
];

test("Codex support policy remains bounded by the checked-in contract fixtures", () => {
  assert.equal(supportPolicy.minimumSupportedVersion, supportedVersions[0]);
  assert.equal(supportPolicy.latestContractTestedVersion, supportedVersions.at(-1));
});

test("user-facing Codex compatibility ranges stay sourced from the support policy", async () => {
  for (const path of compatibilityDocumentation) {
    const contents = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.ok(contents.includes(supportPolicy.minimumSupportedVersion), `${path}: minimum supported version`);
    assert.ok(contents.includes(supportPolicy.latestContractTestedVersion), `${path}: latest tested version`);
  }
});

test("supported Codex manifests preserve the app-server transport contract", () => {
  for (const [version, manifest] of manifests) {
    assert.equal(manifest.manifestVersion, 1, version);
    assert.equal(manifest.codexVersion, version);
    assert.match(manifest.sourceBundleSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.requestIdTypes, ["integer", "string"], version);
    for (const method of requiredClientMethods)
      assert.ok(manifest.clientRequestMethods.includes(method), `${version}: ${method}`);
    for (const method of requiredNotifications)
      assert.ok(manifest.serverNotificationMethods.includes(method), `${version}: ${method}`);
    for (const method of requiredServerRequests)
      assert.ok(manifest.serverRequestMethods.includes(method), `${version}: ${method}`);
  }
});

test("0.144 capability additions stay additive", () => {
  const previous = manifests.get("0.143.0");
  const current = manifests.get("0.144.0");
  assert.ok(current.authModes.includes("headers"));
  assert.ok(!previous.authModes.includes("headers"));
  assert.ok(current.appToolApprovalModes.includes("writes"));
  assert.ok(!previous.appToolApprovalModes.includes("writes"));
  for (const method of requiredClientMethods) assert.ok(current.clientRequestMethods.includes(method));
  for (const method of requiredNotifications) assert.ok(current.serverNotificationMethods.includes(method));
});
