import assert from "node:assert/strict";
import test from "node:test";

import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: process.cwd() });

async function boundaryMessages(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

test("workspace packages may import only their declared internal dependencies", async () => {
  const protocolToGitHub = await boundaryMessages(
    "packages/protocol/src/boundary-probe.ts",
    'import "@multaiplayer/github";'
  );
  assert.equal(protocolToGitHub.length, 1);
  assert.match(protocolToGitHub[0].message, /@multaiplayer\/protocol does not depend on @multaiplayer\/github/);
});

test("applications keep their distinct dependency boundaries", async () => {
  assert.deepEqual(await boundaryMessages("apps/relay/src/boundary-probe.ts", 'import "@multaiplayer/github";'), []);

  assert.deepEqual(
    await boundaryMessages("apps/relay/test/process-security-journey.test.ts", 'import "@multaiplayer/protocol";'),
    []
  );

  const desktopToRelay = await boundaryMessages("apps/desktop/src/boundary-probe.ts", 'import "@multaiplayer/relay";');
  assert.equal(desktopToRelay.length, 1);
  assert.match(desktopToRelay[0].message, /@multaiplayer\/desktop does not depend on @multaiplayer\/relay/);
});

test("workspace consumers cannot bypass public package entry points", async () => {
  const deepImport = await boundaryMessages(
    "apps/desktop/src/boundary-probe.ts",
    'import "@multaiplayer/protocol/src/relay-messages";'
  );
  assert.equal(deepImport.length, 1);
  assert.match(deepImport[0].message, /public entry point/);

  const relativeImport = await boundaryMessages(
    "packages/github/src/boundary-probe.ts",
    'import "../../protocol/src/relay-messages.js";'
  );
  assert.equal(relativeImport.length, 1);
  assert.match(relativeImport[0].message, /reaching across workspace source trees/);
});
