import assert from "node:assert/strict";
import test from "node:test";
import { compareDesktopCoverage, normalizeDesktopCoverage } from "./check-desktop-coverage-ratchet.mjs";

const path = "/checkout/apps/desktop/src/store/slices/terminalSlice.ts";

test("normalizes absolute coverage paths into repository-relative exact fractions", () => {
  assert.deepEqual(normalizeDesktopCoverage({ total: {}, [path]: coverage(3, 7) }), {
    version: 1,
    files: {
      "apps/desktop/src/store/slices/terminalSlice.ts": {
        lines: [3, 7],
        functions: [3, 7],
        branches: [3, 7],
        statements: [3, 7]
      }
    }
  });
});

test("rejects regressions and stale improvements using exact fraction comparison", () => {
  const baseline = normalizeDesktopCoverage({ total: {}, [path]: coverage(3, 7) });
  const regression = normalizeDesktopCoverage({ total: {}, [path]: coverage(2, 7) });
  const improvement = normalizeDesktopCoverage({ total: {}, [path]: coverage(4, 7) });
  assert.equal(compareDesktopCoverage(baseline, baseline).length, 0);
  assert.match(compareDesktopCoverage(baseline, regression)[0], /regressed from 3\/7 to 2\/7/);
  assert.match(compareDesktopCoverage(baseline, improvement)[0], /improved from 3\/7 to 4\/7/);
});

test("requires additions and removals to update the reviewed file inventory", () => {
  const baseline = normalizeDesktopCoverage({ total: {}, [path]: coverage(3, 7) });
  const added = normalizeDesktopCoverage({
    total: {},
    [path]: coverage(3, 7),
    "/checkout/apps/desktop/src/new.ts": coverage(0, 4)
  });
  assert.match(compareDesktopCoverage(baseline, added).at(-1), /not recorded/);
  assert.match(compareDesktopCoverage(added, baseline).at(-1), /missing from the coverage report/);
});

function coverage(covered, total) {
  const metric = { covered, total, skipped: 0, pct: 0 };
  return { lines: metric, functions: metric, branches: metric, statements: metric };
}
