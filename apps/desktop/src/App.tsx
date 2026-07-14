import React from "react";
import { listen } from "@tauri-apps/api/event";
import { defaultCodexModel } from "@multaiplayer/protocol";
import { defaultProjectPath, type CodexActivityEvent } from "./lib/localBackend";
import { isTauriRuntime } from "./lib/localBackend/runtime";
import { registerRoomNotificationClickFocus } from "./lib/roomNotifications";
import { createWorkspaceRecordActions } from "./lib/workspaceRecordActions";
import { useAppStore } from "./store/appStore";
import { useGitHubAuth } from "./hooks/useGitHubAuth";
import { useLocalIdentity } from "./hooks/useLocalIdentity";
import { useRoomChatMutations } from "./hooks/useRoomChatMutations";
import { useAppRoomInteractionContext } from "./hooks/useAppRoomInteractionContext";
import { createAppRoomActions } from "./lib/appRoomActions";
import { useAppSelectedRoomRuntime } from "./hooks/useAppSelectedRoomRuntime";
import { useAppHostHandoffActions } from "./hooks/useAppHostHandoffActions";
import { useAppInviteActions } from "./hooks/useAppInviteActions";
import { useRoomSettingsActor } from "./hooks/useRoomSettingsActor";
import { useAppRefs } from "./hooks/useAppRefs";
import { useAppSelectedRoomContext } from "./hooks/useAppSelectedRoomContext";
import { useAppWorkspaceFlow } from "./hooks/useAppWorkspaceFlow";
import { useAppRelaySync } from "./hooks/useAppRelaySync";
import { useAppRoomRuntime } from "./hooks/useAppRoomRuntime";
import { createAppRoomPanelActions } from "./lib/appRoomPanelActions";
import { AppShellView } from "./components/AppShellView";
import { CodexServerRequestDialog } from "./components/CodexServerRequestDialog";
import { defaultBrowserReason, defaultBrowserUrl, emptyRoom, maxTerminalActivityLines } from "./appDefaults";
import { WebPreviewDemo } from "./components/WebPreviewDemo";

export function App() {
  if (!isTauriRuntime()) return <WebPreviewDemo />;
  return <NativeApp />;
}

function NativeApp() {
  React.useEffect(() => useAppStore.getState().loadTrustedDeviceKeysOnce(), []);
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
  const roomSettingsActor = useRoomSettingsActor(localIdentity.localUser);

  const selectedContext = useAppSelectedRoomContext({
    githubAuth,
    localIdentity,
    fallbackRoom: emptyRoom,
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
    localIdentity,
    selected: selectedContext,
    roomInteraction,
    roomActions,
    workspaceRecords,
    inviteActions,
    roomSettingsActor
  });

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
      void publishCodexActivityRef.current(activity, room).catch(() => {
        console.warn("Failed to publish encrypted Codex activity");
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
          roomRuntime,
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
