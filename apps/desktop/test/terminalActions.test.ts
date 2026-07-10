import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createTerminalActions } from "../src/lib/terminalActions";
import type { TerminalSnapshot } from "../src/lib/localBackend";
import { useAppStore } from "../src/store/appStore";
import type { TerminalCommandRequest } from "../src/types";

const room: RoomRecord = {
  id: "room-terminal-actions",
  teamId: "team-terminal-actions",
  name: "Terminal Actions",
  projectPath: "/tmp/terminal-actions",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

const runningTerminal: TerminalSnapshot = {
  id: "terminal-running",
  roomId: room.id,
  name: "shell",
  cwd: room.projectPath,
  command: "exec zsh -f",
  running: true,
  exitStatus: null,
  startedAt: "2026-07-09T12:00:00.000Z",
  lines: []
};

function createOptions(overrides: Partial<Parameters<typeof createTerminalActions>[0]> = {}) {
  return {
    hasSelectedRoom: true,
    isActiveHost: true,
    canReadLocalWorkspace: true,
    hostGateMessage: "Only the active host can control terminals.",
    localWorkspaceMessage: "Workspace unavailable.",
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    isSelectedRoomLocked: false,
    localUser: { id: "github:maddie", name: "Maddie" },
    roomTerminals: [] as TerminalSnapshot[],
    selectedTerminal: null,
    terminalRequests: [],
    terminalBusyRef: { current: {} as Record<string, boolean> },
    reportRoomTerminalActionInFlight: () => false,
    maxTerminalActivityLines: 100,
    publishRequestStatus: async () => undefined,
    publishTerminalResult: async () => undefined,
    ...overrides
  };
}

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("terminal actions report host gating through the current store without React", async () => {
  const actions = createTerminalActions(createOptions({ isActiveHost: false }));

  await actions.openInteractiveTerminal();

  assert.equal(
    useAppStore.getState().terminalRuntimeByRoom[room.id]?.ui?.error,
    "Only the active host can control terminals."
  );
});

test("terminal actions reuse a running shell through Zustand without starting another terminal", async () => {
  const actions = createTerminalActions(createOptions({ roomTerminals: [runningTerminal] }));

  await actions.openInteractiveTerminal();

  assert.equal(
    useAppStore.getState().terminalRuntimeByRoom[room.id]?.selectedTerminalId,
    runningTerminal.id
  );
});

test("terminal actions preserve the invocation-time in-flight safeguard", async () => {
  let reports = 0;
  const actions = createTerminalActions(createOptions({
    reportRoomTerminalActionInFlight: () => {
      reports += 1;
      return true;
    }
  }));

  await actions.openInteractiveTerminal({ reuseExisting: false });

  assert.equal(reports, 1);
  assert.equal(useAppStore.getState().terminalRuntimeByRoom[room.id]?.busy ?? false, false);
});

test("terminal actions keep the busy ref and store synchronized on early approval failure", async () => {
  const terminalBusyRef = { current: {} as Record<string, boolean> };
  const request: TerminalCommandRequest = {
    id: "request-empty-command",
    requester: "Jordan",
    requesterUserId: "github:jordan",
    command: "   ",
    cwd: "/tmp/elsewhere",
    requestedAt: "2026-07-09T12:01:00.000Z",
    status: "pending"
  };
  const actions = createTerminalActions(createOptions({
    terminalBusyRef,
    terminalRequests: [request]
  }));

  await actions.approveTerminalRequest(request);

  assert.deepEqual(terminalBusyRef.current, {});
  assert.equal(useAppStore.getState().terminalRuntimeByRoom[room.id]?.busy ?? false, false);
  assert.match(
    useAppStore.getState().terminalRuntimeByRoom[room.id]?.ui?.error ?? "",
    /command is required/i
  );
});
