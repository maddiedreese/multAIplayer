/**
 * Store state ownership used by the architecture lint rule.
 *
 * Keep this registry beside the store so adding a top-level state field and
 * declaring its owning slice happen in the same part of the tree.
 */
export const zustandStateOwners = {
  relayHttpDraft: "appConfigSlice",
  relayWsDraft: "appConfigSlice",
  browserByRoom: "browserSlice",
  chatDeletesByRoom: "workspaceDataSlice",
  chatEditsByRoom: "workspaceDataSlice",
  codexRuntimeByRoom: "codexHostHandoffSlice",
  filePanelByRoom: "filePanelSlice",
  gitWorkflowRuntimeByRoom: "gitWorkflowSlice",
  historyPresenceByRoom: "historyPresenceSlice",
  teamHistoryByTeam: "historyPresenceSlice",
  inviteByRoom: "inviteSlice",
  localPreviewByRoom: "localPreviewSlice",
  localPreviewDialog: "localPreviewSlice",
  messagesByRoom: "workspaceDataSlice",
  onboarding: "onboardingSlice",
  roomChatByRoom: "roomChatSlice",
  roomSettingsByRoom: "roomSettingsSlice",
  sensitiveAttachmentReviewKey: "roomChatSlice",
  teamRosterByTeam: "workspaceDataSlice",
  terminalRuntimeByRoom: "terminalSlice",
  terminals: "terminalSlice",
  trustedDeviceKeys: "appRuntimeSlice",
  trustedDeviceKeysLoaded: "appRuntimeSlice",
  forgottenRoomIds: "relayRuntimeSlice",
  revokedRoomIds: "relayRuntimeSlice",
  revokedTeamIds: "relayRuntimeSlice",
  inspectorCollapsed: "shellSlice",
  sidebarCollapsed: "shellSlice",
  themeMode: "shellSlice",
  rooms: "workspaceUiSlice",
  selectedRoomId: "workspaceUiSlice",
  selectedTeam: "workspaceUiSlice",
  teams: "workspaceUiSlice",
  workspaceBootstrapAttempt: "workspaceUiSlice",
  workspaceBootstrapError: "workspaceUiSlice",
  workspaceBootstrapStatus: "workspaceUiSlice",
  workspaceUiInitialized: "workspaceUiSlice"
};

export const allowedZustandDependencies = {
  roomLifecycleSlice: new Set([
    "browserSlice",
    "codexHostHandoffSlice",
    "filePanelSlice",
    "gitWorkflowSlice",
    "historyPresenceSlice",
    "inviteSlice",
    "localPreviewSlice",
    "roomChatSlice",
    "roomSettingsSlice",
    "terminalSlice",
    "workspaceDataSlice"
  ]),
  workspaceDataSlice: new Set(["codexHostHandoffSlice"])
};
