import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { InviteJoinRequest } from "../../types";
import type { AppStoreState } from "../appStore";

type InviteRequestsByRoom = Record<string, InviteJoinRequest[]>;
type InviteLinksByRoom = Record<string, string>;
type InviteApprovalGatesByRoom = Record<string, boolean>;
type InviteMessagesByRoom = Record<string, string | null>;
type KeyRotationBusyByRoom = Record<string, boolean>;
type InviteAdmissionsByRoom = Record<string, string>;

export interface InviteSlice {
  inviteRequestsByRoom: InviteRequestsByRoom;
  inviteSecretInput: string;
  inviteLinksByRoom: InviteLinksByRoom;
  inviteApprovalGatesByRoom: InviteApprovalGatesByRoom;
  inviteMessagesByRoom: InviteMessagesByRoom;
  keyRotationBusyByRoom: KeyRotationBusyByRoom;
  inviteAdmissionsByRoom: InviteAdmissionsByRoom;
  setInviteRequestsForRoom: (roomId: string, requests: InviteJoinRequest[]) => void;
  setInviteSecretInputValue: (value: string) => void;
  clearInviteSecretInput: () => void;
  setInviteAdmissionForRoom: (roomId: string, inviteId: string | null) => void;
  clearInviteAdmissionForRoom: (roomId: string) => void;
  setKeyRotationBusyForRoom: (roomId: string, busy: boolean) => void;
  updateInviteRequestStatus: (roomId: string, requestId: string, status: InviteJoinRequest["status"]) => void;
  appendInviteRequest: (roomId: string, request: InviteJoinRequest) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteApprovalGateForRoom: (roomId: string, enabled: boolean) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
}

export const emptyInviteState: Pick<
  InviteSlice,
  | "inviteRequestsByRoom"
  | "inviteSecretInput"
  | "inviteLinksByRoom"
  | "inviteApprovalGatesByRoom"
  | "inviteMessagesByRoom"
  | "keyRotationBusyByRoom"
  | "inviteAdmissionsByRoom"
> = {
  inviteRequestsByRoom: {},
  inviteSecretInput: "",
  inviteLinksByRoom: {},
  inviteApprovalGatesByRoom: {},
  inviteMessagesByRoom: {},
  keyRotationBusyByRoom: {},
  inviteAdmissionsByRoom: {}
};

export const createInviteSlice: StateCreator<AppStoreState, [], [], InviteSlice> = (set) => ({
  ...emptyInviteState,
  setInviteRequestsForRoom: (roomId, requests) => {
    set((state) => ({
      inviteRequestsByRoom: {
        ...state.inviteRequestsByRoom,
        [roomId]: requests
      }
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
      inviteAdmissionsByRoom: inviteId
        ? { ...state.inviteAdmissionsByRoom, [roomId]: inviteId }
        : omitRecordKey(state.inviteAdmissionsByRoom, roomId)
    }));
  },
  clearInviteAdmissionForRoom: (roomId) => {
    set((state) => ({
      inviteAdmissionsByRoom: omitRecordKey(state.inviteAdmissionsByRoom, roomId)
    }));
  },
  setKeyRotationBusyForRoom: (roomId, busy) => {
    set((state) => ({
      keyRotationBusyByRoom: busy
        ? { ...state.keyRotationBusyByRoom, [roomId]: true }
        : omitRecordKey(state.keyRotationBusyByRoom, roomId)
    }));
  },
  updateInviteRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      inviteRequestsByRoom: {
        ...state.inviteRequestsByRoom,
        [roomId]: (state.inviteRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  appendInviteRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.inviteRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        inviteRequestsByRoom: {
          ...state.inviteRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  setInviteLinkForRoom: (roomId, link) => {
    set((state) => ({
      inviteLinksByRoom: link
        ? { ...state.inviteLinksByRoom, [roomId]: link }
        : omitRecordKey(state.inviteLinksByRoom, roomId)
    }));
  },
  setInviteApprovalGateForRoom: (roomId, enabled) => {
    set((state) => ({
      inviteApprovalGatesByRoom: enabled
        ? { ...state.inviteApprovalGatesByRoom, [roomId]: true }
        : omitRecordKey(state.inviteApprovalGatesByRoom, roomId)
    }));
  },
  setInviteMessageForRoom: (roomId, message) => {
    set((state) => ({
      inviteMessagesByRoom: message
        ? { ...state.inviteMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.inviteMessagesByRoom, roomId)
    }));
  }
});
