import type { MutableRefObject } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  getGitStatus,
  runShellCommand,
  startTerminal,
  stopTerminal,
  writeTerminal,
  type GitStatusSummary,
  type TerminalSnapshot
} from "./localBackend";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import {
  canActOnRoomTerminalRequest,
  findRoomTerminalRequest,
  roomTerminalRequestMessage,
  terminalRequestForApprovedRun
} from "./terminalApproval";
import { canControlRoomTerminal, roomTerminalControlMessage } from "./terminalAccess";
import { nextShellTerminalName } from "./terminalUi";
import { omitRecordKey } from "./setUtils";
import { useAppStore } from "../store/appStore";
import type { TerminalCommandRequest } from "../types";

const defaultInteractiveShellCommand = "exec zsh -f";

interface LocalUser {
  id: string;
  name: string;
}

interface TerminalActionsOptions {
  hasSelectedRoom: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  hostGateMessage: string;
  localWorkspaceMessage: string;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  localUser: LocalUser;
  roomTerminals: TerminalSnapshot[];
  selectedTerminal: TerminalSnapshot | null;
  terminalRequests: TerminalCommandRequest[];
  terminalBusyRef: MutableRefObject<Record<string, boolean>>;
  reportRoomTerminalActionInFlight: (roomId: string) => boolean;
  maxTerminalActivityLines: number;
  publishRequestStatus: (
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: "approved" | "denied",
    room?: RoomRecord
  ) => Promise<void>;
  publishTerminalResult: (
    request: TerminalCommandRequest,
    result: {
      startedAt: string;
      finishedAt: string;
      exitStatus: number | null;
      stdout: string;
      stderr: string;
      error?: string;
    },
    room?: RoomRecord
  ) => Promise<void>;
}

