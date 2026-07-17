import React from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defaultCodexModel } from "@multaiplayer/protocol";
import { defaultProjectPath, type CodexActivityEvent } from "./lib/platform/localBackend";
import { isTauriRuntime } from "./lib/platform/localBackend/runtime";
import { registerRoomNotificationClickFocus } from "./lib/room/roomNotifications";
import { reportNonFatal } from "./lib/core/nonFatalReporting";
import { createWorkspaceRecordActions } from "./application/workspace/workspaceRecordActions";
import { flushEncryptedHistorySaves, forgetRoomLocalData } from "./lib/history/localHistory";
import { installLocalHistoryCloseDrain } from "./lib/history/localHistoryCloseDrain";
import { prepareCurrentEligibleHistorySnapshots } from "./application/history/localHistorySnapshot";
import { useAppStore } from "./store/appStore";
import { useGitHubAuth } from "./hooks/useGitHubAuth";
import { useLocalIdentity } from "./hooks/useLocalIdentity";
import { useRoomChatMutations } from "./hooks/useRoomChatMutations";
import { useAppRoomInteractionContext } from "./hooks/useAppRoomInteractionContext";
import { createAppRoomActions } from "./hooks/appRoomActions";
import { useAppSelectedRoomRuntime } from "./hooks/useAppSelectedRoomRuntime";
import { useAppHostHandoffActions } from "./hooks/useAppHostHandoffActions";
import { useAppInviteActions } from "./hooks/useAppInviteActions";
import { useAppRefs } from "./hooks/useAppRefs";
import { useAppSelectedRoomContext } from "./hooks/useAppSelectedRoomContext";
import { useAppWorkspaceFlow } from "./hooks/useAppWorkspaceFlow";
import { useAppRelaySync } from "./hooks/useAppRelaySync";
import { useAppRoomRuntime } from "./hooks/useAppRoomRuntime";
import { createAppRoomPanelActions } from "./hooks/appRoomPanelActions";
import { AppShellView } from "./components/AppShellView";
import { CodexServerRequestDialog } from "./components/CodexServerRequestDialog";
import { defaultBrowserReason, defaultBrowserUrl, maxTerminalActivityLines } from "./appDefaults";
import { NativeAppRequired } from "./components/NativeAppRequired";
import { CodexAccountProvider } from "./hooks/useCodexAccount";
import { OnboardingAssistant } from "./components/OnboardingAssistant";
import { useOnboardingFlow } from "./hooks/useOnboardingFlow";
import { useNativeInviteIntake } from "./hooks/useNativeInviteIntake";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

export function App() {
  if (!isTauriRuntime()) return <NativeAppRequired />;
  return (
    <AppErrorBoundary>
      <CodexAccountProvider>
        <NativeApp />
      </CodexAccountProvider>
    </AppErrorBoundary>
  );
}

