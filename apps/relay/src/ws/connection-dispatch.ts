import type { RelayClientMessage } from "@multaiplayer/protocol";
import type { ClientSession } from "../state.js";
import { socketConnectionQuotaError } from "./connection-admission.js";
import type { RelayWebSocketConnectionOptions } from "./connection-types.js";
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
  if (!options.rooms.hasDeviceSession(message.deviceSessionToken ?? "", message.userId, message.deviceId)) {
    send(socket, { type: "error", message: "A device-authenticated session is required.", code: "not_joined" });
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
  send(socket, { type: "joined", teamId: message.teamId, roomId: message.roomId });
  const key = options.rooms.roomKey(message.teamId, message.roomId);
  for (const backlogMessage of options.state.store.getMlsBacklog(key) ?? []) {
    send(socket, { type: "mls.message", message: backlogMessage });
  }
  for (const presence of options.state.roomPresence.get(key)?.values() ?? []) {
    send(socket, { type: "presence", ...presence, status: "online" });
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
  await options.rooms.publishMlsMessage(message.message);
  send(session.socket, { type: "published", messageId });
}

function dispatchPresence(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession,
  message: Extract<RelayClientMessage, { type: "presence" }>
) {
  if (!isPresenceForJoinedSession(session, message)) {
    options.transport.send(session.socket, {
      type: "error",
      message: "Join the room before publishing presence with this user and device."
    });
    return;
  }
  if (!isPresenceWithinLimits(options, message)) {
    options.transport.send(session.socket, { type: "error", message: presenceLimitError });
    return;
  }
  options.rooms.publishPresence(session, message.teamId, message.roomId, {
    teamId: message.teamId,
    roomId: message.roomId,
    userId: message.userId,
    deviceId: message.deviceId,
    displayName: message.displayName,
    avatarUrl: message.avatarUrl,
    publicKeyFingerprint: message.publicKeyFingerprint
  });
}
