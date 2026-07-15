import {
  BrowserRequestPlaintextPayload,
  CodexActivityPlaintextPayload,
  CodexApprovalPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  LocalPreviewPlaintextPayload,
  RequestStatusPlaintextPayload,
  TerminalRequestPlaintextPayload,
  TerminalResultPlaintextPayload,
  WorkspaceFileSaveRequestPlaintextPayload
} from "@multaiplayer/protocol";
import {
  buildCodexEventLine,
  buildGitHubActionsEventLines,
  buildGitWorkflowEventLines,
  buildTerminalResultLines
} from "../../presentation/activity/activityLines";
import { plaintextUserMatchesEnvelope } from "../../application/mls/mlsApplicationMessage";
import { maxTerminalActivityLines } from "../../appDefaults";
import type { QueuedCodexTurn } from "../../types";
import type { MlsMessageStoreActions, RoutedMlsMessage } from "./mlsMessageRouteTypes";

export async function routeActivityMessage(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
): Promise<boolean> {
  if (envelope.kind === "terminal.request") {
    await routeTerminalRequest(envelope, store, decrypt);
    return true;
  }
  if (envelope.kind === "terminal.event") {
    await routeTerminalEvent(envelope, store, decrypt);
    return true;
  }
  if (envelope.kind === "git.event") {
    await routeGitEvent(envelope, store, decrypt);
    return true;
  }
  if (
    envelope.kind === "codex.event" ||
    envelope.kind === "codex.activity" ||
    envelope.kind === "codex.approval" ||
    envelope.kind === "codex.queue"
  ) {
    await routeCodexActivity(envelope, store, decrypt);
    return true;
  }
  if (
    envelope.kind === "browser.request" ||
    envelope.kind === "browser.event" ||
    envelope.kind === "workspace.request" ||
    envelope.kind === "workspace.event"
  ) {
    await routeInteractiveRequest(envelope, store, decrypt);
    return true;
  }
  if (envelope.kind === "preview.event") {
    const parsed = LocalPreviewPlaintextPayload.safeParse(await decrypt());
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.sharedByUserId)) {
      store.appendLocalPreviewEvent(envelope.roomId, parsed.data);
      store.setChatMessageForRoom(
        envelope.roomId,
        parsed.data.status === "live"
          ? `${parsed.data.sharedBy} shared a local preview.`
          : parsed.data.status === "stopped"
            ? `${parsed.data.sharedBy} stopped sharing a local preview.`
            : (parsed.data.message ?? "Local preview status changed.")
      );
    }
    return true;
  }
  return false;
}

async function routeTerminalRequest(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const parsed = TerminalRequestPlaintextPayload.safeParse(await decrypt());
  if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requesterUserId))
    store.appendTerminalRequest(envelope.roomId, { ...parsed.data, status: "pending" });
}

async function routeTerminalEvent(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const plaintext = await decrypt();
  const result = TerminalResultPlaintextPayload.safeParse(plaintext);
  if (result.success && plaintextUserMatchesEnvelope(envelope, result.data.ranByUserId)) {
    store.appendTerminalLinesForRoom(envelope.roomId, buildTerminalResultLines(result.data), maxTerminalActivityLines);
    return;
  }
  const status = RequestStatusPlaintextPayload.safeParse(plaintext);
  if (status.success && plaintextUserMatchesEnvelope(envelope, status.data.decidedByUserId))
    store.updateTerminalRequestStatus(envelope.roomId, status.data.requestId, status.data.status);
}

