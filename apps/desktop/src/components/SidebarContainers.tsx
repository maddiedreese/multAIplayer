import React, { useMemo } from "react";
import { codexModelOptions, defaultCodexModel, type ClientRoomRecord } from "@multaiplayer/protocol";
import { AppSidebarDrawer } from "./AppSidebarDrawer";
import { DesktopSidebar } from "./DesktopSidebar";
import { SetupChecklist } from "./SetupChecklist";
import { RoomArchivePanel } from "./RoomArchivePanel";
import { allowRelayConfiguration, defaultRelayHttpUrl, defaultRelayWsUrl } from "../lib/core/appConfig";
import { formatCodexModel, formatSessionPersistence } from "../lib/formatting/appFormatters";
import { formatCodexCompatibilitySummary } from "../lib/codex/codexCompatibility";
import { defaultProjectPath } from "../lib/platform/localBackend";
import { mlsStateStorageLabel } from "../application/runtime/appRuntime";
import { hideUnreadForLockedRooms } from "../lib/history/roomUnread";
import { useLocalIdentity } from "../hooks/useLocalIdentity";
import { useRoomAccess } from "../hooks/useRoomAccess";
import { useSidebarNavigation } from "../hooks/useSidebarNavigation";
import { approvalPolicyLabels } from "../appDefaults";
import { useAppStore } from "../store/appStore";
import { projectBrowserRequestsByRoom } from "../store/slices/browserSlice";
import { projectCodexRuntimeMaps } from "../store/slices/codexHostHandoffSlice";
import { projectHistorySearchMessagesByRoom } from "../store/slices/historyPresenceSlice";
import { projectTerminalRuntimeRequestsByRoom } from "../store/slices/terminalSlice";
import { deriveOnboardingProgress, onboardingRestartEvent } from "../lib/onboarding/onboardingState";
import type { useGitHubAuth } from "../hooks/useGitHubAuth";
import type { useRoomRuntimeContext } from "../hooks/useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "../hooks/useWorkspaceFlowContext";

function sidebarRoomDisplay(room: ClientRoomRecord | null) {
  if (!room) {
    return {
      id: "",
      name: "No room selected",
      projectPath: "",
      codexModel: defaultCodexModel,
      approvalLabel: "No room selected"
    };
  }
  return {
    id: room.id,
    name: room.name,
    projectPath: room.projectPath,
    codexModel: room.codexModel ?? defaultCodexModel,
    approvalLabel: approvalPolicyLabels[room.approvalPolicy]
  };
}

export interface SidebarSources {
  githubAuth: Pick<ReturnType<typeof useGitHubAuth>, "beginGitHubSignIn" | "clearDeletedHostedAccount">;
  roomRuntime: Pick<ReturnType<typeof useRoomRuntimeContext>, "signOut" | "chooseProjectPath">;
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
  const currentUser = useAppStore((state) => state.currentUser);
  const authBusy = useAppStore((state) => state.authBusy);
  const authConfig = useAppStore((state) => state.authConfig);
  const authError = useAppStore((state) => state.authError);
  const deviceFlow = useAppStore((state) => state.deviceFlow);
  const sidebarQuery = useAppStore((state) => state.sidebarQuery);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const newTeamName = useAppStore((state) => state.newTeamName);
  const newRoomName = useAppStore((state) => state.newRoomName);
  const newRoomProjectPath = useAppStore((state) => state.newRoomProjectPath);
  const selectedTeam = useAppStore((state) => state.selectedTeam);
  const selectedRoomId = useAppStore((state) => state.selectedRoomId);
  const teams = useAppStore((state) => state.teams);
  const rooms = useAppStore((state) => state.rooms);
  const messagesByRoom = useAppStore((state) => state.messagesByRoom);
  const historyPresenceByRoom = useAppStore((state) => state.historyPresenceByRoom);
  const codexRuntimeByRoom = useAppStore((state) => state.codexRuntimeByRoom);
  const terminalRuntimeByRoom = useAppStore((state) => state.terminalRuntimeByRoom);
  const browserByRoom = useAppStore((state) => state.browserByRoom);
  const forgottenRoomIds = useAppStore((state) => state.forgottenRoomIds);
  const revokedRoomIds = useAppStore((state) => state.revokedRoomIds);
  const revokedTeamIds = useAppStore((state) => state.revokedTeamIds);
  const historySearchBusy = useAppStore((state) => state.historySearchBusy);
  const activeSidebarPanel = useAppStore((state) => state.activeSidebarPanel);
  const {
    setSidebarQuery,
    setNewTeamName,
    setNewRoomName,
    setNewRoomProjectPath,
    selectTeamRoom,
    selectWorkspaceRoom,
    setSelectedRoomId,
    setActiveSidebarPanel
  } = useAppStore.getState();

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
  const browserRequestsByRoom = useMemo(() => projectBrowserRequestsByRoom(browserByRoom), [browserByRoom]);
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
  const onboarding = useAppStore((state) => state.onboarding);
  const applyOnboardingEvent = useAppStore((state) => state.applyOnboardingEvent);
  const onboardingProgress = useMemo(() => deriveOnboardingProgress(onboarding), [onboarding]);

