import type { StateCreator } from "zustand";
import type { RelayStatus } from "../../types";
import type { AppStoreState } from "../appStore";

export interface RelayRuntimeSlice {
  relayStatus: RelayStatus;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  replaceRelayStatus: (status: RelayStatus) => void;
  rememberForgottenRoom: (roomId: string) => void;
  restoreForgottenRoom: (roomId: string) => void;
  revokeRoomAccess: (roomId: string) => void;
  restoreRoomAccess: (roomId: string) => void;
  revokeTeamAccess: (teamId: string) => void;
  restoreTeamAccess: (teamId: string) => void;
  revokeWorkspaceAccess: (teamId: string, roomId: string) => void;
  restoreWorkspaceAccess: (teamId: string, roomId: string) => void;
}

export const emptyRelayRuntimeState: Pick<
  RelayRuntimeSlice,
  "relayStatus" | "forgottenRoomIds" | "revokedRoomIds" | "revokedTeamIds"
> = {
  relayStatus: "closed",
  forgottenRoomIds: new Set(),
  revokedRoomIds: new Set(),
  revokedTeamIds: new Set()
};

function withValue(current: Set<string>, value: string): Set<string> {
  if (current.has(value)) return current;
  const next = new Set(current);
  next.add(value);
  return next;
}

function withoutValue(current: Set<string>, value: string): Set<string> {
  if (!current.has(value)) return current;
  const next = new Set(current);
  next.delete(value);
  return next;
}

export const createRelayRuntimeSlice: StateCreator<AppStoreState, [], [], RelayRuntimeSlice> = (set) => ({
  ...emptyRelayRuntimeState,
  replaceRelayStatus: (relayStatus) => set({ relayStatus }),
  rememberForgottenRoom: (roomId) => set((state) => ({
    forgottenRoomIds: withValue(state.forgottenRoomIds, roomId)
  })),
  restoreForgottenRoom: (roomId) => set((state) => ({
    forgottenRoomIds: withoutValue(state.forgottenRoomIds, roomId)
  })),
  revokeRoomAccess: (roomId) => set((state) => ({
    revokedRoomIds: withValue(state.revokedRoomIds, roomId)
  })),
  restoreRoomAccess: (roomId) => set((state) => ({
    revokedRoomIds: withoutValue(state.revokedRoomIds, roomId)
  })),
  revokeTeamAccess: (teamId) => set((state) => ({
    revokedTeamIds: withValue(state.revokedTeamIds, teamId)
  })),
  restoreTeamAccess: (teamId) => set((state) => ({
    revokedTeamIds: withoutValue(state.revokedTeamIds, teamId)
  })),
  revokeWorkspaceAccess: (teamId, roomId) => set((state) => ({
    forgottenRoomIds: withValue(state.forgottenRoomIds, roomId),
    revokedRoomIds: withValue(state.revokedRoomIds, roomId),
    revokedTeamIds: withValue(state.revokedTeamIds, teamId)
  })),
  restoreWorkspaceAccess: (teamId, roomId) => set((state) => ({
    // Restoring relay authorization does not restore the local room secret. Keep the
    // room forgotten until an invite import or key rotation supplies that secret.
    revokedRoomIds: withoutValue(state.revokedRoomIds, roomId),
    revokedTeamIds: withoutValue(state.revokedTeamIds, teamId)
  }))
});
