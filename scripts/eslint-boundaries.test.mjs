import assert from "node:assert/strict";
import test from "node:test";

import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: process.cwd() });

async function boundaryMessages(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

async function ruleMessages(filePath, source, ruleId) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === ruleId);
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

test("desktop library modules must live under a named domain", async () => {
  const flat = await ruleMessages(
    "apps/desktop/src/lib/brandNewHelper.ts",
    "export const value = 1;",
    "desktop/no-flat-lib-module"
  );
  assert.equal(flat.length, 1);
  assert.match(flat[0].message, /named domain directory/);
  assert.deepEqual(
    await ruleMessages(
      "apps/desktop/src/lib/core/brandNewHelper.ts",
      "export const value = 1;",
      "desktop/no-flat-lib-module"
    ),
    []
  );
  const unknown = await ruleMessages(
    "apps/desktop/src/lib/misc/brandNewHelper.ts",
    "export const value = 1;",
    "desktop/no-flat-lib-module"
  );
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].message, /reviewed domain/);
});

test("desktop layers and library domains enforce the acyclic dependency table", async () => {
  const cases = [
    ["apps/desktop/src/lib/core/probe.ts", 'import "../codex/value";', 1],
    ["apps/desktop/src/lib/browser/probe.ts", 'import "../access/value";', 0],
    ["apps/desktop/src/lib/browser/probe.ts", 'import "../room/value";', 1],
    ["apps/desktop/src/lib/room/probe.ts", 'import "../browser/value";', 0],
    ["apps/desktop/src/lib/history/probe.ts", 'import type { Value } from "../codex/value";', 0],
    ["apps/desktop/src/lib/core/probe.ts", 'import type { State } from "../../store/appStore";', 1],
    ["apps/desktop/src/lib/core/probe.ts", 'import type { View } from "../../components/View";', 1],
    ["apps/desktop/src/lib/core/probe.ts", 'import type { Hook } from "../../hooks/useHook";', 1],
    ["apps/desktop/src/application/rooms/probe.ts", 'import "../../lib/room/roomDefaults";', 0],
    ["apps/desktop/src/application/rooms/probe.ts", 'import "../../store/appStore";', 0],
    ["apps/desktop/src/application/rooms/probe.ts", 'import "../../components/View";', 1],
    ["apps/desktop/src/application/rooms/probe.ts", 'import "../../hooks/useHook";', 1],
    ["apps/desktop/src/application/rooms/probe.ts", 'import "../../presentation/rooms/view";', 1],
    ["apps/desktop/src/presentation/rooms/probe.ts", 'import "../../components/View";', 0],
    ["apps/desktop/src/presentation/rooms/probe.ts", 'import "../../application/rooms/actions";', 0],
    ["apps/desktop/src/presentation/rooms/probe.ts", 'import "../../store/appStore";', 1],
    ["apps/desktop/src/lib/core/probe.ts", 'import "../newFlatHelper";', 1],
    ["apps/desktop/src/lib/core/probe.ts", 'import "@/store/appStore";', 1]
  ];
  for (const [filePath, source, expected] of cases) {
    const messages = await ruleMessages(filePath, source, "desktop/layer-boundaries");
    assert.equal(messages.length, expected, `${filePath}: ${source}`);
  }
});

test("desktop layer boundaries cover re-exports and dynamic imports", async () => {
  for (const source of [
    'export { value } from "../../components/View";',
    'export * from "../../components/View";',
    'const view = import("../../components/View");'
  ]) {
    const messages = await ruleMessages(
      "apps/desktop/src/application/rooms/probe.ts",
      source,
      "desktop/layer-boundaries"
    );
    assert.equal(messages.length, 1, source);
  }
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
    'import "../../../packages/protocol/src/relay-messages.js";'
  );
  assert.equal(relativeImport.length, 1);
  assert.match(relativeImport[0].message, /reaching across workspace source trees/);
});

test("desktop Zustand slices may access only owned or explicitly allowed state", async () => {
  assert.deepEqual(
    await ruleMessages(
      "apps/desktop/src/store/slices/browserSlice.ts",
      "const update = (state: any) => state.browserByRoom;",
      "desktop/zustand-slice-boundaries"
    ),
    []
  );
  assert.deepEqual(
    await ruleMessages(
      "apps/desktop/src/store/slices/roomLifecycleSlice.ts",
      "const update = (state: any) => state.terminals;",
      "desktop/zustand-slice-boundaries"
    ),
    []
  );
  const violation = await ruleMessages(
    "apps/desktop/src/store/slices/browserSlice.ts",
    "const update = (state: any) => state.terminals;",
    "desktop/zustand-slice-boundaries"
  );
  assert.equal(violation.length, 1);
  assert.match(violation[0].message, /terminalSlice/);
  const unregistered = await ruleMessages(
    "apps/desktop/src/store/slices/browserSlice.ts",
    "const update = (state: any) => state.brandNewGrabBag;",
    "desktop/zustand-slice-boundaries"
  );
  assert.equal(unregistered.length, 1);
  assert.match(unregistered[0].message, /Register its owner/);
  const destructuredGet = await ruleMessages(
    "apps/desktop/src/store/slices/browserSlice.ts",
    "const update = () => { const { terminals } = get(); return terminals; };",
    "desktop/zustand-slice-boundaries"
  );
  assert.equal(destructuredGet.length, 1);
  assert.match(destructuredGet[0].message, /terminalSlice/);
});

test("desktop bare catches must identify their observation path", async () => {
  const violation = await ruleMessages(
    "apps/desktop/src/lib/catch-policy-probe.ts",
    "try { work(); } catch { return null; }",
    "desktop/no-unreported-bare-catch"
  );
  assert.equal(violation.length, 1);
  assert.deepEqual(
    await ruleMessages(
      "apps/desktop/src/lib/catch-policy-probe.ts",
      'try { work(); } catch { reportExpectedFailure("invalid input"); return null; }',
      "desktop/no-unreported-bare-catch"
    ),
    []
  );
  const boundViolation = await ruleMessages(
    "apps/desktop/src/lib/catch-policy-probe.ts",
    "try { work(); } catch (error) { return null; }",
    "desktop/no-unreported-bare-catch"
  );
  assert.equal(boundViolation.length, 1);
  const promiseViolation = await ruleMessages(
    "apps/desktop/src/lib/catch-policy-probe.ts",
    "void work().catch(() => undefined);",
    "desktop/no-unreported-bare-catch"
  );
  assert.equal(promiseViolation.length, 1);
  assert.deepEqual(
    await ruleMessages(
      "apps/desktop/src/lib/catch-policy-probe.ts",
      'void work().catch((error) => reportNonFatal("work", error));',
      "desktop/no-unreported-bare-catch"
    ),
    []
  );
});
