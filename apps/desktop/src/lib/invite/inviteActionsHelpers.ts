import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode
} from "@multaiplayer/protocol";
import { defaultProjectPath } from "../platform/localBackend";
import { ensureRoomDefaults } from "../room/roomDefaults";
import { maxInviteLinkChars } from "./inviteUrl";
import { InviteJoinError } from "./inviteJoinError";

export function buildFallbackInvitedRoom({
  teamId,
  roomId,
  roomName
}: {
  teamId: string;
  roomId: string;
  roomName: string;
}): ClientRoomRecord {
  return ensureRoomDefaults({
    id: roomId,
    teamId,
    name: roomName,
    projectPath: defaultProjectPath,
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    mode: defaultRoomMode,
    codexModel: defaultCodexModel,
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 0
  });
}

export function parseInviteInput(raw: string) {
  if (raw.length > maxInviteLinkChars) {
    throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
  }
  if (!raw.startsWith("#")) {
    try {
      if (new URL(raw).search) {
        throw new InviteJoinError("invalid_invite", "Invite data must be contained in the URL fragment.");
      }
    } catch (error) {
      if (error instanceof InviteJoinError) throw error;
      throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
    }
  }
  const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const allowedFragmentKeys = new Set(["invite", "multaiplayerJoin", "approval"]);
  if (
    [...params.keys()].some((key) => !allowedFragmentKeys.has(key)) ||
    params.getAll("multaiplayerJoin").length !== 1 ||
    params.getAll("approval").length !== 1 ||
    params.get("approval") !== "request"
  ) {
    throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
  }
  const fragmentInviteIds = params.getAll("invite");
  if (fragmentInviteIds.length > 1) {
    throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
  }
  const fragmentInviteId = fragmentInviteIds[0] ?? null;
  const joinInvite = params.get("multaiplayerJoin");
  if (!joinInvite || !fragmentInviteId)
    throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
  return { inviteId: fragmentInviteId, joinInvite };
}
