import React, { useMemo, type ComponentProps } from "react";
import { codexModelOptions, defaultCodexModel } from "@multaiplayer/protocol";
import { AppSidebarDrawer } from "./AppSidebarDrawer";
import { DesktopSidebar } from "./DesktopSidebar";
import { defaultRelayHttpUrl, defaultRelayWsUrl } from "../lib/appConfig";
import { formatCodexModel, formatSessionPersistence } from "../lib/appFormatters";
import { formatCodexCompatibilitySummary } from "../lib/codexCompatibility";
import { defaultProjectPath } from "../lib/localBackend";
import { roomSecretStorageLabel } from "../lib/appRuntime";
import { hideUnreadForLockedRooms } from "../lib/roomUnread";
import { useLocalIdentity } from "../hooks/useLocalIdentity";
import { useRoomAccess } from "../hooks/useRoomAccess";
import { useSidebarNavigation } from "../hooks/useSidebarNavigation";
import { approvalPolicyLabels, emptyRoom } from "../seedData";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import { projectBrowserPanelMaps } from "../store/slices/browserSlice";
import { projectCodexRuntimeMaps } from "../store/slices/codexHostHandoffSlice";
import { projectHistorySearchMessagesByRoom } from "../store/slices/historyPresenceSlice";
import { projectTerminalRuntimeRequestsByRoom } from "../store/slices/terminalSlice";
import type { RoomSettingsRoomState } from "../store/slices/roomSettingsSlice";
import type { useGitHubAuth } from "../hooks/useGitHubAuth";
import type { useRoomRuntimeContext } from "../hooks/useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "../hooks/useWorkspaceFlowContext";

type DrawerSettingsProps = ComponentProps<typeof AppSidebarDrawer>["settings"];
const emptyRoomSettings: RoomSettingsRoomState = {};

export interface SidebarNavigationCapabilities {
  signIn: () => void;
  signOut: () => void;
  createTeam: () => void;
  chooseNewRoomProjectPath: () => void;
  createRoom: () => void;
  setTeamLifecycle: (teamId: string, action: "archive" | "restore" | "delete") => void;
  setRoomLifecycle: (roomId: string, action: "archive" | "restore" | "delete") => void;
}

export interface SidebarDrawerCapabilities {
  signIn: () => void;
  signOut: () => void;
  rotateDeviceIdentity: () => void;
  chooseProject: () => void;
  updateLocalHistorySettings: (settings: DrawerSettingsProps["historySettings"]) => void;
  clearRoomHistory: () => void;
  forgetSelectedRoomLocalData: () => void;
  updateTeamHistoryDefaults: (settings: DrawerSettingsProps["teamHistorySettings"]) => void;
  updateTeamDefaultApprovalPolicy: DrawerSettingsProps["onTeamDefaultApprovalPolicyChange"];
  updateTeamDefaultCodexModel: (model: string) => void;
  updateTeamDefaultInviteApprovalGate: (enabled: boolean) => void;
  applyTeamDefaultsToRoom: () => void;
}

export interface SidebarSources {
  githubAuth: Pick<ReturnType<typeof useGitHubAuth>, "beginGitHubSignIn">;
  roomRuntime: Pick<ReturnType<typeof useRoomRuntimeContext>, "signOut" | "rotateDeviceIdentity" | "chooseProjectPath">;
  workspaceFlow: Pick<
    ReturnType<typeof useWorkspaceFlowContext>,
    | "addTeam"
    | "chooseNewRoomProjectPath"
    | "addRoom"
    | "setTeamLifecycle"
    | "setRoomLifecycle"
    | "updateLocalHistorySettings"
    | "clearRoomHistory"
    | "forgetSelectedRoomLocalData"
    | "updateTeamHistoryDefaults"
    | "updateTeamDefaultApprovalPolicy"
    | "updateTeamDefaultCodexModel"
    | "updateTeamDefaultInviteApprovalGate"
    | "applyTeamDefaultsToRoom"
  >;
}

