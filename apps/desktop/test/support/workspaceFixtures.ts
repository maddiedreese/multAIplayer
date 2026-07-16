import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  defaultRoomMode,
  type ClientRoomRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import type { ChatMessage } from "../../src/types";

export const seededTeams: TeamRecord[] = [{ id: "team-core", name: "Core Team", members: 2, role: "owner" }];

const roomDefaults = {
  approvalPolicy: "ask_every_turn" as const,
  mode: defaultRoomMode,
  codexModel: defaultCodexModel,
  codexReasoningEffort: defaultCodexReasoningEffort,
  codexSpeed: defaultCodexSpeed,
  codexSandboxLevel: "workspace_write" as const,
  browserAllowedOrigins: defaultBrowserAllowedOrigins,
  browserProfilePersistent: defaultBrowserProfilePersistent,
  unread: 0
};

export const seededRooms: ClientRoomRecord[] = [
  {
    ...roomDefaults,
    id: "room-desktop",
    teamId: "team-core",
    name: "Desktop app",
    projectPath: "/test/workspace",
    host: "Test User",
    hostUserId: "github:test-user",
    hostStatus: "active"
  },
  {
    ...roomDefaults,
    id: "room-relay",
    teamId: "team-core",
    name: "Relay ops",
    projectPath: "/test/workspace",
    host: "Other User",
    hostUserId: "github:other-user",
    hostStatus: "handoff",
    unread: 2
  }
];

export const initialMessagesByRoom: Record<string, ChatMessage[]> = {
  "room-desktop": [
    {
      id: "message-1",
      author: "Test User",
      role: "human",
      body: "We need to capture onboarding progress and improve the stepper.",
      time: "09:41"
    }
  ],
  "room-relay": []
};
