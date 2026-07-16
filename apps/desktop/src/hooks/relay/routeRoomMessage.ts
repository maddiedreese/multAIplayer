import {
  HostHandoffAcceptedPlaintextPayload,
  HostHandoffPlaintextPayload,
  HostHandoffRequestPlaintextPayload,
  RoomConfigPlaintextPayload,
  RoomSettingsPlaintextPayload
} from "@multaiplayer/protocol";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  isEnvelopeFromHandoffInitiator,
  roomHostEnvelopeRejectionMessage
} from "../../lib/access/roomHost";
import { buildRoomSettingsSystemMessage } from "../../presentation/rooms/roomSettingsMessages";
import { approvalPolicyLabels, roomModeLabels } from "../../appDefaults";
import type { AppStoreState } from "../../store/appStore";
import type { MlsMessageRouteContext, MlsMessageStoreActions, RoutedMlsMessage } from "./mlsMessageRouteTypes";
import { applyRoomConfig } from "../../application/mls/roomConfigSnapshot";

export async function routeRoomMessage(
  envelope: RoutedMlsMessage,
  context: MlsMessageRouteContext,
  store: MlsMessageStoreActions,
  getStore: () => AppStoreState,
  decrypt: () => Promise<unknown>
): Promise<boolean> {
  if (envelope.kind === "room.config") {
    await routeRoomConfig(envelope, context, store, decrypt);
    return true;
  }
  if (envelope.kind === "room.host.request") {
    await routeHostHandoffRequest(envelope, context, store, getStore, decrypt);
    return true;
  }
  if (envelope.kind === "room.host.accepted") {
    await routeAcceptedHostHandoff(envelope, store, getStore, decrypt);
    return true;
  }
  if (envelope.kind === "room.host") {
    await routeHostHandoffOffer(envelope, context, store, decrypt);
    return true;
  }
  if (envelope.kind === "room.settings") {
    await routeRoomSettings(envelope, context, store, decrypt);
    return true;
  }
  return false;
}

async function routeRoomConfig(
  envelope: RoutedMlsMessage,
  context: MlsMessageRouteContext,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const parsed = RoomConfigPlaintextPayload.safeParse(await decrypt());
  if (!parsed.success) return;
  const room = findEnvelopeRoom(context.roomsRef.current, envelope.roomId);
  if (!room || !isEnvelopeFromActiveRoomHost(room, envelope)) return;
  const updated = applyRoomConfig(room, parsed.data, envelope.epochHint);
  if (updated !== room) store.replaceRoomRecord(updated);
}

async function routeHostHandoffRequest(
  envelope: RoutedMlsMessage,
  context: MlsMessageRouteContext,
  store: MlsMessageStoreActions,
  getStore: () => AppStoreState,
  decrypt: () => Promise<unknown>
) {
  const parsed = HostHandoffRequestPlaintextPayload.safeParse(await decrypt());
  if (!parsed.success) return;
  const room = findEnvelopeRoom(context.roomsRef.current, envelope.roomId);
  const offer = getStore().codexRuntimeByRoom[envelope.roomId]?.hostHandoffs?.find(
    (handoff) =>
      handoff.id === parsed.data.offerId && (handoff.status === "available" || handoff.status === "requested")
  );
  if (
    !offer ||
    offer.fromUserId !== room?.hostUserId ||
    parsed.data.candidateUserId !== envelope.senderUserId ||
    parsed.data.candidateDeviceId !== envelope.senderDeviceId
  )
    return;
  store.markHostHandoffRequestedForRoom(envelope.roomId, offer.id, {
    candidateUserId: parsed.data.candidateUserId,
    candidateDeviceId: parsed.data.candidateDeviceId,
    candidateLeaf: parsed.data.candidateLeaf
  });
  store.setHostMessageForRoom(
    envelope.roomId,
    "A verified room member requested host authority. The active host must approve the MLS transfer."
  );
}

async function routeHostHandoffOffer(
  envelope: RoutedMlsMessage,
  context: MlsMessageRouteContext,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const parsed = HostHandoffPlaintextPayload.safeParse(await decrypt());
  if (!parsed.success) return;
  const room = findEnvelopeRoom(context.roomsRef.current, envelope.roomId);
  if (!isEnvelopeFromHandoffInitiator(room, envelope) || parsed.data.fromUserId !== envelope.senderUserId) {
    store.setHostMessageForRoom(envelope.roomId, roomHostEnvelopeRejectionMessage(room, "host handoff"));
  } else store.appendHostHandoff(envelope.roomId, hostHandoffRecord(parsed.data));
}

type DecodedHostHandoff = ReturnType<typeof HostHandoffPlaintextPayload.parse>;
type RoutedHostHandoff = Parameters<MlsMessageStoreActions["appendHostHandoff"]>[1];
type HostHandoffGitFields = Pick<
  RoutedHostHandoff,
  "gitRemoteUrl" | "gitRepoOwner" | "gitRepoName" | "gitBranch" | "gitDirtyFiles" | "gitPatch" | "gitPatchTruncated"
>;
type HostHandoffCodexFields = Pick<
  RoutedHostHandoff,
  | "codexModelPolicy"
  | "codexReasoningEffort"
  | "codexReasoningEffortPolicy"
  | "codexRawReasoningEnabled"
  | "codexSpeed"
  | "codexServiceTierPolicy"
  | "codexSandboxLevel"
