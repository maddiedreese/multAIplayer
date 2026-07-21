import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { SidebarTeamGroup, SidebarTeamsTitle } from "../src/components/DesktopSidebarSections";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  React
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

afterEach(() => cleanup());

test("teams section exposes an accessible collapse control", () => {
  let toggles = 0;
  const view = render(
    <SidebarTeamsTitle
      searchActive={false}
      showArchived={false}
      collapsed={false}
      teamCreateOpen={false}
      onToggleCollapsed={() => {
        toggles += 1;
      }}
      onToggleArchived={() => undefined}
      onToggleTeamCreate={() => undefined}
    />
  );

  const disclosure = view.getByRole("button", { name: "Collapse Teams" });
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  fireEvent.click(disclosure);
  assert.equal(toggles, 1);

  view.rerender(
    <SidebarTeamsTitle
      searchActive={false}
      showArchived={false}
      collapsed
      teamCreateOpen={false}
      onToggleCollapsed={() => undefined}
      onToggleArchived={() => undefined}
      onToggleTeamCreate={() => undefined}
    />
  );
  assert.equal(view.getByRole("button", { name: "Expand Teams" }).getAttribute("aria-expanded"), "false");
});

test("team disclosure collapses its room list", () => {
  const props = {
    team: { id: "team-one", name: "Team one", meta: "1 member", active: true, archived: false },
    rooms: [
      {
        id: "room-one",
        teamId: "team-one",
        name: "Room one",
        detail: "Project",
        active: true,
        attention: 0,
        unread: 0,
        archived: false
      }
    ],
    showArchived: false,
    searchActive: false,
    roomCreateOpen: false,
    newRoomName: "",
    newRoomProjectPath: "/tmp/project",
    defaultProjectPath: "/tmp/project",
    onToggleCollapsed: () => undefined,
    onToggleRoomCreate: () => undefined,
    onSelectTeam: () => undefined,
    onNewRoomNameChange: () => undefined,
    onNewRoomProjectPathChange: () => undefined,
    onChooseNewRoomProjectPath: () => undefined,
    onCreateRoom: () => undefined,
    onSelectRoom: () => undefined,
    onSetTeamLifecycle: () => undefined,
    onSetRoomLifecycle: () => undefined
  } satisfies Omit<React.ComponentProps<typeof SidebarTeamGroup>, "collapsed">;
  const view = render(<SidebarTeamGroup {...props} collapsed={false} />);
  assert.ok(view.getByText("Room one"));

  view.rerender(<SidebarTeamGroup {...props} collapsed />);
  assert.equal(view.queryByText("Room one"), null);
  assert.ok(view.getByRole("button", { name: "Expand Team one" }));
});

test("each team owns its room creation control and nested form", () => {
  let toggles = 0;
  let creates = 0;
  const view = render(
    <SidebarTeamGroup
      team={{ id: "team-one", name: "Team one", meta: "1 member", active: true, archived: false }}
      rooms={[]}
      collapsed={false}
      showArchived={false}
      searchActive={false}
      roomCreateOpen={false}
      newRoomName="Room one"
      newRoomProjectPath="/tmp/project"
      defaultProjectPath="/tmp/project"
      onToggleCollapsed={() => undefined}
      onToggleRoomCreate={() => {
        toggles += 1;
      }}
      onSelectTeam={() => undefined}
      onNewRoomNameChange={() => undefined}
      onNewRoomProjectPathChange={() => undefined}
      onChooseNewRoomProjectPath={() => undefined}
      onCreateRoom={() => {
        creates += 1;
      }}
      onSelectRoom={() => undefined}
      onSetTeamLifecycle={() => undefined}
      onSetRoomLifecycle={() => undefined}
    />
  );

  fireEvent.click(view.getByRole("button", { name: "New room in Team one" }));
  assert.equal(toggles, 1);

  view.rerender(
    <SidebarTeamGroup
      team={{ id: "team-one", name: "Team one", meta: "1 member", active: true, archived: false }}
      rooms={[]}
      collapsed={false}
      showArchived={false}
      searchActive={false}
      roomCreateOpen
      newRoomName="Room one"
      newRoomProjectPath="/tmp/project"
      defaultProjectPath="/tmp/project"
      onToggleCollapsed={() => undefined}
      onToggleRoomCreate={() => undefined}
      onSelectTeam={() => undefined}
      onNewRoomNameChange={() => undefined}
      onNewRoomProjectPathChange={() => undefined}
      onChooseNewRoomProjectPath={() => undefined}
      onCreateRoom={() => {
        creates += 1;
      }}
      onSelectRoom={() => undefined}
      onSetTeamLifecycle={() => undefined}
      onSetRoomLifecycle={() => undefined}
    />
  );
  assert.ok(view.getByPlaceholderText("Room name"));
  fireEvent.click(view.getByRole("button", { name: "Create room" }));
  assert.equal(creates, 1);
});
