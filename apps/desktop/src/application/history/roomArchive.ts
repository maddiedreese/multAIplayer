import type { AppStoreState } from "../../store/appStore";
import type { ChatAttachment, ChatMessage } from "../../types";
import type { RoomArchiveBody } from "../../lib/platform/localBackend";
import {
  normalizeLocalRoomHistory,
  normalizeReadOnlyRoomArchiveHistory
} from "../../lib/history/localRoomHistoryPayload";

export const roomArchiveOmissions = [
  "MLS group, epoch, exporter, device, signing, HPKE, and private-key state",
  "invite capabilities, KeyPackages, Welcome messages, and pending admissions",
  "pending approvals, queued turns, active goals, host handoff authority, and Codex thread/session ids",
  "attachment blob ciphertext and live process authority",
  "workspace paths are reduced to display basenames in terminal transcripts"
] as const;

export function buildReadOnlyRoomArchive(
  state: AppStoreState,
  roomId: string,
  roomName: string,
  teamName?: string,
  exportedAt = new Date().toISOString()
): RoomArchiveBody {
  const codex = state.codexRuntimeByRoom[roomId] ?? {};
  const git = state.gitWorkflowRuntimeByRoom[roomId] ?? {};
  const terminal = state.terminalRuntimeByRoom[roomId] ?? {};
  const filePanel = state.filePanelByRoom[roomId] ?? {};
  const browser = state.browserByRoom[roomId] ?? {};
  const preview = state.localPreviewByRoom[roomId] ?? {};
  const workflow = git.workflow ?? {};
  const actions = git.actions ?? {};
  return {
    version: 1,
    exportedAt,
    source: { roomName, ...(teamName ? { teamName } : {}) },
    omissions: [...roomArchiveOmissions],
    history: {
      version: 1,
      messages: values(state.messagesByRoom[roomId]).map(sanitizeMessage),
      chatEdits: values(state.chatEditsByRoom[roomId]),
      chatDeletes: values(state.chatDeletesByRoom[roomId]),
      terminalRequests: values(terminal.requests).filter(isResolved),
      fileSaveRequests: values(filePanel.saveRequests).filter(isResolved),
      browserRequests: values(browser.requests).filter(isResolved),
      codexEvents: values(codex.events),
      codexActivities: values(codex.activities),
      gitWorkflowEvents: values(workflow.events),
      githubActionsEvents: values(actions.events),
      localPreviews: values(preview.previews),
      terminalSnapshots: state.terminals
        .filter((terminal) => terminal.roomId === roomId && !terminal.running)
        .map(sanitizeTerminal)
    }
  };
}

function values<T>(input: T[] | undefined): T[] {
  return input ?? [];
}

export interface ReadOnlyRoomArchiveProjection {
  roomName: string;
  teamName?: string;
  exportedAt: string;
  omissions: string[];
  history: ReturnType<typeof normalizeLocalRoomHistory>;
}

/** Converts untrusted decrypted JSON to the same bounded history types used by live local history. */
export function projectReadOnlyRoomArchive(archive: RoomArchiveBody): ReadOnlyRoomArchiveProjection {
  const history = normalizeReadOnlyRoomArchiveHistory({
    messages: archive.history.messages,
    chatEdits: archive.history.chatEdits,
    chatDeletes: archive.history.chatDeletes,
    terminalRequests: archive.history.terminalRequests,
    fileSaveRequests: archive.history.fileSaveRequests,
    browserRequests: archive.history.browserRequests,
    inviteRequests: [],
    codexEvents: archive.history.codexEvents,
    codexActivities: archive.history.codexActivities,
    gitWorkflowEvents: archive.history.gitWorkflowEvents,
    githubActionsEvents: archive.history.githubActionsEvents,
    localPreviews: archive.history.localPreviews,
    terminalSnapshots: archive.history.terminalSnapshots,
    hostHandoffs: [],
    queuedCodexTurns: [],
    ...(archive.history.roomGoal ? { roomGoal: archive.history.roomGoal } : {})
  });
  return {
    roomName: archive.source.roomName,
    ...(archive.source.teamName ? { teamName: archive.source.teamName } : {}),
    exportedAt: archive.exportedAt,
    omissions: archive.omissions,
    history
  };
}

function isResolved(value: { status: string }): boolean {
  return value.status !== "pending";
}

function sanitizeMessage(message: ChatMessage): ChatMessage {
  const attachments = message.attachments?.map(sanitizeAttachment);
  return {
    ...message,
    ...(attachments ? { attachments } : {})
  };
}

function sanitizeAttachment(attachment: ChatAttachment): Omit<ChatAttachment, "blobId"> & {
  blobCiphertextOmitted: true;
} {
  const { blobId: _blobId, ...display } = attachment;
  return { ...display, blobCiphertextOmitted: true };
}

function sanitizeTerminal<T extends { cwd: string; running: boolean }>(
  terminal: T
): T & { cwd: string; running: false } {
  return { ...terminal, cwd: terminal.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace", running: false };
}
