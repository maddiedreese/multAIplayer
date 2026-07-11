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
    localUser: { id: "github:maddie", name: "Maddie" },
    terminalBusyRef: { current: {} as Record<string, boolean> },
    reportRoomTerminalActionInFlight: () => false,
    maxTerminalActivityLines: 100,
    publishRequestStatus: async () => undefined,
    publishTerminalResult: async () => undefined,
    ...overrides
  };
}

test.beforeEach(() => {
  const store = useAppStore.getState();
  store.resetAppStore();
  store.initializeWorkspaceUi({ teams: [], rooms: [room], projectPath: room.projectPath, roomId: room.id });
  store.replaceCurrentUser({ id: "github:maddie", login: "maddie", name: "Maddie" });
});

test("terminal actions report host gating through the current store without React", async () => {
  const actions = createTerminalActions(createOptions({ isActiveHost: false }));
  useAppStore.getState().replaceCurrentUser(null);

  await actions.openInteractiveTerminal();

  assert.equal(
    useAppStore.getState().terminalRuntimeByRoom[room.id]?.ui?.error,
    "Only Maddie can approve host-side actions in this room."
  );
});

test("terminal actions reuse a running shell through Zustand without starting another terminal", async () => {
  const actions = createTerminalActions(createOptions());
  useAppStore.getState().syncTerminalSnapshotsForRoom(room.id, [runningTerminal]);

  await actions.openInteractiveTerminal();

  assert.equal(useAppStore.getState().terminalRuntimeByRoom[room.id]?.selectedTerminalId, runningTerminal.id);
});

test("terminal actions revoke native exact-command repeats and report the room-scoped result", async () => {
  const actions = createTerminalActions(createOptions());

  await actions.revokeExactCommandGrants();

  assert.deepEqual(useAppStore.getState().terminalRuntimeByRoom[room.id]?.lines, [
    "Revoked 0 native exact-command grants."
  ]);
  assert.equal(useAppStore.getState().terminalRuntimeByRoom[room.id]?.ui?.error ?? null, null);
});

test("terminal actions preserve the invocation-time in-flight safeguard", async () => {
  let reports = 0;
  const actions = createTerminalActions(
    createOptions({
      reportRoomTerminalActionInFlight: () => {
        reports += 1;
        return true;
      }
    })
  );

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
  const actions = createTerminalActions(
    createOptions({
      terminalBusyRef
    })
  );
  useAppStore.getState().appendTerminalRequest(room.id, request);

  await actions.approveTerminalRequest(request);

  assert.deepEqual(terminalBusyRef.current, {});
  assert.equal(useAppStore.getState().terminalRuntimeByRoom[room.id]?.busy ?? false, false);
  assert.match(useAppStore.getState().terminalRuntimeByRoom[room.id]?.ui?.error ?? "", /command is required/i);
});
