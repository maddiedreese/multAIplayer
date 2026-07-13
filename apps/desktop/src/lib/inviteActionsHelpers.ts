import type { RoomRecord } from "@multaiplayer/protocol";
import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode
} from "@multaiplayer/protocol";
import { defaultProjectPath } from "./localBackend";
import { ensureRoomDefaults } from "./roomDefaults";

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
  const [beforeHash, afterHash] = raw.includes("#") ? raw.split("#") : ["", raw];
  const inviteId = beforeHash.includes("?")
    ? new URLSearchParams(beforeHash.split("?").at(-1) ?? "").get("invite")
    : null;
  const params = new URLSearchParams((afterHash ?? raw).replace(/^#/, ""));
  if (params.has("multaiplayerInvite")) {
    throw new Error("This pre-v2 invite is invalid. Ask the active host for a new MLS invite.");
  }
  const joinInvite = params.get("multaiplayerJoin");
  if (!joinInvite || !inviteId) throw new Error("A complete host-approved multAIplayer invite link is required.");
  return { inviteId, joinInvite };
}
