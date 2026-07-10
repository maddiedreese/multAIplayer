import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createRoomActions } from "../src/lib/roomActions";
import { useAppStore } from "../src/store/appStore";

const room: RoomRecord = {
  id: "room-a",
  teamId: "team-a",
  name: "Room A",
  projectPath: "/workspace/a",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-room",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

function createOptions() {
  const selectedRoomIdRef = { current: room.id };
  const selectedTeamIdRef = { current: room.teamId };
  const busyRef = () => ({ current: {} as Record<string, boolean> });

  return {
    options: {
      selectedRoomIdRef,
      selectedTeamIdRef,
      busy: {
        gitWorkflowBusyRef: busyRef(),
        actionsBusyRef: busyRef(),
        localPreviewBusyRef: busyRef(),
        hostBusyRef: busyRef(),
        settingsBusyRef: busyRef(),
        keyRotationBusyRef: busyRef(),
        fileBusyRef: busyRef(),
        terminalBusyRef: busyRef()
      },
      maxTerminalActivityLines: 250,
      browser: {
        defaultBrowserUrl: "https://browser.example",
        defaultBrowserReason: "Review the app"
      },
      project: {
        roomsRef: { current: [room] },
        defaultCodexModel: "gpt-default",
        defaultProjectPath: "/workspace/default"
      }
    },
    selectedRoomIdRef,
    selectedTeamIdRef
  } satisfies {
    options: Parameters<typeof createRoomActions>[0];
    selectedRoomIdRef: { current: string };
    selectedTeamIdRef: { current: string };
  };
}

beforeEach(() => useAppStore.getState().resetAppStore());

test("room actions resolve store implementations when invoked", () => {
  const { options } = createOptions();
  const actions = createRoomActions(options);
  const calls: Array<[string, string | null]> = [];

  useAppStore.setState({
    setChatMessageForRoom: (roomId, message) => calls.push([roomId, message])
  });

  actions.setChatMessageForRoom("room-late", "latest action");
  assert.deepEqual(calls, [["room-late", "latest action"]]);
});

test("selected wrappers read the current room and team refs", () => {
  const { options, selectedRoomIdRef, selectedTeamIdRef } = createOptions();
  const actions = createRoomActions(options);
  const roomCalls: Array<[string, string | null]> = [];
  const teamCalls: Array<[string, string | null]> = [];

  selectedRoomIdRef.current = "room-b";
  selectedTeamIdRef.current = "team-b";
  useAppStore.setState({
    setHostMessageForRoom: (roomId, message) => roomCalls.push([roomId, message]),
    setTeamHistoryMessageForTeam: (teamId, message) => teamCalls.push([teamId, message])
  });

  actions.setSelectedHostMessage("current room");
  actions.setSelectedTeamHistoryMessage("current team");
  assert.deepEqual(roomCalls, [["room-b", "current room"]]);
  assert.deepEqual(teamCalls, [["team-b", "current team"]]);
});

test("room action adapters preserve external defaults and current room data", () => {
  const { options } = createOptions();
  const actions = createRoomActions(options);
  const browserCalls: unknown[][] = [];
  const modelCalls: unknown[][] = [];
  const pathCalls: unknown[][] = [];

  useAppStore.setState({
    setBrowserUrlForRoom: (...args) => browserCalls.push(args),
    setCustomCodexModelForRoom: (...args) => modelCalls.push(args),
    setProjectPathDraftForRoom: (...args) => pathCalls.push(args)
  });

  actions.setBrowserUrlForRoom(room.id, "https://next.example");
  actions.setCustomCodexModelForRoom(room.id, "gpt-next");
  actions.setProjectPathDraftForRoom(room.id, "/workspace/next");

  assert.deepEqual(browserCalls, [[room.id, "https://next.example", "https://browser.example"]]);
  assert.deepEqual(modelCalls, [[room.id, "gpt-next", room.codexModel]]);
  assert.deepEqual(pathCalls, [[room.id, "/workspace/next", room.projectPath]]);
});
