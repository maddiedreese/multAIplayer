import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarPath = new URL("../src/components/DesktopSidebar.tsx", import.meta.url);

test("desktop sidebar composes account, team/room, and footer sections", async () => {
  const source = await readFile(sidebarPath, "utf8");

  for (const component of ["SidebarAccountSection", "SidebarTeamGroup", "SidebarFooter"]) {
    assert.match(source, new RegExp(`function ${component}\\(`));
    assert.match(source, new RegExp(`<${component}(?:\\s|>)`));
  }

  assert.match(source, /aria-label=\{collapsed \? `Expand \$\{team\.name\}` : `Collapse \$\{team\.name\}`\}/);
  assert.match(source, /onSetRoomLifecycle\(room\.id, room\.archived \? "restore" : "archive"\)/);
  assert.match(source, /onSelectSidebarPanel\(activeSidebarPanel === "settings" \? null : "settings"\)/);
});
