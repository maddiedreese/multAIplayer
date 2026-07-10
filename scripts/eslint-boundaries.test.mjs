import assert from "node:assert/strict";
import test from "node:test";

import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: process.cwd() });

async function boundaryMessages(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

test("workspace packages may import only their declared internal dependencies", async () => {
  assert.deepEqual(
    await boundaryMessages("packages/crypto/src/boundary-probe.ts", 'import "@multaiplayer/protocol";'),
    []
  );

  const cryptoToGitHub = await boundaryMessages(
    "packages/crypto/src/boundary-probe.ts",
    'import "@multaiplayer/github";'
  );
  assert.equal(cryptoToGitHub.length, 1);
  assert.match(cryptoToGitHub[0].message, /does not depend on @multaiplayer\/github/);

  const leafToCrypto = await boundaryMessages(
    "packages/protocol/src/boundary-probe.ts",
    'import "@multaiplayer/crypto";'
  );
  assert.equal(leafToCrypto.length, 1);
  assert.match(leafToCrypto[0].message, /@multaiplayer\/protocol does not depend on @multaiplayer\/crypto/);
});

test("applications keep their distinct dependency boundaries", async () => {
  assert.deepEqual(await boundaryMessages("apps/relay/src/boundary-probe.ts", 'import "@multaiplayer/github";'), []);

  const relayToCrypto = await boundaryMessages("apps/relay/src/boundary-probe.ts", 'import "@multaiplayer/crypto";');
  assert.equal(relayToCrypto.length, 1);
  assert.match(relayToCrypto[0].message, /@multaiplayer\/relay does not depend on @multaiplayer\/crypto/);

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
    "packages/crypto/src/boundary-probe.ts",
    'import "../../protocol/src/relay-messages.js";'
  );
  assert.equal(relativeImport.length, 1);
  assert.match(relativeImport[0].message, /reaching across workspace source trees/);
});