export function DesktopSidebarContainer({ sources }: { sources: SidebarSources }) {
  const capabilities: SidebarNavigationCapabilities = {
    signIn: sources.githubAuth.beginGitHubSignIn,
    signOut: sources.roomRuntime.signOut,
    createTeam: sources.workspaceFlow.addTeam,
    chooseNewRoomProjectPath: sources.workspaceFlow.chooseNewRoomProjectPath,
    createRoom: sources.workspaceFlow.addRoom,
    setTeamLifecycle: sources.workspaceFlow.setTeamLifecycle,
    setRoomLifecycle: sources.workspaceFlow.setRoomLifecycle
  };
  const {
    currentUser,
    authBusy,
    authConfig,
    authError,
    deviceFlow,
    sidebarQuery,
    workspaceError,
    newTeamName,
    newRoomName,
    newRoomProjectPath,
    selectedTeam,
    selectedRoomId,
    teams,
    rooms,
    messagesByRoom,
    historyPresenceByRoom,
    codexRuntimeByRoom,
    terminalRuntimeByRoom,
    browserByRoom,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySearchBusy,
    activeSidebarPanel,
    setSidebarQuery,
    setNewTeamName,
    setNewRoomName,
    setNewRoomProjectPath,
    selectTeamRoom,
    selectWorkspaceRoom,
    setSelectedRoomId,
    setActiveSidebarPanel
  } = useAppStore(
    useShallow((state) => ({
      currentUser: state.currentUser,
      authBusy: state.authBusy,
      authConfig: state.authConfig,
      authError: state.authError,
      deviceFlow: state.deviceFlow,
      sidebarQuery: state.sidebarQuery,
      workspaceError: state.workspaceError,
      newTeamName: state.newTeamName,
      newRoomName: state.newRoomName,
      newRoomProjectPath: state.newRoomProjectPath,
      selectedTeam: state.selectedTeam,
      selectedRoomId: state.selectedRoomId,
      teams: state.teams,
      rooms: state.rooms,
      messagesByRoom: state.messagesByRoom,
      historyPresenceByRoom: state.historyPresenceByRoom,
      codexRuntimeByRoom: state.codexRuntimeByRoom,
      terminalRuntimeByRoom: state.terminalRuntimeByRoom,
      browserByRoom: state.browserByRoom,
      forgottenRoomIds: state.forgottenRoomIds,
      revokedRoomIds: state.revokedRoomIds,
      revokedTeamIds: state.revokedTeamIds,
      historySearchBusy: state.historySearchBusy,
      activeSidebarPanel: state.activeSidebarPanel,
      setSidebarQuery: state.setSidebarQuery,
      setNewTeamName: state.setNewTeamName,
      setNewRoomName: state.setNewRoomName,
      setNewRoomProjectPath: state.setNewRoomProjectPath,
      selectTeamRoom: state.selectTeamRoom,
      selectWorkspaceRoom: state.selectWorkspaceRoom,
      setSelectedRoomId: state.setSelectedRoomId,
      setActiveSidebarPanel: state.setActiveSidebarPanel
    }))
  );

  const visibleRooms = useMemo(
    () => hideUnreadForLockedRooms(rooms, forgottenRoomIds, revokedRoomIds, revokedTeamIds),
    [forgottenRoomIds, revokedRoomIds, revokedTeamIds, rooms]
  );
  const historySearchMessagesByRoom = useMemo(
    () => projectHistorySearchMessagesByRoom(historyPresenceByRoom),
    [historyPresenceByRoom]
  );
  const approvalVisibleByRoom = useMemo(
    () => projectCodexRuntimeMaps(codexRuntimeByRoom).approvalVisibleByRoom,
    [codexRuntimeByRoom]
  );
  const terminalRequestsByRoom = useMemo(
    () => projectTerminalRuntimeRequestsByRoom(terminalRuntimeByRoom),
    [terminalRuntimeByRoom]
  );
  const browserRequestsByRoom = useMemo(
    () => projectBrowserPanelMaps(browserByRoom).browserRequestsByRoom,
    [browserByRoom]
  );
  const display = useSidebarNavigation({
    sidebarQuery,
    rooms: visibleRooms,
    teams,
    selectedTeam,
    selectedRoomId,
    messagesByRoom,
    historySearchMessagesByRoom,
    approvalVisibleByRoom,
    terminalRequestsByRoom,
    browserRequestsByRoom,
    approvalPolicyLabels
  });

  return (
    <DesktopSidebar
      currentUser={currentUser}
      authBusy={authBusy}
      authConfig={authConfig}
      authError={authError}
      deviceFlow={deviceFlow}
      sidebarQuery={sidebarQuery}
      searchActive={display.searchActive}
      workspaceError={workspaceError}
      newTeamName={newTeamName}
      newRoomName={newRoomName}
      newRoomProjectPath={newRoomProjectPath}
      defaultProjectPath={defaultProjectPath}
      selectedTeam={Boolean(selectedTeam)}
      teams={display.sidebarTeamRows}
      rooms={display.sidebarRoomRows}
      messageHits={display.sidebarMessageHitRows}
      historySearchBusy={historySearchBusy}
      activeSidebarPanel={activeSidebarPanel}
      onSignIn={capabilities.signIn}
      onSignOut={capabilities.signOut}
      onSidebarQueryChange={setSidebarQuery}
      onClearSidebarQuery={() => setSidebarQuery("")}
      onNewTeamNameChange={setNewTeamName}
      onCreateTeam={capabilities.createTeam}
      onSelectTeam={(teamId) => selectTeamRoom(teamId, rooms[0]?.id ?? "")}
      onNewRoomNameChange={setNewRoomName}
      onNewRoomProjectPathChange={setNewRoomProjectPath}
      onChooseNewRoomProjectPath={capabilities.chooseNewRoomProjectPath}
      onCreateRoom={capabilities.createRoom}
      onSelectRoom={(roomId, teamId) => {
        if (teamId) selectWorkspaceRoom(teamId, roomId);
        else setSelectedRoomId(roomId);
      }}
      onSetTeamLifecycle={capabilities.setTeamLifecycle}
      onSetRoomLifecycle={capabilities.setRoomLifecycle}
      onSelectSidebarPanel={setActiveSidebarPanel}
    />
  );
}

