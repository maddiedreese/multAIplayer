import {
  defaultCodexModel,
  defaultCodexModelPolicy,
  defaultCodexReasoningEffort,
  defaultCodexReasoningEffortPolicy,
  defaultCodexRawReasoningEnabled,
  defaultCodexServiceTierPolicy,
  defaultCodexSpeed,
  type ClientRoomRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import type { ChatMessage, HostHandoffRecord, LocalRoomHistoryPayload } from "../../src/types";

export const seededTeams: TeamRecord[] = [{ id: "team-core", name: "Core Team", members: 2, role: "owner" }];

const roomDefaults = {
  activeHostDeviceId: "nonbrowser",
  approvalPolicy: "ask_every_turn" as const,
  codexModel: defaultCodexModel,
  codexModelPolicy: defaultCodexModelPolicy,
  codexReasoningEffort: defaultCodexReasoningEffort,
  codexReasoningEffortPolicy: defaultCodexReasoningEffortPolicy,
  codexRawReasoningEnabled: defaultCodexRawReasoningEnabled,
  codexSpeed: defaultCodexSpeed,
  codexServiceTierPolicy: defaultCodexServiceTierPolicy,
  codexSandboxLevel: "workspace_write" as const,
  configRevision: 0,
  configEpoch: 0,
  configPending: false,
  unread: 0
} as const;

export const defaultTestRoom: ClientRoomRecord = {
  ...roomDefaults,
  id: "room-test",
  teamId: "team-test",
  name: "Test room",
  projectPath: "/test/workspace",
  host: "Test User",
  hostUserId: "github:test-user",
  hostStatus: "active"
};

export const defaultTestHandoff: HostHandoffRecord = {
  id: "handoff-test",
  fromHost: "Test User",
  fromUserId: "github:test-user",
  reason: "manual",
  projectPath: "/test/workspace",
  codexModel: defaultCodexModel,
  codexModelPolicy: defaultCodexModelPolicy,
  codexReasoningEffort: defaultCodexReasoningEffort,
  codexReasoningEffortPolicy: defaultCodexReasoningEffortPolicy,
  codexRawReasoningEnabled: defaultCodexRawReasoningEnabled,
  codexSpeed: defaultCodexSpeed,
  codexServiceTierPolicy: defaultCodexServiceTierPolicy,
  codexSandboxLevel: "workspace_write",
  approvalPolicy: "ask_every_turn",
  messagesSinceLastCodex: 0,
  queuedCodexTurns: [],
  attachmentNames: [],
  terminals: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "available"
};

export const emptyTestHistory: LocalRoomHistoryPayload = {
  version: 3,
  messages: [],
  chatEdits: [],
  chatDeletes: [],
  readState: { unread: 0 },
  terminalRequests: [],
  fileSaveRequests: [],
  browserRequests: [],
  inviteRequests: [],
  codexEvents: [],
  codexActivities: [],
  gitWorkflowEvents: [],
  githubActionsEvents: [],
  localPreviews: [],
  terminalSnapshots: [],
  hostHandoffs: [],
  queuedCodexTurns: []
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
    hostStatus: "active",
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
