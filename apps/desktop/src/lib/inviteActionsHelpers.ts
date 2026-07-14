import type { RoomRecord } from "@multaiplayer/protocol";
import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode
} from "@multaiplayer/protocol";
import { defaultProjectPath } from "./localBackend";
import { ensureRoomDefaults } from "./roomDefaults";
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
}): RoomRecord {
  return ensureRoomDefaults({
    id: roomId,
    teamId,
    name: roomName,
    projectPath: defaultProjectPath,
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
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
  const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  if (params.has("multaiplayerInvite")) {
    throw new InviteJoinError("legacy_invite", "This pre-v2 invite is invalid. Ask the active host for a new MLS invite.");
  }
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
  let queryInviteId: string | null = null;
  try {
    const query = new URL(raw).searchParams;
    if ([...query.keys()].some((key) => key !== "invite") || query.getAll("invite").length > 1) {
      throw new InviteJoinError("invalid_invite", "The invite link query is ambiguous.");
    }
    queryInviteId = query.get("invite");
  } catch {
    if (!raw.startsWith("#")) {
      throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
    }
  }
  const fragmentInviteId = fragmentInviteIds[0] ?? null;
  if (fragmentInviteId && queryInviteId) {
    throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
  }
  const inviteId = fragmentInviteId ?? queryInviteId;
  const joinInvite = params.get("multaiplayerJoin");
  if (!joinInvite || !inviteId)
    throw new InviteJoinError("invalid_invite", "A complete host-approved multAIplayer invite link is required.");
  return { inviteId, joinInvite };
}
