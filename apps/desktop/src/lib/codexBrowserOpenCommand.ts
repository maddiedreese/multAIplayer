import type { MutableRefObject } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canHostBrowserAction } from "./browserPolicy";
import { extractCodexBrowserOpenUrl } from "./codexInvoke";
import { formatBrowserAccessLabel } from "./browserUi";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import { useAppStore } from "../store/appStore";
import type { BrowserAccessRequest, ChatMessage } from "../types";

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

export function createCodexBrowserOpenCommand({
  localUser,
  selectedRoomIdRef,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  defaultBrowserUrl
}: CreateCodexBrowserOpenCommandOptions) {
  return (message: ChatMessage, room: RoomRecord): boolean => {
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
      requester: localUser.name,
      requesterUserId: localUser.id,
      url,
      reason: `Opened by ${message.author} through Codex.`,
      requestedAt: new Date().toISOString(),
      status: "approved"
    };
    const store = useAppStore.getState();
    store.appendBrowserRequest(room.id, request);
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