function NativeApp() {
  React.useEffect(() => useAppStore.getState().loadDeviceFingerprintComparisonsOnce(), []);
  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("local-preview://shutdown-blocked", (event) => {
      useAppStore.getState().setWorkspaceStatusError(event.payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        reportNonFatal("install local-preview shutdown listener", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void installLocalHistoryCloseDrain({
      appWindow: getCurrentWindow(),
      prepare: () => prepareCurrentEligibleHistorySnapshots(useAppStore.getState()),
      flush: () => flushEncryptedHistorySaves(),
      reportFailure: (message) => useAppStore.getState().setWorkspaceStatusError(message)
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        reportNonFatal("install encrypted local-history close drain", error);
        useAppStore
          .getState()
          .setWorkspaceStatusError(
            "The app could not install its local-history shutdown safeguard. Restart before editing."
          );
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const relayHttpUrl = useAppStore((state) => state.appConfig.relayHttpUrl);
  const selectedRoomId = useAppStore((state) => state.selectedRoomId);
  const appRefs = useAppRefs();
  React.useEffect(
    () =>
      registerRoomNotificationClickFocus({
        roomsRef: appRefs.roomsRef,
        selectWorkspaceRoom: (teamId, roomId) => useAppStore.getState().selectWorkspaceRoom(teamId, roomId)
      }),
    [appRefs.roomsRef]
  );
  const githubAuth = useGitHubAuth(relayHttpUrl);
  const localIdentity = useLocalIdentity(githubAuth.currentUser);
  const roomSettingsActor = () => ({
    requesterName: localIdentity.localUser.name,
    requesterUserId: localIdentity.localUser.id
  });

  const selectedContext = useAppSelectedRoomContext({
    githubAuth,
    localIdentity,
    defaultBrowserUrl,
    defaultBrowserReason
  });
  const roomActions = createAppRoomActions({
    appRefs,
    maxTerminalActivityLines,
    defaultBrowserUrl,
    defaultBrowserReason,
    defaultCodexModel,
    defaultProjectPath
  });
  const {
    setHostMessageForRoom,
    setChatMessageForRoom,
    resetCodexApprovalForRoom,
    setInviteLinkForRoom,
    setInviteMessageForRoom
  } = roomActions;
  const roomChatMutations = useRoomChatMutations();
  const workspaceRecords = createWorkspaceRecordActions({
    upsertTeamRecord: (team) => useAppStore.getState().upsertTeamRecord(team),
    upsertRoomRecord: (room) => useAppStore.getState().upsertRoomRecord(room),
    replaceRoomRecord: (room) => useAppStore.getState().replaceRoomRecord(room),
    resetCodexApprovalForRoom,
    revokeWorkspaceAccess: (teamId, roomId) => useAppStore.getState().revokeWorkspaceAccess(teamId, roomId),
    forgetRevokedRoomLocalData: forgetRoomLocalData,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setChatMessageForRoom,
    setHostMessageForRoom,
    setWorkspaceStatusError: (message) => useAppStore.getState().setWorkspaceStatusError(message)
  });
  const roomInteraction = useAppRoomInteractionContext({
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    roomActions
  });
  const selectedRuntime = useAppSelectedRoomRuntime({
    localIdentity,
    selected: selectedContext,
    roomInteraction
  });
  const hostHandoffActions = useAppHostHandoffActions({
    appRefs,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    workspaceRecords,
    roomSettingsActor
  });
  const inviteActions = useAppInviteActions({
    appRefs,
    roomInteraction,
    workspaceRecords
  });

  const workspaceFlow = useAppWorkspaceFlow({
    appRefs,
    identityResolved: githubAuth.identityResolved,
    authenticatedUserId: githubAuth.currentUser?.id ?? null,
    localIdentity,
    selected: selectedContext,
    roomInteraction,
    roomActions,
    workspaceRecords,
    inviteActions,
    roomSettingsActor
  });
  const nativeInvite = useNativeInviteIntake();
  const onboarding = useOnboardingFlow({ githubAuth, workspaceFlow, inviteActions, nativeInvite });

  const relaySync = useAppRelaySync({
    appRefs,
    localIdentity,
    selected: selectedContext,
    roomActions,
    workspaceRecords,
    inviteActions,
    roomChatMutations
  });
  const publishCodexActivityRef = React.useRef(relaySync.publishCodexActivity);
  publishCodexActivityRef.current = relaySync.publishCodexActivity;
  React.useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<CodexActivityEvent>("codex://activity", (event) => {
      const { roomId, ...activity } = event.payload;
      const room = appRefs.roomsRef.current.find((candidate) => candidate.id === roomId);
      if (!room) return;
      void publishCodexActivityRef.current(activity, room).catch((error) => {
        reportNonFatal("publish encrypted Codex activity", error);
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appRefs.roomsRef]);
  const roomRuntime = useAppRoomRuntime({
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    relaySync,
    hostHandoffActions,
    workspaceRecords,
    maxTerminalActivityLines,
    defaultBrowserUrl,
    defaultBrowserReason
  });

  const roomPanels = createAppRoomPanelActions({
    roomInteraction,
    roomRuntime,
    relaySync,
    workspaceFlow
  });
  const updateProjectPathWithOnboarding = async () => {
    const roomId = useAppStore.getState().selectedRoomId;
    const before = useAppStore.getState().rooms.find((room) => room.id === roomId);
    await roomRuntime.updateProjectPath();
    const state = useAppStore.getState();
    const after = state.rooms.find((room) => room.id === roomId);
    if (
      before &&
      after &&
      before.projectPath !== after.projectPath &&
      state.selectedRoomId === roomId &&
      state.onboarding.markers.membership?.roomId === after.id
    ) {
      state.applyOnboardingEvent({ type: "project_attached", roomId: after.id });
    }
  };

  if (onboarding.blockingAssistant) {
    return (
      <OnboardingAssistant
        state={onboarding.state}
        readiness={onboarding.readiness}
        joinState={onboarding.joinState}
        busy={onboarding.busy}
        message={onboarding.message}
        initialProjectPath={onboarding.selectedProjectPath}
        githubAuthentication={onboarding.githubAuthentication}
        codexAuthentication={onboarding.codexAuthentication}
        supportsCodexDeviceLogin={onboarding.supportsCodexDeviceLogin}
        receivedInvite={onboarding.receivedInvite}
        onChooseIntent={onboarding.onChooseIntent}
        onExplore={onboarding.onExplore}
        onShowSurface={onboarding.onShowSurface}
        onReadinessAction={onboarding.onReadinessAction}
        onStartCodexDeviceLogin={onboarding.onStartCodexDeviceLogin}
        onCancelGitHubAuthentication={onboarding.onCancelGitHubAuthentication}
        onCancelCodexAuthentication={onboarding.onCancelCodexAuthentication}
        onSubmitCreate={onboarding.onSubmitCreate}
        onRetryRoomCreation={onboarding.onRetryRoomCreation}
        onSubmitJoin={onboarding.onSubmitJoin}
        onSubmitReceivedInvite={onboarding.onSubmitReceivedInvite}
        onChooseProjectFolder={onboarding.onChooseProjectFolder}
        onContinueSafety={onboarding.onContinueSafety}
        onDismiss={onboarding.onDismiss}
      />
    );
  }

  return (
    <>
      <AppShellView
        sidebarSources={{
          githubAuth,
          roomRuntime,
          workspaceFlow
        }}
        roomMainColumnSources={{
          roomRuntime,
          workspaceFlow,
          hostHandoff: hostHandoffActions,
          chatActions: roomPanels.roomChatPanelActions
        }}
        roomInspectorSources={{
          roomRuntime: { ...roomRuntime, updateProjectPath: updateProjectPathWithOnboarding },
          workspaceFlow,
          hostHandoff: hostHandoffActions,
          inviteActions,
          roomPanels
        }}
        localPreviewDialogActions={{
          prepareLocalPreviewConfirmation: roomRuntime.prepareLocalPreviewConfirmation,
          confirmLocalPreviewShare: roomRuntime.confirmLocalPreviewShare
        }}
      />
      <CodexServerRequestDialog
        selectedRoomId={selectedRoomId}
        canRespond={roomInteraction.isActiveHost && !roomInteraction.isSelectedRoomLocked}
      />
    </>
  );
}