export function AppSidebarDrawerContainer({ sources }: { sources: SidebarSources }) {
  const capabilities: SidebarDrawerCapabilities = {
    signIn: sources.githubAuth.beginGitHubSignIn,
    signOut: sources.roomRuntime.signOut,
    rotateDeviceIdentity: sources.roomRuntime.rotateDeviceIdentity,
    chooseProject: sources.roomRuntime.chooseProjectPath,
    updateLocalHistorySettings: sources.workspaceFlow.updateLocalHistorySettings,
    clearRoomHistory: sources.workspaceFlow.clearRoomHistory,
    forgetSelectedRoomLocalData: sources.workspaceFlow.forgetSelectedRoomLocalData,
    updateTeamHistoryDefaults: sources.workspaceFlow.updateTeamHistoryDefaults,
    updateTeamDefaultApprovalPolicy: sources.workspaceFlow.updateTeamDefaultApprovalPolicy,
    updateTeamDefaultCodexModel: sources.workspaceFlow.updateTeamDefaultCodexModel,
    updateTeamDefaultInviteApprovalGate: sources.workspaceFlow.updateTeamDefaultInviteApprovalGate,
    applyTeamDefaultsToRoom: sources.workspaceFlow.applyTeamDefaultsToRoom
  };
  const {
    currentUser,
    authBusy,
    authConfig,
    authError,
    deviceFlow,
    selectedTeam,
    selectedRoom,
    hasSelectedRoom,
    activeSidebarPanel,
    appConfig,
    relayHttpDraft,
    relayWsDraft,
    appConfigMessage,
    relayStatus,
    codexProbe,
    deviceIdentity,
    deviceIdentityMessage,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    roomSettings,
    inviteApprovalGate,
    historySettings,
    teamHistorySettings,
    teamDefaultApprovalPolicy,
    teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate,
    historyMessage,
    teamHistoryMessage,
    setActiveSidebarPanel,
    setRelayHttpDraft,
    setRelayWsDraft,
    resetRelayConfiguration,
    saveRelayConfiguration,
    setRoomNotificationsMuted,
    setTeamDefaultBrowserProfilePersistent
  } = useAppStore(
    useShallow((state) => {
      const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0] ?? emptyRoom;
      return {
        currentUser: state.currentUser,
        authBusy: state.authBusy,
        authConfig: state.authConfig,
        authError: state.authError,
        deviceFlow: state.deviceFlow,
        selectedTeam: state.selectedTeam,
        selectedRoom,
        hasSelectedRoom: state.rooms.some((room) => room.id === state.selectedRoomId),
        activeSidebarPanel: state.activeSidebarPanel,
        appConfig: state.appConfig,
        relayHttpDraft: state.relayHttpDraft,
        relayWsDraft: state.relayWsDraft,
        appConfigMessage: state.appConfigMessage,
        relayStatus: state.relayStatus,
        codexProbe: state.codexProbe,
        deviceIdentity: state.deviceIdentity,
        deviceIdentityMessage: state.deviceIdentityMessage,
        forgottenRoomIds: state.forgottenRoomIds,
        revokedRoomIds: state.revokedRoomIds,
        revokedTeamIds: state.revokedTeamIds,
        roomSettings: state.roomSettingsByRoom[selectedRoom.id] ?? emptyRoomSettings,
        inviteApprovalGate: state.inviteByRoom[selectedRoom.id]?.approvalGate ?? true,
        historySettings: state.historySettings,
        teamHistorySettings: state.teamHistorySettings,
        teamDefaultApprovalPolicy: state.teamDefaultApprovalPolicy,
        teamDefaultCodexModel: state.teamDefaultCodexModel,
        teamDefaultBrowserProfilePersistent: state.teamDefaultBrowserProfilePersistent,
        teamDefaultInviteApprovalGate: state.teamDefaultInviteApprovalGate,
        historyMessage: state.historyPresenceByRoom[selectedRoom.id]?.historyMessage ?? null,
        teamHistoryMessage: state.teamHistoryByTeam[state.selectedTeam || "__no-team"]?.message ?? null,
        setActiveSidebarPanel: state.setActiveSidebarPanel,
        setRelayHttpDraft: state.setRelayHttpDraft,
        setRelayWsDraft: state.setRelayWsDraft,
        resetRelayConfiguration: state.resetRelayConfiguration,
        saveRelayConfiguration: state.saveRelayConfiguration,
        setRoomNotificationsMuted: state.setRoomNotificationsMuted,
        setTeamDefaultBrowserProfilePersistent: state.setTeamDefaultBrowserProfilePersistent
      };
    })
  );
  const { deviceId, localUser } = useLocalIdentity(currentUser);
  const access = useRoomAccess({
    hasSelectedRoom,
    selectedRoom,
    localUser,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySettings,
    inviteApprovalGate
  });
  const settingsMessage = appConfigMessage ?? roomSettings.settingsMessage ?? historyMessage ?? teamHistoryMessage;
  const selectedCodexModel = selectedRoom.codexModel ?? defaultCodexModel;

  return (
    <AppSidebarDrawer
      activePanel={activeSidebarPanel}
      profileTitle={localUser.name}
      settingsTitle={selectedRoom.name}
      profile={{
        currentUser,
        authConfig,
        authBusy,
        authError,
        deviceFlow,
        deviceId,
        deviceIdentity,
        deviceIdentityMessage,
        relaySessionPersistence: formatSessionPersistence(authConfig?.sessionPersistence),
        onRotateDeviceIdentity: capabilities.rotateDeviceIdentity,
        onSignIn: capabilities.signIn,
        onSignOut: capabilities.signOut
      }}
      settings={{
        relaySummary: `${relayStatus} · ${appConfig.relayWsUrl}`,
        relayApi: appConfig.relayHttpUrl,
        codexSummary: codexProbe?.available
          ? formatCodexCompatibilitySummary(codexProbe.version)
          : (codexProbe?.error ?? "Not connected"),
        projectPath: selectedRoom.projectPath,
        modelLabel: formatCodexModel(selectedCodexModel),
        approvalLabel: approvalPolicyLabels[selectedRoom.approvalPolicy],
        roomKeysLabel: roomSecretStorageLabel(),
        posture: access.roomPosture,
        chooseProjectDisabled:
          !hasSelectedRoom || access.isSelectedRoomLocked || Boolean(roomSettings.settingsBusy) || !access.isActiveHost,
        relayHttpDraft,
        relayWsDraft,
        defaultRelayHttpUrl,
        defaultRelayWsUrl,
        saveRelayDisabled: !relayHttpDraft.trim() || !relayWsDraft.trim(),
        showRoomSettingsGate: !access.isActiveHost && hasSelectedRoom,
        roomSettingsGateMessage: access.roomSettingsGateMessage,
        notificationsMuted: Boolean(roomSettings.notificationsMuted),
        historySettings,
        teamHistorySettings,
        hasSelectedRoom,
        selectedTeam: Boolean(selectedTeam),
        settingsBusy: Boolean(roomSettings.settingsBusy),
        teamDefaultApprovalPolicy,
        approvalPolicyLabels,
        teamDefaultCodexModel,
        defaultCodexModel,
        codexModelOptions,
        teamDefaultBrowserProfilePersistent,
        teamDefaultInviteApprovalGate,
        message: settingsMessage,
        onChooseProject: capabilities.chooseProject,
        onRelayHttpDraftChange: setRelayHttpDraft,
        onRelayWsDraftChange: setRelayWsDraft,
        onResetRelay: resetRelayConfiguration,
        onSaveRelay: saveRelayConfiguration,
        onNotificationsMutedChange: (muted) => setRoomNotificationsMuted(selectedRoom.id, muted),
        onHistoryEnabledChange: (enabled) => capabilities.updateLocalHistorySettings({ ...historySettings, enabled }),
        onHistoryRetentionDaysChange: (retentionDays) =>
          capabilities.updateLocalHistorySettings({ ...historySettings, retentionDays }),
        onClearRoomHistory: capabilities.clearRoomHistory,
        onForgetRoomLocalData: capabilities.forgetSelectedRoomLocalData,
        onTeamHistoryEnabledChange: (enabled) =>
          capabilities.updateTeamHistoryDefaults({ ...teamHistorySettings, enabled }),
        onTeamHistoryRetentionDaysChange: (retentionDays) =>
          capabilities.updateTeamHistoryDefaults({ ...teamHistorySettings, retentionDays }),
        onTeamDefaultApprovalPolicyChange: capabilities.updateTeamDefaultApprovalPolicy,
        onTeamDefaultCodexModelChange: capabilities.updateTeamDefaultCodexModel,
        onTeamDefaultBrowserProfilePersistentChange: setTeamDefaultBrowserProfilePersistent,
        onTeamDefaultInviteApprovalGateChange: capabilities.updateTeamDefaultInviteApprovalGate,
        onApplyTeamDefaultsToRoom: capabilities.applyTeamDefaultsToRoom
      }}
      onClose={() => setActiveSidebarPanel(null)}
    />
  );
}
