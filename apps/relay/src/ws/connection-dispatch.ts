import type { RelayClientMessage } from "@multaiplayer/protocol";
import type { ClientSession, PresenceRecord } from "../state.js";
import { socketConnectionQuotaError } from "./connection-admission.js";
import type { RelayWebSocketConnectionOptions } from "./connection-types.js";
import { acquireAccountMutationTurns } from "../auth/account-mutation-transaction.js";
import {
  isBoundedSocketIdentity,
  isMlsMessageWithinLimits,
  isPresenceForJoinedSession,
  isPresenceWithinLimits,
  presenceLimitError
} from "./connection-validation.js";

export async function dispatchRelayClientMessage(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: RelayClientMessage
): Promise<void> {
  if (!isActiveQueuedClientSession(options, session)) return;
  if (!hasLiveAuthenticationSession(options, session)) return;
  switch (message.type) {
    case "join":
      dispatchJoin(options, session, message);
      return;
    case "subscribe.team":
      dispatchTeamSubscription(options, session, message);
      return;
    case "subscribe.workspace":
      dispatchWorkspaceSubscription(options, session, message);
      return;
    case "publish":
      await dispatchMlsPublish(options, session, message);
      return;
    case "presence":
      dispatchPresence(options, session, message);
      return;
  }
  assertNever(message);
}

export function isActiveQueuedClientSession(
  options: Pick<RelayWebSocketConnectionOptions, "state">,
  session: ClientSession
): boolean {
  return session.socket.readyState === session.socket.OPEN && options.state.sessions.get(session.socket) === session;
}

function hasLiveAuthenticationSession(
  options: Pick<RelayWebSocketConnectionOptions, "authentication" | "transport">,
  session: ClientSession
): boolean {
  if (options.authentication.isLiveClientSession(session)) return true;
  options.transport.sendConnectionError(session.socket, {
    type: "error",
    message: "Authentication session expired.",
    code: "not_joined"
  });
  session.socket.close(1008, "Authentication session expired");
  return false;
}

function assertNever(message: never): never {
  throw new Error(`Unsupported relay client message: ${JSON.stringify(message)}`);
}

function dispatchJoin(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "join" }>
) {
  const { send } = options.transport;
  const socket = session.socket;
  if (!isBoundedSocketIdentity(options, message.userId, message.deviceId)) {
    send(socket, {
      type: "error",
      message: "WebSocket user and device ids must be bounded strings without control characters."
    });
    return;
  }
  if (
    message.inviteId &&
    !options.validation.normalizeMetadataText(message.inviteId, options.limits.maxEnvelopeIdChars)
  ) {
    send(socket, { type: "error", message: "Invite id must be a bounded string without control characters." });
    return;
  }
  if (!options.rooms.isKnownRoom(message.teamId, message.roomId)) {
    send(socket, { type: "error", message: "Room not found" });
    return;
  }
  if (!options.rooms.canAuthenticateJoinIdentity(session, message.userId)) {
    send(socket, { type: "error", message: "Sign in and use a valid invite before joining this room." });
    return;
  }
  if (!options.rooms.hasDeviceSession(message.deviceSessionToken ?? "", message.userId, message.deviceId)) {
    send(socket, { type: "error", message: "A device-authenticated session is required.", code: "not_joined" });
    return;
  }
  if (
    !options.rooms.canJoinRoom(
      session,
      message.teamId,
      message.roomId,
      message.userId,
      message.deviceId,
      message.inviteId
    )
  ) {
    send(socket, { type: "error", message: "Sign in and use a valid invite before joining this room." });
    return;
  }

  session.userId = message.userId;
  session.deviceId = message.deviceId;
  session.deviceSessionToken = message.deviceSessionToken ?? "development-auth-disabled";
  const quotaError = socketConnectionQuotaError(options, session);
  if (quotaError) {
    options.metrics.recordConnectionRejection?.("quota_after_join");
    send(socket, { type: "error", message: quotaError });
    socket.close(1008, "WebSocket connection quota exceeded");
    return;
  }
  options.rooms.joinRoom(session, message.teamId, message.roomId, message.userId, message.deviceId);
  const key = options.rooms.roomKey(message.teamId, message.roomId);
  for (const backlogMessage of options.state.store.getMlsBacklog(key) ?? []) {
    send(socket, { type: "mls.message", message: backlogMessage });
  }
  replayPendingInviteRequests(options, session);
  for (const presence of options.state.roomPresence.get(key)?.values() ?? []) {
    send(socket, { type: "presence", ...presence, status: "online" });
  }
  // `joined` is the recovery barrier: everything retained for this room is
  // already on the wire before the client resumes outbox/config publication.
  send(socket, { type: "joined", teamId: message.teamId, roomId: message.roomId });
}

function replayPendingInviteRequests(options: RelayWebSocketConnectionOptions, session: ClientSession) {
  const { store } = options.state;
  const room = session.roomId ? store.getRoom(session.roomId) : undefined;
  if (
    !room ||
    room.teamId !== session.teamId ||
    room.hostStatus !== "active" ||
    room.hostUserId !== session.userId ||
    room.activeHostDeviceId !== session.deviceId
  )
    return;

  for (const request of store.inviteRequests.values()) {
    if (store.inviteResponses.has(request.requestId)) continue;
    const invite = store.getInvite(request.inviteId);
    if (!invite || invite.roomId !== room.id || invite.teamId !== room.teamId) continue;
    options.transport.send(session.socket, {
      type: "invite.requested",
      inviteId: request.inviteId,
      requestId: request.requestId
    });
  }
}

