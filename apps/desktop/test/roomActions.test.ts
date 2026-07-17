import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { createRoomActions } from "../src/application/rooms/roomActions";
import { useAppStore } from "../src/store/appStore";

const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-a",
  teamId: "team-a",
  name: "Room A",
  projectPath: "/workspace/a",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-room",
  unread: 0
};

function createOptions() {
  const busyRef = () => ({ current: {} as Record<string, boolean> });

  return {
    options: {
      busy: {
        gitWorkflowBusyRef: busyRef(),
        actionsBusyRef: busyRef(),
        localPreviewBusyRef: busyRef(),
        hostBusyRef: busyRef(),
        settingsBusyRef: busyRef(),
        membershipCommitBusyRef: busyRef(),
        fileBusyRef: busyRef(),
        terminalBusyRef: busyRef()
      },
      maxTerminalActivityLines: 250,
      browser: {
        defaultBrowserUrl: "https://browser.example",
        defaultBrowserReason: "Review the app"
      },
      project: {
        defaultCodexModel: "gpt-default",
        defaultProjectPath: "/workspace/default"
      }
    }
  } satisfies {
    options: Parameters<typeof createRoomActions>[0];
  };
}

beforeEach(() => useAppStore.getState().resetAppStore());

test("room actions use the store implementation present when composed", () => {
  const { options } = createOptions();
  const calls: Array<[string, string | null]> = [];

  useAppStore.setState({
    setChatMessageForRoom: (roomId, message) => calls.push([roomId, message])
  });
  const actions = createRoomActions(options);

  actions.setChatMessageForRoom("room-a", "composed action");
  assert.deepEqual(calls, [["room-a", "composed action"]]);
});

test("room actions reuse stable store functions across view recomposition", () => {
  const calls: Array<[string, string | null]> = [];
  useAppStore.setState({
    setChatMessageForRoom: (roomId, message) => calls.push([roomId, message])
  });
  const first = createRoomActions(createOptions().options);
  const second = createRoomActions(createOptions().options);

  assert.equal(first.hydrateLocalRoomHistoryForRoom, second.hydrateLocalRoomHistoryForRoom);
  assert.equal(first.setChatMessageForRoom, second.setChatMessageForRoom);
  second.setChatMessageForRoom("room-after-recomposition", "same implementation");
  assert.deepEqual(calls, [["room-after-recomposition", "same implementation"]]);
});

test("selected wrappers read the current room and team from the store", () => {
  const { options } = createOptions();
  const roomCalls: Array<[string, string | null]> = [];
  const teamCalls: Array<[string, string | null]> = [];

  useAppStore.setState({
    setHostMessageForRoom: (roomId, message) => roomCalls.push([roomId, message]),
    setTeamHistoryMessageForTeam: (teamId, message) => teamCalls.push([teamId, message])
  });
  const actions = createRoomActions(options);
  useAppStore.setState({ selectedRoomId: "room-b", selectedTeam: "team-b" });

  actions.setSelectedHostMessage("current room");
  actions.setSelectedTeamHistoryMessage("current team");
  assert.deepEqual(roomCalls, [["room-b", "current room"]]);
  assert.deepEqual(teamCalls, [["team-b", "current team"]]);
});

test("room action adapters preserve external defaults and current room data", () => {
  const { options } = createOptions();
  const browserCalls: unknown[][] = [];
  const modelCalls: unknown[][] = [];
  const pathCalls: unknown[][] = [];

  useAppStore.setState({
    rooms: [room],
    setBrowserUrlForRoom: (...args) => browserCalls.push(args),
    setCustomCodexModelForRoom: (...args) => modelCalls.push(args),
    setProjectPathDraftForRoom: (...args) => pathCalls.push(args)
  });
  const actions = createRoomActions(options);

  actions.setBrowserUrlForRoom(room.id, "https://next.example");
  actions.setCustomCodexModelForRoom(room.id, "gpt-next");
  actions.setProjectPathDraftForRoom(room.id, "/workspace/next");

  assert.deepEqual(browserCalls, [[room.id, "https://next.example", "https://browser.example"]]);
  assert.deepEqual(modelCalls, [[room.id, "gpt-next", room.codexModel]]);
  assert.deepEqual(pathCalls, [[room.id, "/workspace/next", room.projectPath]]);
});
