import type { MutableRefObject } from "react";
import type { RelayEnvelope, RoomRecord, TerminalRequestPlaintextPayload } from "@multaiplayer/protocol";
import { encryptJson } from "@multaiplayer/crypto";
import {
  getGitStatus,
  runShellCommand,
  startTerminal,
  stopTerminal,
  writeTerminal,
  type GitStatusSummary,
  type TerminalSnapshot
} from "../lib/localBackend";
import { loadOrCreateRoomSecret } from "../lib/localHistory";
import type { RelayClient } from "../lib/relayClient";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import {
  canActOnRoomTerminalRequest,
  findRoomTerminalRequest,
  roomTerminalRequestMessage,
  terminalRequestForApprovedRun
} from "../lib/terminalApproval";
import { canControlRoomTerminal, roomTerminalControlMessage } from "../lib/terminalAccess";
import { nextShellTerminalName, terminalInputForShellSubmit } from "../lib/terminalUi";
import type { RelayStatus, TerminalCommandRequest } from "../types";

const defaultInteractiveShellCommand = "exec zsh -f";

interface LocalUser {
  id: string;
  name: string;
}

interface UseTerminalActionsOptions {
  hasSelectedRoom: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  canRequestWorkspace: boolean;
  hostGateMessage: string;
  localWorkspaceMessage: string;
  workspaceRequestMessage: string;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  localUser: LocalUser;
  deviceId: string;
  relayStatus: RelayStatus;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  roomTerminals: TerminalSnapshot[];
  selectedTerminal: TerminalSnapshot | null;
  terminalName: string;
  terminalCommand: string;
  terminalInput: string;
  terminalRequests: TerminalCommandRequest[];
  reportRoomTerminalActionInFlight: (roomId: string) => boolean;
  setTerminalBusyForRoom: (roomId: string, busy: boolean) => void;
  setSelectedTerminalError: (message: string | null) => void;
  setTerminalErrorForRoom: (roomId: string, message: string | null) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
  upsertTerminalSnapshot: (snapshot: TerminalSnapshot) => void;
  setSelectedTerminalIdForRoom: (roomId: string, terminalId: string | null) => void;
  setTerminalNameForRoom: (roomId: string, name: string) => void;
  setTerminalCommandForRoom: (roomId: string, command: string) => void;
  setTerminalInputForRoom: (roomId: string, input: string) => void;
  appendTerminalRequest: (roomId: string, request: TerminalCommandRequest) => void;
  updateTerminalRequestStatus: (roomId: string, requestId: string, status: TerminalCommandRequest["status"]) => void;
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

export function useTerminalActions({
  hasSelectedRoom,
  isActiveHost,
  canReadLocalWorkspace,
  canRequestWorkspace,
  hostGateMessage,
  localWorkspaceMessage,
  workspaceRequestMessage,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  localUser,
  deviceId,
  relayStatus,
  relayRef,
  seenEnvelopeIds,
  roomTerminals,
  selectedTerminal,
  terminalName,
  terminalCommand,
  terminalInput,
  terminalRequests,
  reportRoomTerminalActionInFlight,
  setTerminalBusyForRoom,
  setSelectedTerminalError,
  setTerminalErrorForRoom,
  appendTerminalLinesForRoom,
  setGitStatusForRoom,
  upsertTerminalSnapshot,
  setSelectedTerminalIdForRoom,
  setTerminalNameForRoom,
  setTerminalCommandForRoom,
  setTerminalInputForRoom,
  appendTerminalRequest,
  updateTerminalRequestStatus,
  publishRequestStatus,
  publishTerminalResult
}: UseTerminalActionsOptions) {
  async function runApprovedTerminalCheck() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before running terminal commands.");
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
    const projectPath = room.projectPath;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    const command = "git status --short";
    appendTerminalLinesForRoom(roomId, [`$ ${command}`]);
    try {
      const result = await runShellCommand(projectPath, command);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      appendTerminalLinesForRoom(roomId, [
        output || `Command exited with ${result.status ?? "unknown"} and no output.`
      ]);
      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      appendTerminalLinesForRoom(roomId, [String(error)]);
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function startNamedTerminal() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before starting a terminal.");
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
    const name = terminalName.trim();
    const command = terminalCommand.trim();
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await startTerminal(
        roomId,
        name,
        room.projectPath,
        command
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
        setTerminalNameForRoom(roomId, name);
        setTerminalCommandForRoom(roomId, defaultInteractiveShellCommand);
        if (!options.quiet) setTerminalErrorForRoom(roomId, null);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
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

  async function sendTerminalInput() {
    const input = terminalInputForShellSubmit(terminalInput);
    if (!input) return;
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
        setTerminalInputForRoom(roomId, "");
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    }
  }

  async function requestTerminalCommand() {
    const command = terminalCommand.trim();
    if (!command) return;
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before requesting terminal commands.");
      return;
    }
    if (!canRequestWorkspace) {
      setSelectedTerminalError(workspaceRequestMessage);
      return;
    }
    const room = selectedRoom;
    setTerminalErrorForRoom(room.id, null);
    const request: TerminalCommandRequest = {
      id: crypto.randomUUID(),
      requester: localUser.name,
      requesterUserId: localUser.id,
      command,
      cwd: room.projectPath,
      requestedAt: new Date().toISOString(),
      status: "pending"
    };

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      appendTerminalRequest(room.id, request);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setTerminalErrorForRoom(room.id, "Saved command request locally because the relay is not connected.");
      }
      return;
    }

    try {
      const secret = await loadOrCreateRoomSecret(room.id);
      const payload: TerminalRequestPlaintextPayload = {
        id: request.id,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        command: request.command,
        cwd: request.cwd,
        requestedAt: request.requestedAt
      };
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        kind: "terminal.request",
        payload: await encryptJson(payload, secret)
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
      appendTerminalRequest(room.id, request);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setTerminalErrorForRoom(room.id, String(error));
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
    runApprovedTerminalCheck,
    startNamedTerminal,
    openInteractiveTerminal,
    restartSelectedTerminal,
    stopSelectedTerminal,
    sendTerminalInput,
    requestTerminalCommand,
    approveTerminalRequest,
    denyTerminalRequest
  };
}