async function routeGitEvent(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const plaintext = await decrypt();
  const workflow = GitWorkflowEventPlaintextPayload.safeParse(plaintext);
  if (workflow.success && plaintextUserMatchesEnvelope(envelope, workflow.data.runnerUserId)) {
    store.appendGitWorkflowEvent(envelope.roomId, workflow.data);
    store.appendTerminalLinesForRoom(
      envelope.roomId,
      buildGitWorkflowEventLines(workflow.data),
      maxTerminalActivityLines
    );
    store.setGitWorkflowMessageForRoom(envelope.roomId, workflow.data.message);
  }
  const actions = GitHubActionsEventPlaintextPayload.safeParse(plaintext);
  if (actions.success && plaintextUserMatchesEnvelope(envelope, actions.data.checkedByUserId)) {
    store.applyGitHubActionsEventForRoom(envelope.roomId, actions.data);
    store.appendTerminalLinesForRoom(
      envelope.roomId,
      buildGitHubActionsEventLines(actions.data),
      maxTerminalActivityLines
    );
  }
}

async function routeCodexActivity(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const plaintext = await decrypt();
  if (envelope.kind === "codex.event") {
    const parsed = CodexEventPlaintextPayload.safeParse(plaintext);
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.hostUserId)) {
      store.appendCodexEvent(envelope.roomId, parsed.data);
      store.appendTerminalLinesForRoom(envelope.roomId, [buildCodexEventLine(parsed.data)], maxTerminalActivityLines);
    }
    return;
  }
  if (envelope.kind === "codex.activity") {
    const parsed = CodexActivityPlaintextPayload.safeParse(plaintext);
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.hostUserId))
      store.upsertCodexActivity(envelope.roomId, parsed.data);
    return;
  }
  if (envelope.kind === "codex.approval") {
    const parsed = CodexApprovalPlaintextPayload.safeParse(plaintext);
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.approverUserId))
      store.setHostMessageForRoom(
        envelope.roomId,
        "Ignored delegated Codex approval. Only the active host can authorize Codex turns."
      );
    return;
  }
  const parsed = CodexQueuePlaintextPayload.safeParse(plaintext);
  if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requestedByUserId))
    handleCodexQueueEvent(parsed.data, envelope.roomId, store);
}

async function routeInteractiveRequest(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const plaintext = await decrypt();
  if (envelope.kind === "browser.request") {
    const parsed = BrowserRequestPlaintextPayload.safeParse(plaintext);
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requesterUserId))
      store.appendBrowserRequest(envelope.roomId, { ...parsed.data, status: "pending" });
    return;
  }
  if (envelope.kind === "workspace.request") {
    const parsed = WorkspaceFileSaveRequestPlaintextPayload.safeParse(plaintext);
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requesterUserId)) {
      store.appendFileSaveRequest(envelope.roomId, { ...parsed.data, status: "pending" });
      store.setChatMessageForRoom(envelope.roomId, `${parsed.data.requester} requested a file save.`);
    }
    return;
  }
  const parsed = RequestStatusPlaintextPayload.safeParse(plaintext);
  if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.decidedByUserId)) {
    if (envelope.kind === "browser.event")
      store.updateBrowserRequestStatus(envelope.roomId, parsed.data.requestId, parsed.data.status);
    else store.updateFileSaveRequestStatus(envelope.roomId, parsed.data.requestId, parsed.data.status);
  }
}

export function handleCodexQueueEvent(
  event: import("@multaiplayer/protocol").CodexQueuePlaintextPayload,
  roomId: string,
  store: MlsMessageStoreActions
): void {
  if (event.action === "queued" || event.action === "promoted") {
    const turn: QueuedCodexTurn = {
      roomId,
      turnId: event.turnId,
      requestedBy: event.requestedBy,
      requestedByUserId: event.requestedByUserId,
      queuedAt: event.createdAt,
      ...(event.triggerMessageId ? { triggerMessageId: event.triggerMessageId } : {})
    };
    store.enqueueCodexApprovalForRoom(roomId, turn);
    store.setHostMessageForRoom(roomId, `${event.requestedBy} proposed a Codex turn for host approval.`);
    return;
  }
  store.removeQueuedCodexApprovalForRoom(roomId, event.turnId);
  store.setPendingCodexApprovalForRoom(roomId, null);
  store.setApprovalVisibleForRoom(roomId, false);
  store.setHostMessageForRoom(roomId, event.reason ?? `${event.requestedBy}'s Codex turn was ${event.action}.`);
}
