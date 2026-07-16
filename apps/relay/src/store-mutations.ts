import type { AttachmentBlobRecord, InviteRecord, MlsRelayMessage } from "@multaiplayer/protocol";
import type { StoredAuthSession } from "./auth/session.js";
import type { StoredRelayMutation } from "./persistence-types.js";
import type { AuthSession, RelayStore, RelayStoreMutation, RoomKey } from "./state.js";

export function createStoredRelayMutationStream(options: {
  store: RelayStore;
  now: () => number;
  isExpiredInvite: (invite: InviteRecord) => boolean;
  isExpiredAttachmentBlob: (blob: AttachmentBlobRecord) => boolean;
  pruneMlsBacklog: (messages: MlsRelayMessage[]) => MlsRelayMessage[];
  storedAuthSessions: (sessions: Map<string, AuthSession>) => StoredAuthSession[];
}) {
  const { store } = options;

  function encode(mutation: RelayStoreMutation): StoredRelayMutation {
    const { entity, key } = mutation;
    let value: unknown;
    switch (entity) {
      case "authSessions": {
        value = storedAuthSessionValue(key, options);
        break;
      }
      case "accountRestrictions":
        value = store.accountRestrictions.get(key);
        break;
      case "accountQuotaRecords":
        value = store.accountQuotaRecords.get(key);
        break;
      case "teams":
        value = store.teams.get(key);
        break;
      case "rooms":
        value = store.rooms.get(key);
        break;
      case "invites": {
        value = liveInviteValue(store.invites.get(key), options.isExpiredInvite);
        break;
      }
      case "inviteRequests":
        value = store.inviteRequests.get(key);
        break;
      case "inviteResponses":
        value = store.inviteResponses.get(key);
        break;
      case "inviteAckReceipts":
        value = store.inviteAckReceipts.get(key);
        break;
      case "acceptedMessageReceipts":
        value = store.acceptedMessageReceipts.get(key);
        break;
      case "devices":
        value = store.devices.get(key);
        break;
      case "keyPackages":
        value = store.keyPackages.get(key);
        break;
      case "attachmentBlobs": {
        value = liveAttachmentValue(store.attachmentBlobs.get(key), options.isExpiredAttachmentBlob);
        break;
      }
      case "appliedDeletionLedgerEntries":
        value = store.appliedDeletionLedgerEntries.get(key);
        break;
      case "teamMembers": {
        value = storedTeamMembersValue(key, store.teamMembers.get(key));
        break;
      }
      case "mlsBacklog": {
        value = storedBacklogValue(key, store.mlsBacklog.get(key as RoomKey), options.pruneMlsBacklog);
        break;
      }
    }
    const persistedKey = entity === "acceptedMessageReceipts" ? acceptedReceiptStorageKey(key) : key;
    return value === undefined
      ? { entity, key: persistedKey, operation: "delete" }
      : { entity, key: persistedKey, operation: "upsert", value };
  }

  return {
    drain(): StoredRelayMutation[] {
      const latest = new Map<string, RelayStoreMutation>();
      for (const mutation of store.drainDurableMutations()) {
        latest.set(`${mutation.entity}\0${mutation.key}`, mutation);
      }
      return Array.from(latest.values(), encode);
    },
    discard() {
      store.discardDurableMutations();
    }
  };
}

function storedAuthSessionValue(
  key: string,
  options: Parameters<typeof createStoredRelayMutationStream>[0]
): StoredAuthSession | undefined {
  const session = options.store.authSessions.get(key);
  if (!session || session.expiresAt <= options.now()) return undefined;
  return options.storedAuthSessions(new Map([[key, session]]))[0];
}

function liveInviteValue(
  invite: InviteRecord | undefined,
  isExpired: (invite: InviteRecord) => boolean
): InviteRecord | undefined {
  return invite && !isExpired(invite) ? invite : undefined;
}

function liveAttachmentValue(
  blob: AttachmentBlobRecord | undefined,
  isExpired: (blob: AttachmentBlobRecord) => boolean
): AttachmentBlobRecord | undefined {
  return blob && !isExpired(blob) ? blob : undefined;
}

function storedTeamMembersValue(
  key: string,
  members: RelayStore["teamMembers"] extends Map<string, infer T> ? T | undefined : never
) {
  return members ? { teamId: key, members: Array.from(members.values()) } : undefined;
}

function storedBacklogValue(
  key: string,
  messages: MlsRelayMessage[] | undefined,
  prune: (messages: MlsRelayMessage[]) => MlsRelayMessage[]
) {
  const retained = prune(messages ?? []);
  return retained.length > 0 ? { key, messages: retained } : undefined;
}

function acceptedReceiptStorageKey(key: string): string {
  const separator = key.indexOf("\0");
  return separator < 0 ? key : JSON.stringify([key.slice(0, separator), key.slice(separator + 1)]);
}
