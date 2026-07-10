import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRoomDisplayContext } from "./useAppRoomDisplayContext";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createAppRoomPanelActions } from "../lib/appRoomPanelActions";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useThemeMode } from "./useThemeMode";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";

export interface AppViewModelOptions {
  appState: ReturnType<typeof useAppStateSlices>;
  githubAuth: ReturnType<typeof useGitHubAuth>;
  localIdentity: ReturnType<typeof useLocalIdentity>;
  theme: ReturnType<typeof useThemeMode>;
  selected: ReturnType<typeof useAppSelectedRoomContext>;
  selectedRuntime: ReturnType<typeof useAppSelectedRoomRuntime>;
  roomInteraction: ReturnType<typeof useAppRoomInteractionContext>;
  roomActions: ReturnType<typeof createAppRoomActions>;
  roomDisplay: ReturnType<typeof useAppRoomDisplayContext>;
  roomPanels: ReturnType<typeof createAppRoomPanelActions>;
  roomRuntime: ReturnType<typeof useRoomRuntimeContext>;
  workspaceFlow: ReturnType<typeof useWorkspaceFlowContext>;
  hostHandoffActions: ReturnType<typeof useAppHostHandoffActions>;
  inviteActions: ReturnType<typeof useAppInviteActions>;
}
