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
}

export function registerInviteRoutes({
  app,
  store,
  inviteTtlDays,
  getAuthSession,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave
}: RegisterInviteRoutesOptions) {
  app.post("/invites", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.body?.teamId ?? "");
    const roomId = String(req.body?.roomId ?? "");
    if (!store.hasTeam(teamId)) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (store.getRoom(roomId)?.teamId !== teamId) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
      res.status(403).json({ error: "Join this room before creating invites." });
      return;
    }

    const invite: InviteRecordType = {
      id: `invite_${nanoid(16)}`,
      teamId,
      roomId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + inviteTtlDays * 24 * 60 * 60 * 1000).toISOString()
    };
    store.setInvite(invite);
    scheduleStoreSave();
    res.status(201).json({ invite });
  });

  app.get("/invites/:inviteId", (req, res) => {
    const invite = store.getInvite(req.params.inviteId);
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      store.deleteInvite(invite.id);
      scheduleStoreSave();
      res.status(410).json({ error: "Invite expired" });
      return;
    }

    const team = store.getTeam(invite.teamId);
    const room = store.getRoom(invite.roomId);
    if (!team || !room) {
      res.status(404).json({ error: "Invite target no longer exists" });
      return;
    }

    res.json({ invite, team, room });
  });
}
