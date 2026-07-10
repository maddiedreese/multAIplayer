import { create } from "zustand";
import {
  createAppConfigSlice,
  emptyAppConfigState,
  loadAppConfigState,
  type AppConfigSlice
} from "./slices/appConfigSlice";
import { createAppRuntimeSlice, emptyAppRuntimeState, type AppRuntimeSlice } from "./slices/appRuntimeSlice";
import { createAuthSlice, emptyAuthState, type AuthSlice } from "./slices/authSlice";
import { createBrowserSlice, emptyBrowserState, type BrowserSlice } from "./slices/browserSlice";
import {
  createCodexHostHandoffSlice,
  emptyCodexHostHandoffState,
  type CodexHostHandoffSlice
} from "./slices/codexHostHandoffSlice";
import { createFilePanelSlice, emptyFilePanelState, type FilePanelSlice } from "./slices/filePanelSlice";
import {
  createGitWorkflowSlice,
  emptyGitWorkflowState,
  type GitWorkflowSlice
} from "./slices/gitWorkflowSlice";
import {
  createHistoryPresenceSlice,
  emptyHistoryPresenceState,
  type HistoryPresenceSlice
} from "./slices/historyPresenceSlice";
import {
  createHistoryDefaultsSlice,
  emptyHistoryDefaultsState,
  type HistoryDefaultsSlice
} from "./slices/historyDefaultsSlice";
import {
  createInviteSlice,
  emptyInviteState,
  type InviteSlice
} from "./slices/inviteSlice";
import {
  createLocalPreviewSlice,
  emptyLocalPreviewState,
  type LocalPreviewSlice
} from "./slices/localPreviewSlice";
import {
  createRoomSettingsSlice,
  emptyRoomSettingsState,
  type RoomSettingsSlice
} from "./slices/roomSettingsSlice";
import { createRoomChatSlice, emptyRoomChatState, type RoomChatSlice } from "./slices/roomChatSlice";
import { createRoomLifecycleSlice, type RoomLifecycleSlice } from "./slices/roomLifecycleSlice";
import {
  createRelayRuntimeSlice,
  emptyRelayRuntimeState,
  type RelayRuntimeSlice
} from "./slices/relayRuntimeSlice";
import { createTerminalSlice, emptyTerminalState, type TerminalSlice } from "./slices/terminalSlice";
import { createShellSlice, emptyShellState, type ShellSlice } from "./slices/shellSlice";
import {
  createWorkspaceDataSlice,
  emptyWorkspaceDataState,
  type WorkspaceDataSlice
} from "./slices/workspaceDataSlice";
import {
  createWorkspaceUiSlice,
  emptyWorkspaceUiState,
  type WorkspaceUiSlice
} from "./slices/workspaceUiSlice";

const emptyAppStoreState = {
  ...emptyAppConfigState,
  ...emptyGitWorkflowState,
  ...emptyBrowserState,
  ...emptyFilePanelState,
  ...emptyHistoryPresenceState,
  ...emptyHistoryDefaultsState,
  ...emptyRoomSettingsState,
  ...emptyLocalPreviewState,
  ...emptyInviteState,
  ...emptyRoomChatState,
  ...emptyCodexHostHandoffState,
  ...emptyTerminalState,
  ...emptyWorkspaceDataState,
  ...emptyWorkspaceUiState,
  ...emptyRelayRuntimeState,
  ...emptyShellState,
  ...emptyAppRuntimeState,
  ...emptyAuthState
};

export interface AppStoreState
  extends AppConfigSlice,
    AppRuntimeSlice,
    AuthSlice,
    BrowserSlice,
    CodexHostHandoffSlice,
    FilePanelSlice,
    GitWorkflowSlice,
    HistoryDefaultsSlice,
    HistoryPresenceSlice,
    InviteSlice,
    LocalPreviewSlice,
    RoomSettingsSlice,
    RoomChatSlice,
    RoomLifecycleSlice,
    RelayRuntimeSlice,
    ShellSlice,
    TerminalSlice,
    WorkspaceDataSlice,
    WorkspaceUiSlice {
  resetAppStore: () => void;
}

export const useAppStore = create<AppStoreState>((set, get, api) => ({
  ...emptyAppStoreState,
  ...createAppConfigSlice(set, get, api),
  ...createAppRuntimeSlice(set, get, api),
  ...createAuthSlice(set, get, api),
  ...createBrowserSlice(set, get, api),
  ...createCodexHostHandoffSlice(set, get, api),
  ...createFilePanelSlice(set, get, api),
  ...createGitWorkflowSlice(set, get, api),
  ...createHistoryDefaultsSlice(set, get, api),
  ...createHistoryPresenceSlice(set, get, api),
  ...createInviteSlice(set, get, api),
  ...createLocalPreviewSlice(set, get, api),
  ...createRoomSettingsSlice(set, get, api),
  ...createRoomChatSlice(set, get, api),
  ...createRoomLifecycleSlice(set, get, api),
  ...createRelayRuntimeSlice(set, get, api),
  ...createShellSlice(set, get, api),
  ...createTerminalSlice(set, get, api),
  ...createWorkspaceDataSlice(set, get, api),
  ...createWorkspaceUiSlice(set, get, api),
  resetAppStore: () => set({
    ...emptyAppStoreState,
    ...loadAppConfigState()
  })
}));
