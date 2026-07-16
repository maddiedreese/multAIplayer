import assert from "node:assert/strict";
import test from "node:test";
import {
  sidebarTeamEmptyMessage,
  visibleSidebarRooms,
  visibleSidebarTeams
} from "../src/components/DesktopSidebarSections";
import type { SidebarRoomDisplay, SidebarTeamDisplay } from "../src/components/DesktopSidebar";

const teams: SidebarTeamDisplay[] = [
  { id: "active-team", name: "Active", meta: "", active: true, archived: false },
  { id: "archived-team", name: "Archived", meta: "", active: false, archived: true },
  { id: "mixed-team", name: "Mixed", meta: "", active: false, archived: false }
];

const rooms: SidebarRoomDisplay[] = [
  {
    id: "active-room",
    teamId: "active-team",
    name: "Active",
    detail: "",
    active: true,
    attention: 0,
    unread: 0,
    archived: false
  },
  {
    id: "archived-room",
    teamId: "mixed-team",
    name: "Archived",
    detail: "",
    active: false,
    attention: 0,
    unread: 0,
    archived: true
  }
];

test("sidebar visibility projects active and archived team-room state", () => {
  assert.deepEqual(
    visibleSidebarTeams(teams, rooms, false).map((team) => team.id),
    ["active-team", "mixed-team"]
  );
  assert.deepEqual(
    visibleSidebarTeams(teams, rooms, true).map((team) => team.id),
    ["archived-team", "mixed-team"]
  );
  assert.deepEqual(
    visibleSidebarRooms(rooms, teams[0], false).map((room) => room.id),
    ["active-room"]
  );
  assert.deepEqual(
    visibleSidebarRooms(rooms, teams[2], true).map((room) => room.id),
    ["archived-room"]
  );
});

test("sidebar empty-state copy reflects search and archive context", () => {
  assert.equal(sidebarTeamEmptyMessage(true, false, 0), "No teams found.");
  assert.equal(sidebarTeamEmptyMessage(false, false, 0), "No teams yet. Create one to start.");
  assert.equal(sidebarTeamEmptyMessage(false, true, 0), "No archived teams or rooms.");
  assert.equal(sidebarTeamEmptyMessage(false, true, 1), "No archived teams found.");
});