function dispatchTeamSubscription(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "subscribe.team" }>
) {
  const { send } = options.transport;
  if (!isBoundedSocketIdentity(options, message.userId, message.deviceId)) {
    send(session.socket, {
      type: "error",
      message: "WebSocket user and device ids must be bounded strings without control characters."
    });
    return;
  }
  if (!options.rooms.hasTeam(message.teamId)) {
    send(session.socket, { type: "error", message: "Team not found" });
    return;
  }
  if (!options.rooms.canSubscribeTeam(session, message.teamId, message.userId)) {
    send(session.socket, { type: "error", message: "Join this team before subscribing to it." });
    return;
  }
  options.rooms.subscribeTeam(session, message.teamId);
  send(session.socket, { type: "team.subscribed", teamId: message.teamId });
}

function dispatchWorkspaceSubscription(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "subscribe.workspace" }>
) {
  const { send } = options.transport;
  if (!isBoundedSocketIdentity(options, message.userId, message.deviceId)) {
    send(session.socket, {
      type: "error",
      message: "WebSocket user and device ids must be bounded strings without control characters."
    });
    return;
  }
  if (!options.rooms.canSubscribeWorkspace(session, message.userId)) {
    send(session.socket, { type: "error", message: "Sign in before subscribing to the workspace." });
    return;
  }
  options.rooms.subscribeWorkspace(session);
  send(session.socket, { type: "workspace.subscribed" });
}

async function dispatchMlsPublish(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "publish" }>
) {
  const { send } = options.transport;
  const messageId = message.message.id;
  if (
    !session.userId ||
    !session.deviceId ||
    !session.deviceSessionToken ||
    !options.rooms.hasDeviceSession(session.deviceSessionToken, session.userId, session.deviceId)
  ) {
    send(session.socket, { type: "error", message: "Device session expired.", code: "not_joined", messageId });
    return;
  }
  if (!options.rooms.canPublishMlsMessage(session, message.message)) {
    send(session.socket, {
      type: "error",
      message: "Join the room before publishing with this user and device.",
      messageId
    });
    return;
  }
  if (!isMlsMessageWithinLimits(options, message.message)) {
    send(session.socket, {
      type: "error",
      message: `MLS message exceeds relay limits (${options.limits.mlsMessageMaxBytes} bytes max).`,
      code: "message_too_large",
      messageId
    });
    return;
  }
  const authorityUserIds = [session.userId];
  if (message.message.commitEffect === "host_handoff" && message.message.nextHostUserId) {
    authorityUserIds.push(message.message.nextHostUserId);
  }
  const releaseAccountMutation = await acquireAccountMutationTurns(options.state.store, authorityUserIds);
  try {
    const remainsAuthorized = () => mlsPublishRemainsAuthorized(options, session, message.message);
    if (!remainsAuthorized()) {
      send(session.socket, {
        type: "error",
        message: "Publishing authorization changed.",
        code: "not_joined",
        messageId
      });
      return;
    }
    await options.rooms.publishMlsMessage(message.message, remainsAuthorized);
    send(session.socket, { type: "published", messageId });
  } finally {
    releaseAccountMutation();
  }
}

function mlsPublishRemainsAuthorized(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "publish" }>["message"]
): boolean {
  return Boolean(
    isActiveQueuedClientSession(options, session) &&
    hasLiveAuthenticationSession(options, session) &&
    session.userId &&
    session.deviceId &&
    session.deviceSessionToken &&
    options.rooms.hasDeviceSession(session.deviceSessionToken, session.userId, session.deviceId) &&
    options.rooms.canAccessRoom(message.teamId, message.roomId, session.userId) &&
    hostHandoffTargetRemainsAuthorized(options, message) &&
    options.rooms.canPublishMlsMessage(session, message)
  );
}

function hostHandoffTargetRemainsAuthorized(
  options: Pick<RelayWebSocketConnectionOptions, "state">,
  message: Extract<RelayClientMessage, { type: "publish" }>["message"]
): boolean {
  if (message.commitEffect !== "host_handoff") return true;
  if (!message.nextHostUserId || !message.nextHostDeviceId) return false;
  return Boolean(
    options.state.store.getTeamMember(message.teamId, message.nextHostUserId) &&
    options.state.store.getDevice(message.nextHostUserId, message.nextHostDeviceId)
  );
}

function dispatchPresence(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "presence" }>
) {
  if (!options.rooms.isKnownRoom(message.teamId, message.roomId) || !isPresenceForJoinedSession(session, message)) {
    options.transport.send(session.socket, {
      type: "error",
      message: "Join the room before publishing presence with this user and device."
    });
    return;
  }
  const presence: PresenceRecord = {
    teamId: message.teamId,
    roomId: message.roomId,
    userId: message.userId,
    deviceId: message.deviceId,
    displayName: message.displayName,
    ...(message.avatarUrl ? { avatarUrl: message.avatarUrl } : {}),
    ...(message.publicKeyFingerprint ? { publicKeyFingerprint: message.publicKeyFingerprint } : {})
  };
  if (!isPresenceWithinLimits(options, presence)) {
    options.transport.send(session.socket, { type: "error", message: presenceLimitError });
    return;
  }
  options.rooms.publishPresence(session, message.teamId, message.roomId, presence);
}
