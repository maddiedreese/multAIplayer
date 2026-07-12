import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarPath = new URL("../src/components/DesktopSidebar.tsx", import.meta.url);
const accountSectionPath = new URL("../src/components/SidebarAccountSection.tsx", import.meta.url);

test("desktop sidebar composes account, team/room, and footer sections", async () => {
  const [source, accountSection] = await Promise.all([
    readFile(sidebarPath, "utf8"),
    readFile(accountSectionPath, "utf8")
  ]);

  assert.match(accountSection, /export function SidebarAccountSection\(/);
  assert.match(source, /<SidebarAccountSection(?:\s|>)/);
  for (const component of ["SidebarTeamGroup", "SidebarFooter"]) {
    assert.match(source, new RegExp(`function ${component}\\(`));
    assert.match(source, new RegExp(`<${component}(?:\\s|>)`));
  }

  assert.match(source, /aria-label=\{collapsed \? `Expand \$\{team\.name\}` : `Collapse \$\{team\.name\}`\}/);
  assert.match(source, /onSetRoomLifecycle\(room\.id, room\.archived \? "restore" : "archive"\)/);
  assert.match(source, /onSelectSidebarPanel\(activeSidebarPanel === "settings" \? null : "settings"\)/);
});
