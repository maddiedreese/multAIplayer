import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord,
  type TeamRole
} from "@multaiplayer/protocol";
import type { RelayStore } from "./state.js";

export function seedWorkspace(options: {
  store: RelayStore;
  seedDemoWorkspace: boolean;
  scheduleStoreSave: () => void;
}) {
  if (!options.seedDemoWorkspace) return;

  const core: TeamRecord = { id: "team-core", name: "Core Team", members: 4 };
  const labs: TeamRecord = { id: "team-labs", name: "Labs", members: 2 };
  if (!options.store.hasTeam(core.id)) options.store.setTeam(core);
  if (!options.store.hasTeam(labs.id)) options.store.setTeam(labs);
  if (!options.store.getTeamMembers(core.id)) {
    options.store.setTeamMembers(core.id, new Map([
      ["github:maddiedreese", seedTeamMember(core.id, "github:maddiedreese", "owner")],
      ["github:alex", seedTeamMember(core.id, "github:alex", "admin")],
      ["github:tester", seedTeamMember(core.id, "github:tester", "member")],
      ["github:design", seedTeamMember(core.id, "github:design", "member")]
    ]));
  }
  if (!options.store.getTeamMembers(labs.id)) {
    options.store.setTeamMembers(labs.id, new Map([
      ["github:labs", seedTeamMember(labs.id, "github:labs", "owner")],
      ["github:research", seedTeamMember(labs.id, "github:research", "member")]
    ]));
  }

  const seedRooms: RoomRecord[] = [
    {
      id: "room-desktop",
      teamId: core.id,
      name: "Desktop client",
      projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
      host: "Maddie",
      hostUserId: "github:maddiedreese",
      hostStatus: "active",
      approvalPolicy: "ask_every_turn",
      mode: { ...defaultRoomMode, browser: true },
      codexModel: defaultCodexModel,
      browserAllowedOrigins: defaultBrowserAllowedOrigins,
      browserProfilePersistent: defaultBrowserProfilePersistent,
      unread: 0
    },
    {
      id: "room-relay",
      teamId: core.id,
      name: "Relay + E2EE",
      projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
      host: "Alex",
      hostUserId: "github:alex",
      hostStatus: "handoff",
      approvalPolicy: "auto_chat_only",
      mode: defaultRoomMode,
      codexModel: "gpt-5.4-mini",
      browserAllowedOrigins: defaultBrowserAllowedOrigins,
      browserProfilePersistent: defaultBrowserProfilePersistent,
      unread: 2
    },
    {
      id: "room-github",
      teamId: labs.id,
      name: "GitHub flow",
      projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
      host: "No host",
      hostUserId: undefined,
      hostStatus: "offline",
      approvalPolicy: "never_host",
      mode: defaultRoomMode,
      codexModel: "gpt-5.4-thinking",
      browserAllowedOrigins: defaultBrowserAllowedOrigins,
      browserProfilePersistent: defaultBrowserProfilePersistent,
      unread: 0
    }
  ];
  for (const room of seedRooms) {
    if (!options.store.getRoom(room.id)) options.store.setRoom(room);
  }
  options.scheduleStoreSave();
}

function seedTeamMember(teamId: string, userId: string, role: TeamRole): TeamMemberRecord {
  return {
    teamId,
    userId,
    role,
    joinedAt: "2026-07-04T00:00:00.000Z"
  };
}
