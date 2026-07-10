import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { chooseProjectFolder, defaultProjectPath } from "./localBackend";
import { loadTeamHistorySettings, saveHistorySettings } from "./localHistory";
import { ensureRoomDefaults } from "./roomDefaults";
import { loadTeamRoomDefaults } from "./teamRoomDefaults";
import { planRoomCreation, planTeamCreation } from "./workspaceCreation";
import { createRoom, createTeam, updateRoomLifecycle, updateTeamLifecycle } from "./workspaceClient";
import { useAppStore } from "../store/appStore";

interface WorkspaceCreationActionsOptions {
  setWorkspaceStatusError: (message: string | null) => void;
  setSelectedTeam: (teamId: string) => void;
  setSelectedRoomId: (roomId: string) => void;
  setNewTeamName: (name: string) => void;
  setNewRoomName: (name: string) => void;
  setNewRoomProjectPath: (path: string) => void;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: RoomRecord) => void;
  roomSettingsActor: () => { requesterName: string; requesterUserId: string };
}

export function createWorkspaceCreationActions({
  setWorkspaceStatusError,
  setSelectedTeam,
  setSelectedRoomId,
  setNewTeamName,
  setNewRoomName,
  setNewRoomProjectPath,
  upsertTeam,
  upsertRoom,
  roomSettingsActor
}: WorkspaceCreationActionsOptions) {
  async function addTeam() {
    const { newTeamName } = useAppStore.getState();
    let plan: ReturnType<typeof planTeamCreation>;
    try {
      plan = planTeamCreation(newTeamName);
    } catch (error) {
      setWorkspaceStatusError(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const team = await createTeam(plan.name);
      upsertTeam(team);
      setSelectedTeam(team.id);
      setNewTeamName("");
      setWorkspaceStatusError(null);
    } catch (error) {
      setWorkspaceStatusError(String(error));
    }
  }

  async function addRoom() {
    const { selectedTeam, newRoomName, newRoomProjectPath } = useAppStore.getState();
    let plan: ReturnType<typeof planRoomCreation>;
    try {
      plan = planRoomCreation(selectedTeam, newRoomName, newRoomProjectPath);
    } catch (error) {
      setWorkspaceStatusError(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const teamDefaults = loadTeamRoomDefaults(plan.teamId);
      const room = await createRoom(plan.teamId, plan.name, plan.projectPath, {
        approvalPolicy: teamDefaults.approvalPolicy,
        codexModel: teamDefaults.codexModel,
        browserAllowedOrigins: teamDefaults.browserAllowedOrigins,
        browserProfilePersistent: teamDefaults.browserProfilePersistent
      });
      upsertRoom(ensureRoomDefaults(room));
      const store = useAppStore.getState();
      store.restoreRoomAccess(room.id);
      store.restoreTeamAccess(room.teamId);
      store.restoreForgottenRoom(room.id);
      store.setInviteApprovalGateForRoom(room.id, teamDefaults.inviteApprovalGate);
      saveHistorySettings(room.id, loadTeamHistorySettings(plan.teamId));
      store.initializeMessagesForRoom(room.id);
      setSelectedRoomId(room.id);
      setNewRoomName("");
      setNewRoomProjectPath(plan.projectPath);
      setWorkspaceStatusError(null);
    } catch (error) {
      setWorkspaceStatusError(String(error));
    }
  }

  async function chooseNewRoomProjectPath() {
    const { newRoomProjectPath } = useAppStore.getState();
    try {
      const path = await chooseProjectFolder(newRoomProjectPath || defaultProjectPath);
      if (!path) return;
      setNewRoomProjectPath(path);
      setWorkspaceStatusError(null);
    } catch (error) {
      setWorkspaceStatusError(String(error));
    }
  }

  async function setTeamLifecycle(teamId: string, action: "archive" | "restore" | "delete") {
    try {
      const result = await updateTeamLifecycle(teamId, action);
      upsertTeam(result.team);
      for (const room of result.rooms) upsertRoom(ensureRoomDefaults(room));
      setWorkspaceStatusError(null);
    } catch (error) {
      setWorkspaceStatusError(String(error));
    }
  }

  async function setRoomLifecycle(roomId: string, action: "archive" | "restore" | "delete") {
    try {
      const room = await updateRoomLifecycle(roomId, action, roomSettingsActor());
      upsertRoom(ensureRoomDefaults(room));
      setWorkspaceStatusError(null);
    } catch (error) {
      setWorkspaceStatusError(String(error));
    }
  }

  return { addTeam, addRoom, chooseNewRoomProjectPath, setTeamLifecycle, setRoomLifecycle };
}
