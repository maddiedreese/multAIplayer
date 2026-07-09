import type { ComponentProps } from "react";
import { codexModelOptions, defaultCodexModel } from "@multaiplayer/protocol";
import { defaultRelayHttpUrl, defaultRelayWsUrl } from "../lib/appConfig";
import { formatCodexModel, formatSessionPersistence } from "../lib/appFormatters";
import { roomSecretStorageLabel } from "../lib/appRuntime";
import { defaultProjectPath } from "../lib/localBackend";
import { approvalPolicyLabels } from "../seedData";
import { AppSidebarDrawer } from "../components/AppSidebarDrawer";
import { DesktopSidebar } from "../components/DesktopSidebar";

type DesktopSidebarProps = ComponentProps<typeof DesktopSidebar>;
type AppSidebarDrawerProps = ComponentProps<typeof AppSidebarDrawer>;
type RoomSource = {
  id: string;
  teamId: string;
};

export function useAppSidebarProps({
  currentUser,
  authBusy,
  authConfig,
  authError,
  deviceFlow,
  sidebarQuery,
  searchActive,
  workspaceError,
  newTeamName,
  newRoomName,
  newRoomProjectPath,
  selectedTeam,
  teams,
  rooms,
  messageHits,
  historySearchBusy,
  activeSidebarPanel,
  themeMode,
  localUserName,
  selectedRoomName,
  deviceId,
  deviceIdentity,
  deviceIdentityMessage,
  relayStatus,
  relayWsUrl,
  relayHttpUrl,
  codexProbe,
  projectPath,
  selectedCodexModel,
  selectedRoomApprovalPolicy,
  roomPosture,
  hasSelectedRoom,
  isSelectedRoomLocked,
  settingsBusy,
  isActiveHost,
  relayHttpDraft,
  relayWsDraft,
  roomSettingsGateMessage,
  notificationsMuted,
  historySettings,
  teamHistorySettings,
  teamDefaultApprovalPolicy,
  teamDefaultCodexModel,
  teamDefaultBrowserProfilePersistent,
  teamDefaultInviteApprovalGate,
  settingsMessage,
  onSignIn,
  onSignOut,
  onSidebarQueryChange,
  onNewTeamNameChange,
  onCreateTeam,
  onSelectTeam,
  onNewRoomNameChange,
  onNewRoomProjectPathChange,
  onChooseNewRoomProjectPath,
  onCreateRoom,
  onSelectRoom,
  onSetTeamLifecycle,
  onSetRoomLifecycle,
  onSelectSidebarPanel,
  onToggleTheme,
  onRotateDeviceIdentity,
  onChooseProject,
  onRelayHttpDraftChange,
  onRelayWsDraftChange,
  onResetRelay,
  onSaveRelay,
  onNotificationsMutedChange,
  onHistorySettingsChange,
  onClearRoomHistory,
  onForgetRoomLocalData,
  onTeamHistoryDefaultsChange,
  onTeamDefaultApprovalPolicyChange,
  onTeamDefaultCodexModelChange,
  onTeamDefaultBrowserProfilePersistentChange,
  onTeamDefaultInviteApprovalGateChange,
  onApplyTeamDefaultsToRoom,
  roomSources
}: {
  currentUser: DesktopSidebarProps["currentUser"];
  authBusy: DesktopSidebarProps["authBusy"];
  authConfig: DesktopSidebarProps["authConfig"];
  authError: DesktopSidebarProps["authError"];
  deviceFlow: DesktopSidebarProps["deviceFlow"];
  sidebarQuery: DesktopSidebarProps["sidebarQuery"];
  searchActive: DesktopSidebarProps["searchActive"];
  workspaceError: DesktopSidebarProps["workspaceError"];
  newTeamName: DesktopSidebarProps["newTeamName"];
  newRoomName: DesktopSidebarProps["newRoomName"];
  newRoomProjectPath: DesktopSidebarProps["newRoomProjectPath"];
  selectedTeam: boolean;
  teams: DesktopSidebarProps["teams"];
  rooms: DesktopSidebarProps["rooms"];
  messageHits: DesktopSidebarProps["messageHits"];
  historySearchBusy: DesktopSidebarProps["historySearchBusy"];
  activeSidebarPanel: AppSidebarDrawerProps["activePanel"];
  themeMode: DesktopSidebarProps["themeMode"];
  localUserName: string;
  selectedRoomName: string;
  deviceId: AppSidebarDrawerProps["profile"]["deviceId"];
  deviceIdentity: AppSidebarDrawerProps["profile"]["deviceIdentity"];
  deviceIdentityMessage: AppSidebarDrawerProps["profile"]["deviceIdentityMessage"];
  relayStatus: string;
  relayWsUrl: string;
  relayHttpUrl: string;
  codexProbe: {
    available: boolean;
    version?: string | null;
    error?: string | null;
  } | null;
  projectPath: string;
  selectedCodexModel: string;
  selectedRoomApprovalPolicy: keyof typeof approvalPolicyLabels;
  roomPosture: AppSidebarDrawerProps["settings"]["posture"];
  hasSelectedRoom: boolean;
  isSelectedRoomLocked: boolean;
  settingsBusy: boolean;
  isActiveHost: boolean;
  relayHttpDraft: string;
  relayWsDraft: string;
  roomSettingsGateMessage: string;
  notificationsMuted: boolean;
  historySettings: AppSidebarDrawerProps["settings"]["historySettings"];
  teamHistorySettings: AppSidebarDrawerProps["settings"]["teamHistorySettings"];
  teamDefaultApprovalPolicy: AppSidebarDrawerProps["settings"]["teamDefaultApprovalPolicy"];
  teamDefaultCodexModel: string;
  teamDefaultBrowserProfilePersistent: boolean;
  teamDefaultInviteApprovalGate: boolean;
  settingsMessage: string | null;
  onSignIn: DesktopSidebarProps["onSignIn"];
  onSignOut: DesktopSidebarProps["onSignOut"];
  onSidebarQueryChange: DesktopSidebarProps["onSidebarQueryChange"];
  onNewTeamNameChange: DesktopSidebarProps["onNewTeamNameChange"];
  onCreateTeam: DesktopSidebarProps["onCreateTeam"];
  onSelectTeam: (teamId: string) => void;
  onNewRoomNameChange: DesktopSidebarProps["onNewRoomNameChange"];
  onNewRoomProjectPathChange: DesktopSidebarProps["onNewRoomProjectPathChange"];
  onChooseNewRoomProjectPath: DesktopSidebarProps["onChooseNewRoomProjectPath"];
  onCreateRoom: DesktopSidebarProps["onCreateRoom"];
  onSelectRoom: (roomId: string, teamId?: string) => void;
  onSetTeamLifecycle: DesktopSidebarProps["onSetTeamLifecycle"];
  onSetRoomLifecycle: DesktopSidebarProps["onSetRoomLifecycle"];
  onSelectSidebarPanel: DesktopSidebarProps["onSelectSidebarPanel"];
  onToggleTheme: DesktopSidebarProps["onToggleTheme"];
  onRotateDeviceIdentity: AppSidebarDrawerProps["profile"]["onRotateDeviceIdentity"];
  onChooseProject: AppSidebarDrawerProps["settings"]["onChooseProject"];
  onRelayHttpDraftChange: AppSidebarDrawerProps["settings"]["onRelayHttpDraftChange"];
  onRelayWsDraftChange: AppSidebarDrawerProps["settings"]["onRelayWsDraftChange"];
  onResetRelay: AppSidebarDrawerProps["settings"]["onResetRelay"];
  onSaveRelay: AppSidebarDrawerProps["settings"]["onSaveRelay"];
  onNotificationsMutedChange: AppSidebarDrawerProps["settings"]["onNotificationsMutedChange"];
  onHistorySettingsChange: (settings: AppSidebarDrawerProps["settings"]["historySettings"]) => void;
  onClearRoomHistory: AppSidebarDrawerProps["settings"]["onClearRoomHistory"];
  onForgetRoomLocalData: AppSidebarDrawerProps["settings"]["onForgetRoomLocalData"];
  onTeamHistoryDefaultsChange: (settings: AppSidebarDrawerProps["settings"]["teamHistorySettings"]) => void;
  onTeamDefaultApprovalPolicyChange: AppSidebarDrawerProps["settings"]["onTeamDefaultApprovalPolicyChange"];
  onTeamDefaultCodexModelChange: AppSidebarDrawerProps["settings"]["onTeamDefaultCodexModelChange"];
  onTeamDefaultBrowserProfilePersistentChange: AppSidebarDrawerProps["settings"]["onTeamDefaultBrowserProfilePersistentChange"];
  onTeamDefaultInviteApprovalGateChange: AppSidebarDrawerProps["settings"]["onTeamDefaultInviteApprovalGateChange"];
  onApplyTeamDefaultsToRoom: AppSidebarDrawerProps["settings"]["onApplyTeamDefaultsToRoom"];
  roomSources: RoomSource[];
}) {
  const sidebarProps: DesktopSidebarProps = {
    currentUser,
    authBusy,
    authConfig,
    authError,
    deviceFlow,
    sidebarQuery,
    searchActive,
    workspaceError,
    newTeamName,
    newRoomName,
    newRoomProjectPath,
    defaultProjectPath,
    selectedTeam,
    teams,
    rooms,
    messageHits,
    historySearchBusy,
    activeSidebarPanel,
    themeMode,
    onSignIn,
    onSignOut,
    onSidebarQueryChange,
    onClearSidebarQuery: () => onSidebarQueryChange(""),
    onNewTeamNameChange,
    onCreateTeam,
    onSelectTeam: (teamId) => {
      onSelectTeam(teamId);
      onSelectRoom(roomSources.find((room) => room.teamId === teamId)?.id ?? roomSources[0]?.id ?? "");
    },
    onNewRoomNameChange,
    onNewRoomProjectPathChange,
    onChooseNewRoomProjectPath,
    onCreateRoom,
    onSelectRoom: (roomId, teamId) => {
      if (teamId) onSelectTeam(teamId);
      onSelectRoom(roomId);
    },
    onSetTeamLifecycle,
    onSetRoomLifecycle,
    onSelectSidebarPanel,
    onToggleTheme
  };

  const drawerProps: AppSidebarDrawerProps = {
    activePanel: activeSidebarPanel,
    profileTitle: localUserName,
    settingsTitle: selectedRoomName,
    profile: {
      currentUser,
      authConfig,
      authBusy,
      authError,
      deviceFlow,
      deviceId,
      deviceIdentity,
      deviceIdentityMessage,
      relaySessionPersistence: formatSessionPersistence(authConfig?.sessionPersistence),
      onRotateDeviceIdentity,
      onSignIn,
      onSignOut
    },
    settings: {
      relaySummary: `${relayStatus} · ${relayWsUrl}`,
      relayApi: relayHttpUrl,
      codexSummary: codexProbe?.available ? codexProbe.version ?? "Available" : codexProbe?.error ?? "Not connected",
      projectPath,
      modelLabel: formatCodexModel(selectedCodexModel),
      approvalLabel: approvalPolicyLabels[selectedRoomApprovalPolicy],
      roomKeysLabel: roomSecretStorageLabel(),
      posture: roomPosture,
      chooseProjectDisabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
      relayHttpDraft,
      relayWsDraft,
      defaultRelayHttpUrl,
      defaultRelayWsUrl,
      saveRelayDisabled: !relayHttpDraft.trim() || !relayWsDraft.trim(),
      showRoomSettingsGate: !isActiveHost && hasSelectedRoom,
      roomSettingsGateMessage,
      notificationsMuted,
      historySettings,
      teamHistorySettings,
      hasSelectedRoom,
      selectedTeam,
      settingsBusy,
      teamDefaultApprovalPolicy,
      approvalPolicyLabels,
      teamDefaultCodexModel,
      defaultCodexModel,
      codexModelOptions,
      teamDefaultBrowserProfilePersistent,
      teamDefaultInviteApprovalGate,
      message: settingsMessage,
      onChooseProject,
      onRelayHttpDraftChange,
      onRelayWsDraftChange,
      onResetRelay,
      onSaveRelay,
      onNotificationsMutedChange,
      onHistoryEnabledChange: (enabled) =>
        onHistorySettingsChange({
          ...historySettings,
          enabled
        }),
      onHistoryRetentionDaysChange: (retentionDays) =>
        onHistorySettingsChange({
          ...historySettings,
          retentionDays
        }),
      onClearRoomHistory,
      onForgetRoomLocalData,
      onTeamHistoryEnabledChange: (enabled) =>
        onTeamHistoryDefaultsChange({
          ...teamHistorySettings,
          enabled
        }),
      onTeamHistoryRetentionDaysChange: (retentionDays) =>
        onTeamHistoryDefaultsChange({
          ...teamHistorySettings,
          retentionDays
        }),
      onTeamDefaultApprovalPolicyChange,
      onTeamDefaultCodexModelChange,
      onTeamDefaultBrowserProfilePersistentChange,
      onTeamDefaultInviteApprovalGateChange,
      onApplyTeamDefaultsToRoom
    },
    onClose: () => onSelectSidebarPanel(null)
  };

  return { sidebarProps, drawerProps };
}
