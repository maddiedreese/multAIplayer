import { sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import type { InviteRecord as InviteRecordType } from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";

interface RegisterInviteRoutesOptions {
  app: Express;
  store: RelayStore;
  inviteTtlDays: number;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  scheduleStoreSave: () => void;
  saveRelayStore: () => Promise<void>;
  liveInviteCapPerUser: number;
  recordQuotaRejection?: (type: string) => void;
}

export function registerInviteRoutes({
  app,
  store,
  inviteTtlDays,
  getAuthSession,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave,
  saveRelayStore,
  liveInviteCapPerUser,
  recordQuotaRejection
}: RegisterInviteRoutesOptions) {
  app.post("/invites", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.body?.teamId ?? "");
    const roomId = String(req.body?.roomId ?? "");
    if (!store.hasTeam(teamId)) {
      sendRelayError(res, 404, "team_not_found", "Team not found");
      return;
    }
    if (store.getRoom(roomId)?.teamId !== teamId) {
      sendRelayError(res, 404, "room_not_found", "Room not found");
      return;
    }
    if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
      sendRelayError(res, 403, "forbidden", "Join this room before creating invites.");
      return;
    }
    if (
      session &&
      Array.from(store.invites.values()).filter(
        (invite) =>
          invite.creatorUserId === session.user.id && (!invite.expiresAt || Date.parse(invite.expiresAt) > Date.now())
      ).length >= liveInviteCapPerUser
    ) {
      recordQuotaRejection?.("live_invites_per_user");
      return void sendRelayError(res, 429, "quota_exceeded", "Live invite quota exceeded.", {
        quota: { type: "live_invites_per_user", limit: liveInviteCapPerUser, remaining: 0 }
      });
    }

    const invite: InviteRecordType = {
      id: `invite_${nanoid(16)}`,
      teamId,
      roomId,
      ...(session ? { creatorUserId: session.user.id } : {}),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + inviteTtlDays * 24 * 60 * 60 * 1000).toISOString()
    };
    store.setInvite(invite);
    try {
      await saveRelayStore();
    } catch {
      store.deleteInvite(invite.id);
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist invite quota and invite.");
    }
    res.status(201).json({ invite });
  });

  app.get("/invites/:inviteId", (req, res) => {
    const invite = store.getInvite(req.params.inviteId);
    if (!invite) {
      sendRelayError(res, 404, "invite_not_found", "Invite not found");
      return;
    }
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      store.deleteInvite(invite.id);
      deleteInviteArtifacts(store, invite.id);
      scheduleStoreSave();
      sendRelayError(res, 410, "invite_expired", "Invite expired");
      return;
    }

    const team = store.getTeam(invite.teamId);
    const room = store.getRoom(invite.roomId);
    if (!team || !room) {
      sendRelayError(res, 404, "invite_not_found", "Invite target no longer exists");
      return;
    }

    const registeredHostDevice =
      room.hostUserId && room.activeHostDeviceId
        ? store.getDevice(room.hostUserId, room.activeHostDeviceId)
        : undefined;
    const hostDevice = registeredHostDevice
      ? {
          userId: registeredHostDevice.userId,
          deviceId: registeredHostDevice.deviceId,
          signaturePublicKey: registeredHostDevice.signaturePublicKey,
          signatureKeyFingerprint: registeredHostDevice.signatureKeyFingerprint,
          hpkePublicKey: registeredHostDevice.hpkePublicKey,
          hpkeKeyFingerprint: registeredHostDevice.hpkeKeyFingerprint
        }
      : null;

    // An invitee is not a team member yet, so the protected invite lookup must
    // carry the exact active-host public identity needed to verify the fragment.
    // Do not expose the rest of the team device directory or device activity.
    const { creatorUserId: _creatorUserId, ...publicInvite } = invite;
    res.json({ invite: publicInvite, team, room, hostDevice });
  });

  app.delete("/teams/:teamId/rooms/:roomId/invites", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const { teamId, roomId } = req.params;
    const room = store.getRoom(roomId);
    if (!room || room.teamId !== teamId) {
      sendRelayError(res, 404, "room_not_found", "Room not found");
      return;
    }
    if (session && room.hostUserId !== session.user.id) {
      sendRelayError(res, 403, "forbidden", "Only the active host can revoke room invites.");
      return;
    }

    let revoked = 0;
    for (const [inviteId, invite] of store.invites.entries()) {
      if (invite.teamId === teamId && invite.roomId === roomId && store.deleteInvite(inviteId)) {
        deleteInviteArtifacts(store, inviteId);
        revoked += 1;
      }
    }
    if (revoked > 0) scheduleStoreSave();
    res.json({ revoked });
  });
}

function deleteInviteArtifacts(store: RelayStore, inviteId: string) {
  for (const [requestId, request] of store.inviteRequests) {
    if (request.inviteId === inviteId) store.inviteRequests.delete(requestId);
  }
  for (const [requestId, response] of store.inviteResponses) {
    if (response.inviteId === inviteId) store.inviteResponses.delete(requestId);
  }
}