>;
type HostHandoffDecisionFields = Pick<
  RoutedHostHandoff,
  "candidateUserId" | "candidateDeviceId" | "candidateLeaf" | "acceptedBy" | "acceptedByUserId" | "acceptedAt"
>;

function hostHandoffRecord(payload: DecodedHostHandoff): RoutedHostHandoff {
  return {
    id: payload.id,
    fromHost: payload.fromHost,
    fromUserId: payload.fromUserId,
    reason: payload.reason,
    projectPath: payload.projectPath,
    ...hostHandoffGitFields(payload),
    codexModel: payload.codexModel,
    ...hostHandoffCodexFields(payload),
    approvalPolicy: payload.approvalPolicy,
    messagesSinceLastCodex: payload.messagesSinceLastCodex,
    queuedCodexTurns: payload.queuedCodexTurns,
    attachmentNames: payload.attachmentNames,
    terminals: payload.terminals,
    ...(payload.continuationSummary ? { continuationSummary: payload.continuationSummary } : {}),
    createdAt: payload.createdAt,
    status: "available",
    ...hostHandoffDecisionFields(payload)
  };
}

function hostHandoffGitFields(payload: DecodedHostHandoff): HostHandoffGitFields {
  return {
    ...(payload.gitRemoteUrl ? { gitRemoteUrl: payload.gitRemoteUrl } : {}),
    ...(payload.gitRepoOwner ? { gitRepoOwner: payload.gitRepoOwner } : {}),
    ...(payload.gitRepoName ? { gitRepoName: payload.gitRepoName } : {}),
    ...(payload.gitBranch ? { gitBranch: payload.gitBranch } : {}),
    ...(payload.gitDirtyFiles ? { gitDirtyFiles: payload.gitDirtyFiles } : {}),
    ...(payload.gitPatch ? { gitPatch: payload.gitPatch } : {}),
    ...(payload.gitPatchTruncated === undefined ? {} : { gitPatchTruncated: payload.gitPatchTruncated })
  };
}

function hostHandoffCodexFields(payload: DecodedHostHandoff): HostHandoffCodexFields {
  return {
    codexModelPolicy: payload.codexModelPolicy,
    codexReasoningEffort: payload.codexReasoningEffort,
    codexReasoningEffortPolicy: payload.codexReasoningEffortPolicy,
    codexRawReasoningEnabled: payload.codexRawReasoningEnabled,
    codexSpeed: payload.codexSpeed,
    codexServiceTierPolicy: payload.codexServiceTierPolicy,
    codexSandboxLevel: payload.codexSandboxLevel
  };
}

function hostHandoffDecisionFields(payload: DecodedHostHandoff): HostHandoffDecisionFields {
  return {
    ...(payload.candidateUserId ? { candidateUserId: payload.candidateUserId } : {}),
    ...(payload.candidateDeviceId ? { candidateDeviceId: payload.candidateDeviceId } : {}),
    ...(payload.candidateLeaf === undefined ? {} : { candidateLeaf: payload.candidateLeaf }),
    ...(payload.acceptedBy ? { acceptedBy: payload.acceptedBy } : {}),
    ...(payload.acceptedByUserId ? { acceptedByUserId: payload.acceptedByUserId } : {}),
    ...(payload.acceptedAt ? { acceptedAt: payload.acceptedAt } : {})
  };
}

async function routeRoomSettings(
  envelope: RoutedMlsMessage,
  context: MlsMessageRouteContext,
  store: MlsMessageStoreActions,
  decrypt: () => Promise<unknown>
) {
  const parsed = RoomSettingsPlaintextPayload.safeParse(await decrypt());
  if (!parsed.success) return;
  const room = findEnvelopeRoom(context.roomsRef.current, envelope.roomId);
  if (!isEnvelopeFromActiveRoomHost(room, envelope) || parsed.data.changedByUserId !== envelope.senderUserId) return;
  store.appendRoomMessage(
    envelope.roomId,
    buildRoomSettingsSystemMessage(parsed.data, {
      approvalPolicyLabels,
      roomModeLabels
    })
  );
}

async function routeAcceptedHostHandoff(
  envelope: RoutedMlsMessage,
  store: MlsMessageStoreActions,
  getStore: () => AppStoreState,
  decrypt: () => Promise<unknown>
) {
  const parsed = HostHandoffAcceptedPlaintextPayload.safeParse(await decrypt());
  if (!parsed.success) return;
  const offer = getStore().codexRuntimeByRoom[envelope.roomId]?.hostHandoffs?.find(
    (handoff) => handoff.id === parsed.data.offerId && handoff.fromUserId === envelope.senderUserId
  );
  if (
    !offer ||
    offer.status !== "requested" ||
    offer.candidateUserId !== parsed.data.hostUserId ||
    offer.candidateDeviceId !== parsed.data.hostDeviceId ||
    offer.candidateLeaf !== parsed.data.hostLeaf
  )
    return;
  store.applyAcceptedHostHandoffForRoom(envelope.roomId, {
    ...offer,
    status: "accepted",
    acceptedByUserId: parsed.data.hostUserId,
    acceptedAt: envelope.createdAt
  });
  store.setHostMessageForRoom(
    envelope.roomId,
    "MLS host authority transfer committed. The new host may now apply the verified local handoff context."
  );
}