  const continueSetup = () => {
    const setupRoom = onboarding.markers.membership;
    switch (onboardingProgress.nextStep) {
      case "connect_codex":
        applyOnboardingEvent({ type: "show_surface", surface: "readiness" });
        break;
      case "create_or_join_room":
        applyOnboardingEvent({ type: "show_surface", surface: "welcome" });
        break;
      case "attach_project":
        if (setupRoom) {
          selectWorkspaceRoom(setupRoom.teamId, setupRoom.roomId);
          useAppStore.getState().setInspectorTabForRoom(setupRoom.roomId, "files");
        }
        break;
      case "run_first_turn":
        applyOnboardingEvent({ type: "show_surface", surface: "guided_turn" });
        break;
      case "invite_teammate":
        if (setupRoom) {
          selectWorkspaceRoom(setupRoom.teamId, setupRoom.roomId);
          useAppStore.getState().setInspectorTabForRoom(setupRoom.roomId, "room");
        }
        break;
    }
  };

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
      setupChecklist={
        <SetupChecklist
          progress={onboardingProgress}
          teammateJoined={onboarding.markers.teammateJoined}
          teammateDeferred={onboarding.markers.teammateDeferred}
          onContinue={continueSetup}
          onDeferTeammate={() => {
            const teamId = onboarding.markers.membership?.teamId;
            if (teamId) applyOnboardingEvent({ type: "teammate_deferred", teamId });
          }}
          onDismiss={() => applyOnboardingEvent({ type: "dismiss_checklist" })}
        />
      }
      onSignIn={sources.githubAuth.beginGitHubSignIn}
      onSignOut={sources.roomRuntime.signOut}
      onSidebarQueryChange={setSidebarQuery}
      onClearSidebarQuery={() => setSidebarQuery("")}
      onNewTeamNameChange={setNewTeamName}
      onCreateTeam={sources.workspaceFlow.addTeam}
      onSelectTeam={(teamId) => selectTeamRoom(teamId, rooms[0]?.id ?? "")}
      onNewRoomNameChange={setNewRoomName}
      onNewRoomProjectPathChange={setNewRoomProjectPath}
      onChooseNewRoomProjectPath={sources.workspaceFlow.chooseNewRoomProjectPath}
      onCreateRoom={sources.workspaceFlow.addRoom}
      onSelectRoom={(roomId, teamId) => {
        if (teamId) selectWorkspaceRoom(teamId, roomId);
        else setSelectedRoomId(roomId);
      }}
      onSetTeamLifecycle={sources.workspaceFlow.setTeamLifecycle}
      onSetRoomLifecycle={sources.workspaceFlow.setRoomLifecycle}
      onSelectSidebarPanel={setActiveSidebarPanel}
    />
  );
}

