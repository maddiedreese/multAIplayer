# Desktop hook index

Use this index to find the React lifecycle or composition point for a desktop behavior. Hooks are grouped by their primary responsibility; some compose hooks from other groups.

## Relay sync and encrypted routing

- `relay/useRelaySubscription.ts` subscribes to relay events and dispatches decrypted envelopes.
- `relay/routeRelayEnvelope.ts` routes decrypted envelope types into store actions (support code, not a hook).
- `useAppRelaySync.ts` composes application-level relay synchronization.
- `useRelayPublishers.ts` exposes encrypted relay publishers for room activity.
- `useRelayRoomSync.ts` synchronizes the active room with relay state.
- `useRelaySyncContext.ts` assembles the shared relay-sync inputs.

## Codex and host handoff

- `useCodexProbe.ts` tracks local Codex availability.
- `useCodexRoomActions.ts` composes Codex actions for one room.
- `useCodexTurnActions.ts` owns Codex turn invocation, queuing, approvals, and completion.
- `useAppHostHandoffActions.ts` adapts host-handoff actions to application state.
- `useHostHandoffActions.ts` owns room host-handoff behavior.

## GitHub and git workflows

- `useGitHubActionsDraftReset.ts` resets Actions draft state when its context changes.
- `useGitHubActionsRefresh.ts` refreshes GitHub Actions data.
- `useGitHubAuth.ts` owns GitHub authentication state and operations.
- `useGitHubRemoteInference.ts` infers GitHub remotes from the active project.
- `useGitHubWorkflowState.ts` derives GitHub workflow UI state.
- `useRoomGitStatusRefresh.ts` refreshes git status for a room.

## Room lifecycle and interaction

- `useAppInviteActions.ts` adapts invite actions to application state.
- `useAppRoomInteractionContext.ts` assembles app-level room interaction inputs.
- `useAppRoomRuntime.ts` composes the complete runtime for a room.
- `useAppSelectedContext.ts` resolves the app's selected team and room context.
- `useAppSelectedRoomContext.ts` assembles selected-room state and capabilities.
- `useAppSelectedRoomRuntime.ts` composes runtime values for the selected room.
- `useInviteActions.ts` owns create, accept, and approval invite flows.
- `useInviteUrlBootstrap.ts` handles an invite URL at application startup.
- `useRoomAccess.ts` derives room access and permission state.
- `useRoomBackgroundEffects.ts` runs room-scoped background effects.
- `useRoomChatMutations.ts` exposes room chat mutation actions.
- `useRoomDraftCleanup.ts` clears stale room drafts.
- `useRoomInFlightReporters.ts` reports room-scoped busy and error state.
- `useRoomInteractionContext.ts` assembles room interaction capabilities.
- `useRoomMemberRows.ts` derives room member rows for display.
- `useRoomRuntimeContext.ts` assembles room tool actions and background behavior.
- `useRoomSettingsActor.ts` identifies the local settings actor.
- `useRoomToolActions.ts` composes account, git, and other room tool actions.
- `useSelectedRoomContext.ts` derives the selected room context.
- `useSelectedRoomReadReceipt.ts` marks the selected room as read.
- `useSelectedRoomRuntime.ts` derives selected-room runtime and privilege state.
- `useSelectedRoomValues.ts` selects the values rendered for the active room.

## Workspace and team lifecycle

- `useAppWorkspaceFlow.ts` composes app-level workspace flows.
- `useInitializeWorkspaceUi.ts` seeds workspace UI state.
- `useSelectedTeamData.ts` derives data for the selected team.
- `useSelectedTeamDefaults.ts` applies defaults for the selected team.
- `useTeamMembersRefresh.ts` refreshes selected-team membership.
- `useWorkspaceBootstrap.ts` initializes workspace data and selection.
- `useWorkspaceFlowContext.ts` assembles workspace actions and effects.
- `useWorkspaceHistoryEffects.ts` runs workspace history hydration and persistence.

## Workspace UI, files, and navigation

- `useFileTerminalDisplay.ts` coordinates file and terminal display state.
- `useHistorySearch.ts` searches and filters local message history.
- `useLocalPreviewDialogProps.ts` assembles local preview dialog behavior.
- `useLocalPreviewPolling.ts` polls the active local preview.
- `useMarkdownSelection.ts` owns message selection for Markdown export.
- `useProjectFilesSearch.ts` searches files in the selected project.
- `useShellLayout.ts` derives application shell layout state.
- `useSidebarNavigation.ts` owns sidebar navigation and selection transitions.
- `useTerminalAutoOpen.ts` opens the terminal when room state requires it.
- `useTerminalLifecycle.ts` owns terminal creation and cleanup.
- `useThemeMode.ts` synchronizes the selected visual theme.
- `useUpdateNotice.ts` checks and exposes desktop update notices.

## Application bootstrap, identity, history, and utilities

- `useAppBootstrapEffects.ts` composes application startup effects.
- `useAppRefs.ts` owns stable refs shared by app-level composition.
- `useDeviceIdentityLifecycle.ts` loads and persists the device identity.
- `useInitializeAppState.ts` initializes application store state.
- `useLatestRef.ts` keeps the latest value in a stable ref.
- `useLocalHistoryHydration.ts` hydrates encrypted local history.
- `useLocalHistoryPersistence.ts` persists encrypted local history.
- `useLocalIdentity.ts` derives the current local identity.

## Boundaries for new hooks

A hook earns its own file only when it is reused or owns a real React lifecycle, such as a subscription, effect, or ref. Otherwise, inline it at its call site. New multi-file hook internals belong in a domain directory instead of adding more files to this root.

Only put code here when it needs React: subscriptions, effects, refs, or component-tree composition. Imperative action factories belong in `lib/` and should read Zustand actions from `useAppStore.getState()` at invocation time instead of accepting store setters as parameters. This keeps them usable from relay routing and directly testable without a renderer.

Components subscribe to the narrowest store value they render, ideally a per-room value such as `state.codexRuntimeByRoom[roomId]`. App-level code passes only effectful capabilities that cannot live in the store. Do not add selector bundles, view-model prop assemblers, callback-proxy layers, or compatibility re-export files; derived selectors belong beside their store slice.