export function createTerminalActions({
  hasSelectedRoom,
  isActiveHost,
  canReadLocalWorkspace,
  hostGateMessage,
  localWorkspaceMessage,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  localUser,
  roomTerminals,
  selectedTerminal,
  terminalRequests,
  terminalBusyRef,
  reportRoomTerminalActionInFlight,
  maxTerminalActivityLines,
  publishRequestStatus,
  publishTerminalResult
}: TerminalActionsOptions) {
  function setTerminalBusyForRoom(roomId: string, busy: boolean) {
    terminalBusyRef.current = busy
      ? { ...terminalBusyRef.current, [roomId]: true }
      : omitRecordKey(terminalBusyRef.current, roomId);
    useAppStore.getState().setTerminalBusyForRoom(roomId, busy);
  }

  function setSelectedTerminalError(message: string | null) {
    useAppStore.getState().setTerminalErrorForRoom(selectedRoom.id, message);
  }

  function setTerminalErrorForRoom(roomId: string, message: string | null) {
    useAppStore.getState().setTerminalErrorForRoom(roomId, message);
  }

  function appendTerminalLinesForRoom(roomId: string, lines: string[]) {
    useAppStore.getState().appendTerminalLinesForRoom(roomId, lines, maxTerminalActivityLines);
  }

  function upsertTerminalSnapshot(snapshot: TerminalSnapshot) {
    useAppStore.getState().upsertTerminalSnapshot(snapshot);
  }

  function setSelectedTerminalIdForRoom(roomId: string, terminalId: string | null) {
    useAppStore.getState().setSelectedTerminalIdForRoom(roomId, terminalId);
  }

  function updateTerminalRequestStatus(
    roomId: string,
    requestId: string,
    status: TerminalCommandRequest["status"]
  ) {
    useAppStore.getState().updateTerminalRequestStatus(roomId, requestId, status);
  }

  function setGitStatusForRoom(roomId: string, status: GitStatusSummary | null) {
    useAppStore.getState().setGitStatusForRoom(roomId, status);
  }
  async function openInteractiveTerminal(options: { reuseExisting?: boolean; quiet?: boolean } = {}) {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before opening a terminal.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    const existingShell = roomTerminals.find((terminal) => terminal.running);
    if (options.reuseExisting !== false && existingShell) {
      setSelectedTerminalIdForRoom(roomId, existingShell.id);
      if (!options.quiet) setTerminalErrorForRoom(roomId, null);
      return;
    }
    const name = nextShellTerminalName(roomTerminals);
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await startTerminal(
        roomId,
        name,
        room.projectPath,
        defaultInteractiveShellCommand
      );
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        upsertTerminalSnapshot(snapshot);
        setSelectedTerminalIdForRoom(roomId, snapshot.id);
        if (!options.quiet) setTerminalErrorForRoom(roomId, null);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setTerminalErrorForRoom(roomId, String(error));
      }
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function restartSelectedTerminal() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before restarting terminals.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    if (!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)) {
      setSelectedTerminalError(roomTerminalControlMessage(selectedRoom, selectedTerminal, isSelectedRoomLocked));
      return;
    }
    const terminal = selectedTerminal;
    if (!terminal) return;
    const roomId = selectedRoom.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await startTerminal(
        roomId,
        terminal.name,
        terminal.cwd || selectedRoom.projectPath,
        terminal.command
      );
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        upsertTerminalSnapshot(snapshot);
        setSelectedTerminalIdForRoom(roomId, snapshot.id);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function stopSelectedTerminal() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before stopping terminals.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    if (!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)) {
      setSelectedTerminalError(roomTerminalControlMessage(selectedRoom, selectedTerminal, isSelectedRoomLocked));
      return;
    }
    const terminal = selectedTerminal;
    if (!terminal) return;
    const roomId = selectedRoom.id;
    const terminalId = terminal.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await stopTerminal(terminalId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        upsertTerminalSnapshot(snapshot);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function sendTerminalData(input: string) {
    if (!input) return;
    await writeRawTerminalInput(input);
  }

  async function writeRawTerminalInput(input: string) {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before sending terminal input.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    if (!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)) {
      setSelectedTerminalError(roomTerminalControlMessage(selectedRoom, selectedTerminal, isSelectedRoomLocked));
      return;
    }
    const terminal = selectedTerminal;
    if (!terminal) return;
    const roomId = selectedRoom.id;
    const terminalId = terminal.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await writeTerminal(terminalId, input);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        upsertTerminalSnapshot(snapshot);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    }
  }

  async function approveTerminalRequest(request: TerminalCommandRequest) {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before approving terminal requests.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    const roomRequest = findRoomTerminalRequest(terminalRequests, request.id);
    if (!roomRequest || !canActOnRoomTerminalRequest(terminalRequests, request.id)) {
      setTerminalErrorForRoom(roomId, roomTerminalRequestMessage(terminalRequests, request.id));
      return;
    }
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    let approvedRequest: TerminalCommandRequest;
    try {
      approvedRequest = terminalRequestForApprovedRun(roomRequest, room.projectPath);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
      setTerminalBusyForRoom(roomId, false);
      return;
    }
    updateTerminalRequestStatus(room.id, approvedRequest.id, "approved");
    publishRequestStatus("terminal.event", approvedRequest.id, "approved", room).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    });
    const projectPath = room.projectPath;
    appendTerminalLinesForRoom(roomId, [
      `${approvedRequest.requester} requested: ${approvedRequest.command}`,
      `$ ${approvedRequest.command}`,
      ...(roomRequest.cwd !== approvedRequest.cwd ? [`Running in room project: ${approvedRequest.cwd}`] : [])
    ]);
    const startedAt = new Date().toISOString();
    try {
      const result = await runShellCommand(approvedRequest.cwd, approvedRequest.command);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      appendTerminalLinesForRoom(roomId, [
        output || `Command exited with ${result.status ?? "unknown"} and no output.`
      ]);
      publishTerminalResult(approvedRequest, {
        startedAt,
        finishedAt: new Date().toISOString(),
        exitStatus: result.status ?? null,
        stdout: result.stdout,
        stderr: result.stderr
      }, room).catch((error) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
      });
      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      appendTerminalLinesForRoom(roomId, [String(error)]);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
      publishTerminalResult(approvedRequest, {
        startedAt,
        finishedAt: new Date().toISOString(),
        exitStatus: null,
        stdout: "",
        stderr: "",
        error: String(error)
      }, room).catch((publishError) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(publishError));
      });
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  function denyTerminalRequest(requestId: string) {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before denying terminal requests.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    if (!canActOnRoomTerminalRequest(terminalRequests, requestId)) {
      setTerminalErrorForRoom(room.id, roomTerminalRequestMessage(terminalRequests, requestId));
      return;
    }
    updateTerminalRequestStatus(room.id, requestId, "denied");
    publishRequestStatus("terminal.event", requestId, "denied", room).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setTerminalErrorForRoom(room.id, String(error));
    });
  }

  return {
    openInteractiveTerminal,
    restartSelectedTerminal,
    stopSelectedTerminal,
    sendTerminalData,
    approveTerminalRequest,
    denyTerminalRequest
  };
}
