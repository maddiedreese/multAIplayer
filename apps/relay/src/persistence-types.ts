import type { MlsRelayMessage } from "@multaiplayer/protocol";
import type { RelayStoreMutationEntity, RoomKey } from "./state.js";

export type StoredRelayMutation =
  | { entity: RelayStoreMutationEntity; key: string; operation: "delete" }
  | { entity: RelayStoreMutationEntity; key: string; operation: "upsert"; value: unknown };

export interface RelayPersistence {
  load(): Promise<unknown | null>;
  save(state: unknown): Promise<void>;
  saveChanges(changes: StoredRelayMutation[]): void;
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): void;
  saveKeyPackages(changes: StoredRelayMutation[]): void;
  saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    changes: StoredRelayMutation[]
  ): void;
  saveMlsCommit(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    changes: StoredRelayMutation[]
  ): void;
  close(): void;
}
