import { create } from "zustand";
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
import {
  createWorkspaceDataSlice,
  emptyWorkspaceDataState,
  type WorkspaceDataSlice
} from "./slices/workspaceDataSlice";

const emptyAppStoreState = {
  ...emptyGitWorkflowState,
  ...emptyBrowserState,
  ...emptyFilePanelState,
  ...emptyHistoryPresenceState,
  ...emptyRoomSettingsState,
  ...emptyLocalPreviewState,
  ...emptyInviteState,
  ...emptyRoomChatState,
  ...emptyCodexHostHandoffState,
  ...emptyTerminalState,
  ...emptyWorkspaceDataState,
  ...emptyRelayRuntimeState
};

export interface AppStoreState
  extends BrowserSlice,
    CodexHostHandoffSlice,
    FilePanelSlice,
    GitWorkflowSlice,
    HistoryPresenceSlice,
    InviteSlice,
    LocalPreviewSlice,
    RoomSettingsSlice,
    RoomChatSlice,
    RoomLifecycleSlice,
    RelayRuntimeSlice,
    TerminalSlice,
    WorkspaceDataSlice {
  resetAppStore: () => void;
}

export const useAppStore = create<AppStoreState>((set, get, api) => ({
  ...emptyAppStoreState,
  ...createBrowserSlice(set, get, api),
  ...createCodexHostHandoffSlice(set, get, api),
  ...createFilePanelSlice(set, get, api),
  ...createGitWorkflowSlice(set, get, api),
  ...createHistoryPresenceSlice(set, get, api),
  ...createInviteSlice(set, get, api),
  ...createLocalPreviewSlice(set, get, api),
  ...createRoomSettingsSlice(set, get, api),
  ...createRoomChatSlice(set, get, api),
  ...createRoomLifecycleSlice(set, get, api),
  ...createRelayRuntimeSlice(set, get, api),
  ...createTerminalSlice(set, get, api),
  ...createWorkspaceDataSlice(set, get, api),
  resetAppStore: () => set(emptyAppStoreState)
}));
