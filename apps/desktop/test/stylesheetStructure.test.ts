import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import postcss, { type AtRule } from "postcss";

const stylesheetPath = new URL("../src/styles.css", import.meta.url);

test("stylesheet has no repeated selector lists within a cascade context", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  const root = postcss.parse(stylesheet, { from: stylesheetPath.pathname });
  const definitions = new Map<string, number>();
  const duplicates: string[] = [];

  root.walkRules((rule) => {
    if (insideKeyframes(rule.parent)) return;
    const context = cascadeContext(rule.parent);
    const selectorList = [...rule.selectors].sort().join(", ");
    const key = `${context}\n${selectorList}`;
    const line = rule.source?.start?.line ?? 0;
    const previousLine = definitions.get(key);
    if (previousLine !== undefined) {
      duplicates.push(`${selectorList} (${context || "root"}: lines ${previousLine} and ${line})`);
    } else {
      definitions.set(key, line);
    }
  });

  assert.deepEqual(duplicates, [], `Duplicate selector definitions:\n${duplicates.join("\n")}`);
});

function insideKeyframes(parent: { parent?: unknown; type?: string; name?: string } | undefined): boolean {
  let current = parent;
  while (current) {
    if (current.type === "atrule" && current.name?.endsWith("keyframes")) return true;
    current = current.parent as typeof current;
  }
  return false;
}

function cascadeContext(parent: { parent?: unknown; type?: string; name?: string; params?: string } | undefined): string {
  const atRules: string[] = [];
  let current = parent;
  while (current) {
    if (current.type === "atrule") {
      const atRule = current as AtRule;
      atRules.unshift(`@${atRule.name} ${atRule.params}`.trim());
    }
    current = current.parent as typeof current;
  }
  return atRules.join(" > ");
}
