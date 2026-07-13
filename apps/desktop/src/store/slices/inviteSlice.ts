import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { InviteJoinRequest } from "../../types";
import type { AppStoreState } from "../appStore";

export interface InviteRoomState {
  requests?: InviteJoinRequest[];
  link?: string;
  approvalGate?: boolean;
  message?: string;
  membershipCommitBusy?: boolean;
  admission?: string;
}

export type InviteByRoom = Record<string, InviteRoomState>;

export interface InvitePanelMaps {
  inviteRequestsByRoom: Record<string, InviteJoinRequest[]>;
  inviteLinksByRoom: Record<string, string>;
  inviteApprovalGatesByRoom: Record<string, boolean>;
  inviteMessagesByRoom: Record<string, string | null>;
  membershipCommitBusyByRoom: Record<string, boolean>;
  inviteAdmissionsByRoom: Record<string, string | undefined>;
}

function compactInviteRoom(record: InviteRoomState): InviteRoomState | undefined {
  return Object.keys(record).length ? record : undefined;
}

function updateInviteForRoom(
  current: InviteByRoom,
  roomId: string,
  update: (invite: InviteRoomState) => InviteRoomState
): InviteByRoom {
  const nextInvite = compactInviteRoom(update(current[roomId] ?? {}));
  if (!nextInvite) return omitRecordKey(current, roomId);
  return {
    ...current,
    [roomId]: nextInvite
  };
}

export function projectInvitePanelMaps(inviteByRoom: InviteByRoom): InvitePanelMaps {
  return {
    inviteRequestsByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.requests)
        .map(([roomId, invite]) => [roomId, invite.requests ?? []])
    ),
    inviteLinksByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.link)
        .map(([roomId, invite]) => [roomId, invite.link ?? ""])
    ),
    inviteApprovalGatesByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => typeof invite.approvalGate === "boolean")
        .map(([roomId, invite]) => [roomId, invite.approvalGate === true])
    ),
    inviteMessagesByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.message)
        .map(([roomId, invite]) => [roomId, invite.message ?? null])
    ),
    membershipCommitBusyByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.membershipCommitBusy)
        .map(([roomId]) => [roomId, true])
    ),
    inviteAdmissionsByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.admission)
        .map(([roomId, invite]) => [roomId, invite.admission])
    )
  };
}

export interface InviteSlice {
  inviteByRoom: InviteByRoom;
  inviteSecretInput: string;
  setInviteRequestsForRoom: (roomId: string, requests: InviteJoinRequest[]) => void;
  setInviteSecretInputValue: (value: string) => void;
  clearInviteSecretInput: () => void;
  setInviteAdmissionForRoom: (roomId: string, inviteId: string | null) => void;
  clearInviteAdmissionForRoom: (roomId: string) => void;
  setMembershipCommitBusyForRoom: (roomId: string, busy: boolean) => void;
  updateInviteRequestStatus: (roomId: string, requestId: string, status: InviteJoinRequest["status"]) => void;
  appendInviteRequest: (roomId: string, request: InviteJoinRequest) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteApprovalGateForRoom: (roomId: string, enabled: boolean) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
}

export const emptyInviteState: Pick<InviteSlice, "inviteByRoom" | "inviteSecretInput"> = {
  inviteByRoom: {},
  inviteSecretInput: ""
};

export const createInviteSlice: StateCreator<AppStoreState, [], [], InviteSlice> = (set) => ({
  ...emptyInviteState,
  setInviteRequestsForRoom: (roomId, requests) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => ({
        ...invite,
        requests
      }))
    }));
  },
  setInviteSecretInputValue: (value) => {
    set({ inviteSecretInput: value });
  },
  clearInviteSecretInput: () => {
    set({ inviteSecretInput: "" });
  },
  setInviteAdmissionForRoom: (roomId, inviteId) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => {
        const { admission, ...rest } = invite;
        return inviteId ? { ...invite, admission: inviteId } : rest;
      })
    }));
  },
  clearInviteAdmissionForRoom: (roomId) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => {
        const { admission, ...rest } = invite;
        return rest;
      })
    }));
  },
  setMembershipCommitBusyForRoom: (roomId, busy) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => {
        const { membershipCommitBusy, ...rest } = invite;
        return busy ? { ...invite, membershipCommitBusy: true } : rest;
      })
    }));
  },
  updateInviteRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => ({
        ...invite,
        requests: (invite.requests ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }))
    }));
  },
  appendInviteRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.inviteByRoom[roomId]?.requests ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => ({
          ...invite,
          requests: [...roomRequests, request]
        }))
      };
    });
  },
  setInviteLinkForRoom: (roomId, link) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => {
        const { link: _link, ...rest } = invite;
        return link ? { ...invite, link } : rest;
      })
    }));
  },
  setInviteApprovalGateForRoom: (roomId, enabled) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => {
        return { ...invite, approvalGate: enabled };
      })
    }));
  },
  setInviteMessageForRoom: (roomId, message) => {
    set((state) => ({
      inviteByRoom: updateInviteForRoom(state.inviteByRoom, roomId, (invite) => {
        const { message: _message, ...rest } = invite;
        return message ? { ...invite, message } : rest;
      })
    }));
  }
});
