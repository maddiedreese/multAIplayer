import React, { type ComponentProps } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canStageRoomChatAttachment } from "../lib/chatPolicy";
import { formatBytes, formatCodexModel, formatTimestamp } from "../lib/appFormatters";
import { BrowserAccessPanel } from "../components/BrowserAccessPanel";
import { RoomInspectorPanel } from "../components/RoomInspectorPanel";
import { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";

type InspectorProps = ComponentProps<typeof RoomInspectorPanel>;
type WorkProps = ComponentProps<typeof RoomInspectorWorkPanel>;

interface UseRoomInspectorPanelPropsOptions {
  activeTab: InspectorProps["activeTab"];
  activeBrowserUrl: string | null;
  browserUrl: string;
  canHostBrowser: boolean;
  onBrowserUrlChange: (url: string) => void;
  onOpenBrowserNow: () => void;
  selectedRoom: RoomRecord;
  projectPathDraft: string;
  gitStatus: WorkProps["workspaceFiles"]["gitStatus"];
  hasSelectedRoom: boolean;
  isSelectedRoomLocked: boolean;
  settingsBusy: boolean;
  isActiveHost: boolean;
  defaultProjectPath: string;
  onProjectPathDraftChange: WorkProps["project"]["onProjectPathDraftChange"];
  onChooseProjectPath: WorkProps["project"]["onChooseProjectPath"];
  onUpdateProjectPath: WorkProps["project"]["onUpdateProjectPath"];
  teamRoster: WorkProps["teamRoster"];
  roomMembers: WorkProps["roomMembers"];
  hostHandoffs: WorkProps["hostHandoff"]["handoffs"];
  hostBusy: boolean;
  onAcceptHandoff: WorkProps["hostHandoff"]["onAcceptHandoff"];
  encryptedInvite: Omit<WorkProps["encryptedInvite"], "onInviteApprovalGateChange"> & {
    onInviteApprovalGateChange: (enabled: boolean) => void;
  };
  approvalPolicy: Omit<WorkProps["approvalPolicy"], "selectedPolicy" | "selectedDelegationPolicy" | "disabled">;
  roomMode: Omit<WorkProps["roomMode"], "mode" | "disabled">;
  selectedCodexModel: string;
  selectedCodexReasoningEffort: string;
  selectedCodexSpeed: string;
  model: Omit<
    WorkProps["model"],
    "selectedModel" | "selectedModelLabel" | "selectedReasoningEffort" | "selectedSpeed" | "disabled" | "canApplyCustomModel"
  >;
  customCodexModel: string;
  localHistory: WorkProps["localHistory"];
  workspaceFiles: Omit<
    WorkProps["workspaceFiles"],
    | "gitStatus"
    | "canAttachSelectedFile"
    | "formatBytes"
  >;
  gitHandoff: WorkProps["gitHandoff"];
  githubActions: Omit<
    WorkProps["githubActions"],
    | "owner"
    | "repo"
    | "branch"
    | "refreshDisabled"
    | "formatTimestamp"
  > & {
    owner: string;
    repo: string;
    branch: string;
    refreshDisabled: boolean;
  };
  terminal: Omit<
    WorkProps["terminal"],
    "canApproveTerminal"
  >;
}

export function useRoomInspectorPanelProps({
  activeTab,
  activeBrowserUrl,
  browserUrl,
  canHostBrowser,
  onBrowserUrlChange,
  onOpenBrowserNow,
  selectedRoom,
  projectPathDraft,
  gitStatus,
  hasSelectedRoom,
  isSelectedRoomLocked,
  settingsBusy,
  isActiveHost,
  defaultProjectPath,
  onProjectPathDraftChange,
  onChooseProjectPath,
  onUpdateProjectPath,
  teamRoster,
  roomMembers,
  hostHandoffs,
  hostBusy,
  onAcceptHandoff,
  encryptedInvite,
  approvalPolicy,
  roomMode,
  selectedCodexModel,
  selectedCodexReasoningEffort,
  selectedCodexSpeed,
  model,
  customCodexModel,
  localHistory,
  workspaceFiles,
  gitHandoff,
  githubActions,
  terminal
}: UseRoomInspectorPanelPropsOptions): InspectorProps {
  return {
    activeTab,
    browserPanel: (
      <BrowserAccessPanel
        hidden={activeTab !== "browser"}
        activeBrowserUrl={activeBrowserUrl}
        browserUrl={browserUrl}
        canHostBrowser={canHostBrowser}
        onBrowserUrlChange={onBrowserUrlChange}
        onOpenBrowserNow={onOpenBrowserNow}
      />
    ),
    workPanel: (
      <RoomInspectorWorkPanel
        activeTab={activeTab}
        project={{
          projectPath: selectedRoom.projectPath,
          projectPathDraft,
          branchLabel: gitStatus?.branch ?? "loading",
          disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
          attachDisabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost || !projectPathDraft.trim() || projectPathDraft.trim() === selectedRoom.projectPath,
          onProjectPathDraftChange,
          onChooseProjectPath,
          onUseDefaultProjectPath: () => onProjectPathDraftChange(defaultProjectPath),
          onUpdateProjectPath
        }}
        teamRoster={teamRoster}
        roomMembers={roomMembers}
        hostHandoff={{
          handoffs: hostHandoffs,
          acceptDisabled: !hasSelectedRoom || isSelectedRoomLocked || hostBusy,
          onAcceptHandoff,
          formatModel: formatCodexModel
        }}
        encryptedInvite={encryptedInvite}
        approvalPolicy={{
          ...approvalPolicy,
          selectedPolicy: selectedRoom.approvalPolicy,
          selectedDelegationPolicy: selectedRoom.approvalDelegationPolicy,
          disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost
        }}
        roomMode={{
          ...roomMode,
          mode: selectedRoom.mode,
          disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost
        }}
        model={{
          ...model,
          selectedModel: selectedCodexModel,
          selectedModelLabel: formatCodexModel(selectedCodexModel),
          selectedReasoningEffort: selectedCodexReasoningEffort,
          selectedSpeed: selectedCodexSpeed,
          disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
          canApplyCustomModel: Boolean(customCodexModel.trim()) && customCodexModel.trim() !== selectedCodexModel
        }}
        localHistory={localHistory}
        workspaceFiles={{
          ...workspaceFiles,
          gitStatus,
          canAttachSelectedFile: canStageRoomChatAttachment(selectedRoom, isSelectedRoomLocked),
          formatBytes
        }}
        gitHandoff={gitHandoff}
        githubActions={{
          ...githubActions,
          formatTimestamp
        }}
        terminal={{
          ...terminal,
          canApproveTerminal: terminal.canReadLocalWorkspace && isActiveHost
        }}
      />
    )
  };
}
