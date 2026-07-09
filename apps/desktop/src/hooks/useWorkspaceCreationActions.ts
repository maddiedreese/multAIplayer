import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { createRoom, createTeam, updateRoomLifecycle, updateTeamLifecycle } from "../lib/workspaceClient";
import { chooseProjectFolder, defaultProjectPath } from "../lib/localBackend";
import { loadTeamRoomDefaults } from "../lib/teamRoomDefaults";
import { loadTeamHistorySettings, saveHistorySettings } from "../lib/localHistory";
import { planRoomCreation, planTeamCreation } from "../lib/workspaceCreation";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { useAppStore } from "../store/appStore";

interface UseWorkspaceCreationActionsOptions {
  selectedTeam: string;
  newTeamName: string;
  newRoomName: string;
  newRoomProjectPath: string;
  setWorkspaceStatusError: (message: string | null) => void;
  setSelectedTeam: (teamId: string) => void;
  setSelectedRoomId: (roomId: string) => void;
  setNewTeamName: (name: string) => void;
  setNewRoomName: (name: string) => void;
  setNewRoomProjectPath: (path: string) => void;
  restoreRoomAccess: (roomId: string) => void;
  restoreTeamAccess: (teamId: string) => void;
  restoreForgottenRoom: (roomId: string) => void;
  setInviteApprovalGateForRoom: (roomId: string, inviteApprovalGate: boolean) => void;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: RoomRecord) => void;
  roomSettingsActor: () => { requesterName: string; requesterUserId: string };
}

export function useWorkspaceCreationActions({
  selectedTeam,
  newTeamName,
  newRoomName,
  newRoomProjectPath,
  setWorkspaceStatusError,
  setSelectedTeam,
  setSelectedRoomId,
  setNewTeamName,
  setNewRoomName,
  setNewRoomProjectPath,
  restoreRoomAccess,
  restoreTeamAccess,
  restoreForgottenRoom,
  setInviteApprovalGateForRoom,
  upsertTeam,
  upsertRoom,
  roomSettingsActor
}: UseWorkspaceCreationActionsOptions) {
  const initializeMessagesForRoom = useAppStore((state) => state.initializeMessagesForRoom);

  async function addTeam() {
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
    let plan: ReturnType<typeof planRoomCreation>;
    try {
      plan = planRoomCreation(selectedTeam, newRoomName, newRoomProjectPath);
    } catch (error) {
      setWorkspaceStatusError(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const teamDefaults = loadTeamRoomDefaults(plan.teamId);
      const room = await createRoom(
        plan.teamId,
        plan.name,
        plan.projectPath,
        {
          approvalPolicy: teamDefaults.approvalPolicy,
          codexModel: teamDefaults.codexModel,
          browserAllowedOrigins: teamDefaults.browserAllowedOrigins,
          browserProfilePersistent: teamDefaults.browserProfilePersistent
        }
      );
      upsertRoom(ensureRoomDefaults(room));
      restoreRoomAccess(room.id);
      restoreTeamAccess(room.teamId);
      restoreForgottenRoom(room.id);
      setInviteApprovalGateForRoom(room.id, teamDefaults.inviteApprovalGate);
      saveHistorySettings(room.id, loadTeamHistorySettings(plan.teamId));
      initializeMessagesForRoom(room.id);
      setSelectedRoomId(room.id);
      setNewRoomName("");
      setNewRoomProjectPath(plan.projectPath);
      setWorkspaceStatusError(null);
    } catch (error) {
      setWorkspaceStatusError(String(error));
    }
  }

  async function chooseNewRoomProjectPath() {
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

  return {
    addTeam,
    addRoom,
    chooseNewRoomProjectPath,
    setTeamLifecycle,
    setRoomLifecycle
  };
}