export function AppSidebarDrawerContainer({ sources }: { sources: SidebarSources }) {
  const currentUser = useAppStore((state) => state.currentUser);
  const authBusy = useAppStore((state) => state.authBusy);
  const authConfig = useAppStore((state) => state.authConfig);
  const authError = useAppStore((state) => state.authError);
  const deviceFlow = useAppStore((state) => state.deviceFlow);
  const selectedTeam = useAppStore((state) => state.selectedTeam);
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId) ?? null);
  const hasSelectedRoom = selectedRoom != null;
  const activeSidebarPanel = useAppStore((state) => state.activeSidebarPanel);
  const appConfig = useAppStore((state) => state.appConfig);
  const relayHttpDraft = useAppStore((state) => state.relayHttpDraft);
  const relayWsDraft = useAppStore((state) => state.relayWsDraft);
  const appConfigMessage = useAppStore((state) => state.appConfigMessage);
  const relayStatus = useAppStore((state) => state.relayStatus);
  const codexProbe = useAppStore((state) => state.codexProbe);
  const deviceIdentity = useAppStore((state) => state.deviceIdentity);
  const deviceIdentityMessage = useAppStore((state) => state.deviceIdentityMessage);
  const forgottenRoomIds = useAppStore((state) => state.forgottenRoomIds);
  const revokedRoomIds = useAppStore((state) => state.revokedRoomIds);
  const revokedTeamIds = useAppStore((state) => state.revokedTeamIds);
  const roomSettings =
    useAppStore((state) => (state.selectedRoomId ? state.roomSettingsByRoom[state.selectedRoomId] : undefined)) ?? {};
  const inviteApprovalGate =
    useAppStore((state) =>
      state.selectedRoomId ? state.inviteByRoom[state.selectedRoomId]?.approvalGate : undefined
    ) ?? true;
  const historySettings = useAppStore((state) => state.historySettings);
  const teamHistorySettings = useAppStore((state) => state.teamHistorySettings);
  const teamDefaultApprovalPolicy = useAppStore((state) => state.teamDefaultApprovalPolicy);
  const teamDefaultCodexModel = useAppStore((state) => state.teamDefaultCodexModel);
  const teamDefaultInviteApprovalGate = useAppStore((state) => state.teamDefaultInviteApprovalGate);
  const historyMessage = useAppStore((state) =>
    state.selectedRoomId ? (state.historyPresenceByRoom[state.selectedRoomId]?.historyMessage ?? null) : null
  );
  const teamHistoryMessage = useAppStore(
    (state) => state.teamHistoryByTeam[state.selectedTeam || "__no-team"]?.message ?? null
  );
  const {
    setActiveSidebarPanel,
    setRelayHttpDraft,
    setRelayWsDraft,
    resetRelayConfiguration,
    saveRelayConfiguration,
    setRoomNotificationsMuted
  } = useAppStore.getState();
  const { deviceId, localUser } = useLocalIdentity(currentUser);
  const onboarding = useAppStore((state) => state.onboarding);
  const applyOnboardingEvent = useAppStore((state) => state.applyOnboardingEvent);
  const onboardingProgress = useMemo(() => deriveOnboardingProgress(onboarding), [onboarding]);
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
  const settingsMessage =
    [appConfigMessage, roomSettings.settingsMessage, historyMessage, teamHistoryMessage].find(
      (message): message is string => message != null
    ) ?? null;
  const roomDisplay = sidebarRoomDisplay(selectedRoom);

  return (
    <AppSidebarDrawer
      activePanel={activeSidebarPanel}
      profileTitle={localUser.name}
      settingsTitle={roomDisplay.name}
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
        archivePanel: (
          <RoomArchivePanel
            selectedRoomId={roomDisplay.id}
            selectedRoomName={roomDisplay.name}
            hasSelectedRoom={hasSelectedRoom}
          />
        ),
        onHostedAccountDeleted: sources.githubAuth.clearDeletedHostedAccount,
        onSignIn: sources.githubAuth.beginGitHubSignIn,
        onSignOut: sources.roomRuntime.signOut
      }}
      settings={{
        relaySummary: appConfig.relayWsUrl ? `${relayStatus} · ${appConfig.relayWsUrl}` : "Not configured",
        relayApi: appConfig.relayHttpUrl || "Not configured",
        codexSummary: codexProbe?.available
          ? formatCodexCompatibilitySummary(codexProbe.version)
          : (codexProbe?.error ?? "Not connected"),
        projectPath: roomDisplay.projectPath,
        modelLabel: formatCodexModel(roomDisplay.codexModel),
        approvalLabel: roomDisplay.approvalLabel,
        roomKeysLabel: mlsStateStorageLabel(),
        posture: access.roomPosture,
        chooseProjectDisabled:
          !hasSelectedRoom || access.isSelectedRoomLocked || Boolean(roomSettings.settingsBusy) || !access.isActiveHost,
        allowRelayConfiguration,
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
        teamDefaultInviteApprovalGate,
        message: settingsMessage,
        archivePanel: (
          <RoomArchivePanel
            selectedRoomId={roomDisplay.id}
            selectedRoomName={roomDisplay.name}
            hasSelectedRoom={hasSelectedRoom}
          />
        ),
        onChooseProject: sources.roomRuntime.chooseProjectPath,
        onRelayHttpDraftChange: setRelayHttpDraft,
        onRelayWsDraftChange: setRelayWsDraft,
        onResetRelay: resetRelayConfiguration,
        onSaveRelay: saveRelayConfiguration,
        onNotificationsMutedChange: (muted) => {
          if (selectedRoom) setRoomNotificationsMuted(selectedRoom.id, muted);
        },
        onHistoryEnabledChange: (enabled) =>
          sources.workspaceFlow.updateLocalHistorySettings({ ...historySettings, enabled }),
        onHistoryRetentionDaysChange: (retentionDays) =>
          sources.workspaceFlow.updateLocalHistorySettings({ ...historySettings, retentionDays }),
        onClearRoomHistory: sources.workspaceFlow.clearRoomHistory,
        onForgetRoomLocalData: sources.workspaceFlow.forgetSelectedRoomLocalData,
        onTeamHistoryEnabledChange: (enabled) =>
          sources.workspaceFlow.updateTeamHistoryDefaults({ ...teamHistorySettings, enabled }),
        onTeamHistoryRetentionDaysChange: (retentionDays) =>
          sources.workspaceFlow.updateTeamHistoryDefaults({ ...teamHistorySettings, retentionDays }),
        onTeamDefaultApprovalPolicyChange: sources.workspaceFlow.updateTeamDefaultApprovalPolicy,
        onTeamDefaultCodexModelChange: sources.workspaceFlow.updateTeamDefaultCodexModel,
        onTeamDefaultInviteApprovalGateChange: sources.workspaceFlow.updateTeamDefaultInviteApprovalGate,
        onApplyTeamDefaultsToRoom: sources.workspaceFlow.applyTeamDefaultsToRoom
      }}
      help={{
        completedSteps: onboardingProgress.completedSteps,
        totalSteps: onboardingProgress.totalSteps,
        onOpenSetupGuide: () => {
          setActiveSidebarPanel(null);
          applyOnboardingEvent({ type: "show_surface", surface: "welcome" });
        },
        onShowSetupChecklist: () => applyOnboardingEvent({ type: "reopen_checklist" }),
        onRestartSetupGuide: () => {
          const partialTeamId = onboarding.markers.workspaceCreatedTeamId;
          const prompt = partialTeamId
            ? "Return to first-room setup? The workspace already created on the relay will be reused."
            : "Restart the setup guide on this device? Your teams, rooms, and account sessions stay intact.";
          if (!window.confirm(prompt)) {
            return;
          }
          setActiveSidebarPanel(null);
          applyOnboardingEvent(onboardingRestartEvent(onboarding));
        }
      }}
      onClose={() => setActiveSidebarPanel(null)}
    />
  );
}
