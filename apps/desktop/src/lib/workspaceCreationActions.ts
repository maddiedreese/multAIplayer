import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { chooseProjectFolder, defaultProjectPath } from "./localBackend";
import { loadTeamHistorySettings, seedNewRoomHistorySettings } from "./localHistory";
import {
  createFirstWorkspaceCreator,
  createWorkspaceRoom,
  createWorkspaceTeam,
  type FirstWorkspaceCreationInput,
  type WorkspaceCreationRuntime
} from "./firstWorkspaceCreation";
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
  upsertRoom: (room: ClientRoomRecord) => void;
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
  const creationRuntime: WorkspaceCreationRuntime = {
    createTeam,
    createRoom,
    findTeam: (teamId) => useAppStore.getState().teams.find((team) => team.id === teamId),
    upsertTeam,
    upsertRoom,
    selectTeam: setSelectedTeam,
    selectRoom: setSelectedRoomId,
    restoreRoomAccess: (roomId) => useAppStore.getState().restoreRoomAccess(roomId),
    restoreTeamAccess: (teamId) => useAppStore.getState().restoreTeamAccess(teamId),
    restoreForgottenRoom: (roomId) => useAppStore.getState().restoreForgottenRoom(roomId),
    setInviteApprovalGate: (roomId, enabled) => useAppStore.getState().setInviteApprovalGateForRoom(roomId, enabled),
    loadTeamHistorySettings,
    seedNewRoomHistorySettings,
    initializeMessages: (roomId) => useAppStore.getState().initializeMessagesForRoom(roomId)
  };
  const createFirstWorkspace = createFirstWorkspaceCreator(creationRuntime);

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
      await createWorkspaceTeam(plan, creationRuntime);
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
      const room = await createWorkspaceRoom(
        plan,
        {
          approvalPolicy: teamDefaults.approvalPolicy,
          codexModel: teamDefaults.codexModel,
          browserAllowedOrigins: teamDefaults.browserAllowedOrigins,
          browserProfilePersistent: teamDefaults.browserProfilePersistent
        },
        {
          inviteApprovalGate: teamDefaults.inviteApprovalGate,
          historySettings: loadTeamHistorySettings(plan.teamId)
        },
        creationRuntime
      );
      setNewRoomName("");
      setNewRoomProjectPath(plan.projectPath);
      setWorkspaceStatusError(null);
      const onboarding = useAppStore.getState().onboarding;
      if (!onboarding.markers.membership) {
        useAppStore.getState().applyOnboardingEvent({
          type: "room_ready",
          intent: "create",
          teamId: room.teamId,
          roomId: room.id
        });
        useAppStore.getState().applyOnboardingEvent({ type: "project_attached", roomId: room.id });
        useAppStore.getState().applyOnboardingEvent({ type: "dismiss_assistant" });
      }
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

  async function createOnboardingWorkspace(input: FirstWorkspaceCreationInput) {
    return createFirstWorkspace(input);
  }

  return { addTeam, addRoom, createOnboardingWorkspace, chooseNewRoomProjectPath, setTeamLifecycle, setRoomLifecycle };
}
