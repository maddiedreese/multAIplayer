import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canHostBrowserAction } from "../lib/browserPolicy";
import { extractCodexBrowserOpenUrl } from "../lib/codexInvoke";
import { formatBrowserAccessLabel } from "../lib/browserUi";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import type { BrowserAccessRequest, BrowserStatus, ChatMessage } from "../types";
import type { InspectorTab } from "../components/RoomInspectorPanel";

interface LocalUser {
  id: string;
  name: string;
}

interface UseCodexBrowserOpenCommandOptions {
  localUser: LocalUser;
  selectedRoomIdRef: MutableRefObject<string>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
  setBrowserUrlForRoom: (roomId: string, url: string) => void;
  setActiveBrowserUrlsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setBrowserStatusByRoom: Dispatch<SetStateAction<Record<string, BrowserStatus>>>;
  setInspectorTabsByRoom: Dispatch<SetStateAction<Record<string, InspectorTab>>>;
}

export function useCodexBrowserOpenCommand({
  localUser,
  selectedRoomIdRef,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  appendBrowserRequest,
  setBrowserMessageForRoom,
  setBrowserUrlForRoom,
  setActiveBrowserUrlsByRoom,
  setBrowserStatusByRoom,
  setInspectorTabsByRoom
}: UseCodexBrowserOpenCommandOptions) {
  function handleCodexBrowserOpenCommand(message: ChatMessage, room: RoomRecord): boolean {
    const url = extractCodexBrowserOpenUrl(message.body);
    if (!url) return false;
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    if (!canHostBrowserAction(room, localUser, roomLocked)) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setBrowserMessageForRoom(room.id, "Only the active host can open the in-room browser.");
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
    appendBrowserRequest(room.id, request);
    setBrowserMessageForRoom(room.id, null);
    setBrowserUrlForRoom(room.id, request.url);
    setActiveBrowserUrlsByRoom((current) => ({ ...current, [room.id]: request.url }));
    setBrowserStatusByRoom((current) => ({
      ...current,
      [room.id]: {
        profilePath: "Embedded in this room",
        downloadsBlocked: false,
        clipboardBlocked: false,
        fileUploadsBlocked: false
      }
    }));
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
      setBrowserMessageForRoom(room.id, `Opened in-room browser for ${formatBrowserAccessLabel(request.url)}.`);
      setInspectorTabsByRoom((current) => ({ ...current, [room.id]: "browser" }));
    }
    return true;
  }

  return { handleCodexBrowserOpenCommand };
}
