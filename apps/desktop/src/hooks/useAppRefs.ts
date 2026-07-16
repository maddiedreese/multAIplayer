import { useEffect, useRef } from "react";
import type { RelayClient } from "../lib/relay/relayClient";
import { projectBrowserRequestsByRoom } from "../store/slices/browserSlice";
import { projectGitHubWorkflowPanelMaps } from "../store/slices/gitWorkflowSlice";
import { projectInvitePanelMaps } from "../store/slices/inviteSlice";
import { projectLocalPreviewPanelMaps } from "../store/slices/localPreviewSlice";
import { projectRoomSettingsPanelMaps } from "../store/slices/roomSettingsSlice";
import { projectTerminalRuntimeBusyByRoom } from "../store/slices/terminalSlice";
import { useAppStore, type AppStoreState } from "../store/appStore";

/**
 * Mutable bridges for imperative relay/native handlers. Store subscriptions update
 * these refs without subscribing App's render tree to every room-scoped map.
 */
export function useAppRefs() {
  const initial = useAppStore.getState();
  const relayRef = useRef<RelayClient | null>(null);
  const seenEnvelopeIds = useRef(new Set<string>());
  const roomsRef = useRef(initial.rooms);
  const selectedRoomIdRef = useRef(initial.selectedRoomId);
  const selectedTeamIdRef = useRef(initial.selectedTeam);
  const gitWorkflowDraftsRef = useRef(
    projectGitHubWorkflowPanelMaps(initial.gitWorkflowRuntimeByRoom).gitWorkflowDraftsByRoom
  );
  const hostBusyRef = useRef(projectRoomSettingsPanelMaps(initial.roomSettingsByRoom).hostBusyByRoom);
  const settingsBusyRef = useRef(projectRoomSettingsPanelMaps(initial.roomSettingsByRoom).settingsBusyByRoom);
  const membershipCommitBusyRef = useRef(projectInvitePanelMaps(initial.inviteByRoom).membershipCommitBusyByRoom);
  const gitWorkflowBusyRef = useRef(
    projectGitHubWorkflowPanelMaps(initial.gitWorkflowRuntimeByRoom).gitWorkflowBusyByRoom
  );
  const actionsBusyRef = useRef(projectGitHubWorkflowPanelMaps(initial.gitWorkflowRuntimeByRoom).actionsBusyByRoom);
  const terminalBusyRef = useRef(projectTerminalRuntimeBusyByRoom(initial.terminalRuntimeByRoom));
  const localPreviewBusyRef = useRef(projectLocalPreviewPanelMaps(initial.localPreviewByRoom).localPreviewBusyByRoom);
  const fileBusyRef = useRef(fileBusyByRoom(initial));
  const browserRequestsRef = useRef(projectBrowserRequestsByRoom(initial.browserByRoom));

  useEffect(() => {
    const syncRefs = (state: AppStoreState) => {
      const roomSettings = projectRoomSettingsPanelMaps(state.roomSettingsByRoom);
      const gitWorkflow = projectGitHubWorkflowPanelMaps(state.gitWorkflowRuntimeByRoom);
      roomsRef.current = state.rooms;
      selectedRoomIdRef.current = state.selectedRoomId;
      selectedTeamIdRef.current = state.selectedTeam;
      gitWorkflowDraftsRef.current = gitWorkflow.gitWorkflowDraftsByRoom;
      hostBusyRef.current = roomSettings.hostBusyByRoom;
      settingsBusyRef.current = roomSettings.settingsBusyByRoom;
      membershipCommitBusyRef.current = projectInvitePanelMaps(state.inviteByRoom).membershipCommitBusyByRoom;
      gitWorkflowBusyRef.current = gitWorkflow.gitWorkflowBusyByRoom;
      actionsBusyRef.current = gitWorkflow.actionsBusyByRoom;
      terminalBusyRef.current = projectTerminalRuntimeBusyByRoom(state.terminalRuntimeByRoom);
      localPreviewBusyRef.current = projectLocalPreviewPanelMaps(state.localPreviewByRoom).localPreviewBusyByRoom;
      fileBusyRef.current = fileBusyByRoom(state);
      browserRequestsRef.current = projectBrowserRequestsByRoom(state.browserByRoom);
    };
    // Initialization runs in a parent layout effect before this passive effect.
    syncRefs(useAppStore.getState());
    return useAppStore.subscribe(syncRefs);
  }, []);

  return {
    relayRef,
    seenEnvelopeIds,
    roomsRef,
    selectedRoomIdRef,
    selectedTeamIdRef,
    gitWorkflowDraftsRef,
    hostBusyRef,
    settingsBusyRef,
    membershipCommitBusyRef,
    gitWorkflowBusyRef,
    actionsBusyRef,
    terminalBusyRef,
    localPreviewBusyRef,
    fileBusyRef,
    browserRequestsRef
  };
}

function fileBusyByRoom(state: AppStoreState): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(state.filePanelByRoom)
      .filter(([, panel]) => panel.busy)
      .map(([roomId]) => [roomId, true])
  );
}
