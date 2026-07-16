import type { MutableRefObject } from "react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canHostBrowserAction } from "../../lib/browser/browserPolicy";
import { extractCodexBrowserOpenUrl } from "../../lib/codex/codexInvoke";
import { formatBrowserAccessLabel } from "../../lib/browser/browserUi";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { useAppStore } from "../../store/appStore";
import type { BrowserAccessRequest, ChatMessage } from "../../types";

interface LocalUser {
  id: string;
  name: string;
}

interface CreateCodexBrowserOpenCommandOptions {
  localUser: LocalUser;
  selectedRoomIdRef: MutableRefObject<string>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  defaultBrowserUrl: string;
}

export type CodexBrowserOpenCommandSource = { kind: "local_host" } | { kind: "incoming_room"; senderUserId: string };

export type HandleCodexBrowserOpenCommand = (
  message: ChatMessage,
  room: ClientRoomRecord,
  source: CodexBrowserOpenCommandSource
) => boolean;

export function createCodexBrowserOpenCommand({
  localUser,
  selectedRoomIdRef,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  defaultBrowserUrl
}: CreateCodexBrowserOpenCommandOptions) {
  return (message: ChatMessage, room: ClientRoomRecord, source: CodexBrowserOpenCommandSource): boolean => {
    const url = extractCodexBrowserOpenUrl(message.body);
    if (!url) return false;

    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    if (!canHostBrowserAction(room, localUser, roomLocked)) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        useAppStore.getState().setBrowserMessageForRoom(room.id, "Only the active host can open the in-room browser.");
      }
      return true;
    }

    const request: BrowserAccessRequest = {
      id: crypto.randomUUID(),
      requester: source.kind === "local_host" ? localUser.name : message.author,
      requesterUserId: source.kind === "local_host" ? localUser.id : source.senderUserId,
      url,
      reason:
        source.kind === "local_host"
          ? `Opened by ${message.author} through Codex.`
          : `Requested by ${message.author} through Codex.`,
      requestedAt: new Date().toISOString(),
      status: source.kind === "local_host" ? "approved" : "pending"
    };
    const store = useAppStore.getState();
    store.appendBrowserRequest(room.id, request);
    if (source.kind === "incoming_room") {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        store.setBrowserMessageForRoom(
          room.id,
          `${message.author} requested browser access to ${formatBrowserAccessLabel(request.url)}.`
        );
        store.setInspectorTabForRoom(room.id, "browser");
      }
      return true;
    }
    store.setBrowserMessageForRoom(room.id, null);
    store.setBrowserUrlForRoom(room.id, request.url, defaultBrowserUrl);
    store.openEmbeddedBrowserForRoom(room.id, request.url);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
      store.setBrowserMessageForRoom(room.id, `Opened in-room browser for ${formatBrowserAccessLabel(request.url)}.`);
      store.setInspectorTabForRoom(room.id, "browser");
    }
    return true;
  };
}
