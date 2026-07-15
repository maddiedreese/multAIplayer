import type { MlsRelayMessage } from "@multaiplayer/protocol";
import type { RelayStoreMutationEntity, RoomKey } from "./state.js";

export type StoredRelayMutation =
  | { entity: RelayStoreMutationEntity; key: string; operation: "delete" }
  | { entity: RelayStoreMutationEntity; key: string; operation: "upsert"; value: unknown };

export interface RelayPersistence {
  load(): Promise<unknown | null>;
  finalizeLoad?(state: () => unknown): Promise<void>;
  save(state: unknown): Promise<void>;
  saveChanges(changes: StoredRelayMutation[]): boolean;
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): boolean;
  saveKeyPackages(changes: StoredRelayMutation[], fallbackState: () => unknown): void;
  saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    changes: StoredRelayMutation[],
    fallbackState: () => unknown
  ): boolean;
  saveMlsCommit(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    changes: StoredRelayMutation[],
    fallbackState: () => unknown
  ): void;
  quarantine(reason: string): Promise<void>;
  close(): void;
}
