import type { MlsRelayMessage } from "@multaiplayer/protocol";
import type { RelayStoreMutationEntity, RoomKey } from "./state.js";

export type RelayStorageBackend = "json" | "sqlite";

export type StoredRelayMutation =
  | { entity: RelayStoreMutationEntity; key: string; operation: "delete" }
  | { entity: RelayStoreMutationEntity; key: string; operation: "upsert"; value: unknown };

export interface RelayPersistence {
  readonly flushMode: "debounced" | "immediate";
  load(): Promise<unknown | null>;
  finalizeLoad?(state: () => unknown): Promise<void>;
  save(state: unknown): Promise<void>;
  saveChanges(changes: StoredRelayMutation[]): Promise<boolean>;
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): Promise<boolean>;
  saveKeyPackages(changes: StoredRelayMutation[], fallbackState: () => unknown): Promise<void>;
  saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    changes: StoredRelayMutation[],
    fallbackState: () => unknown
  ): Promise<boolean>;
  saveMlsCommit(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    changes: StoredRelayMutation[],
    fallbackState: () => unknown
  ): Promise<void>;
  quarantine(reason: string): Promise<void>;
  close(): void;
}
