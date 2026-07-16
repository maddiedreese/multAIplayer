import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import postcss, { type AtRule } from "postcss";

const stylesheetPath = new URL("../src/styles/index.css", import.meta.url);

test("stylesheet has no repeated selector lists within a cascade context", async () => {
  const stylesheet = await readOrderedStylesheet(stylesheetPath);
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

async function readOrderedStylesheet(indexPath: URL): Promise<string> {
  const index = postcss.parse(await readFile(indexPath, "utf8"), { from: indexPath.pathname });
  const imports = index.nodes.filter((node): node is AtRule => node.type === "atrule" && node.name === "import");
  assert.equal(imports.length, index.nodes.length, "Stylesheet index may only contain ordered imports");

  return (
    await Promise.all(
      imports.map(async ({ params }) => {
        const match = params.match(/^["'](.+)["']$/);
        assert.ok(match, `Expected a relative quoted stylesheet import, received: ${params}`);
        return readFile(new URL(match[1], indexPath), "utf8");
      })
    )
  ).join("\n");
}

function insideKeyframes(parent: { parent?: unknown; type?: string; name?: string } | undefined): boolean {
  let current = parent;
  while (current) {
    if (current.type === "atrule" && current.name?.endsWith("keyframes")) return true;
    current = current.parent as typeof current;
  }
  return false;
}

function cascadeContext(
  parent: { parent?: unknown; type?: string; name?: string; params?: string } | undefined
): string {
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
