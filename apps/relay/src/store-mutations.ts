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
        const session = store.authSessions.get(key);
        value =
          session && session.expiresAt > options.now()
            ? options.storedAuthSessions(new Map([[key, session]]))[0]
            : undefined;
        break;
      }
      case "teams":
        value = store.teams.get(key);
        break;
      case "rooms":
        value = store.rooms.get(key);
        break;
      case "invites": {
        const invite = store.invites.get(key);
        value = invite && !options.isExpiredInvite(invite) ? invite : undefined;
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
        const blob = store.attachmentBlobs.get(key);
        value = blob && !options.isExpiredAttachmentBlob(blob) ? blob : undefined;
        break;
      }
      case "appliedDeletionLedgerEntries":
        value = store.appliedDeletionLedgerEntries.get(key);
        break;
      case "teamMembers": {
        const members = store.teamMembers.get(key);
        value = members
          ? { teamId: key, members: Array.from(members.values()), userIds: Array.from(members.keys()) }
          : undefined;
        break;
      }
      case "mlsBacklog": {
        const messages = options.pruneMlsBacklog(store.mlsBacklog.get(key as RoomKey) ?? []);
        value = messages.length > 0 ? { key, messages } : undefined;
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

function acceptedReceiptStorageKey(key: string): string {
  const separator = key.indexOf("\0");
  return separator < 0 ? key : JSON.stringify([key.slice(0, separator), key.slice(separator + 1)]);
}
