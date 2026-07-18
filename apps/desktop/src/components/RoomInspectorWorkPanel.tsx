import React, { type ComponentProps } from "react";
import { ApprovalPolicyPanel } from "./ApprovalPolicyPanel";
import { CodexActivityTimeline } from "./CodexActivityTimeline";
import { CodexThreadGraphPanel } from "./CodexThreadGraphPanel";
import { EncryptedInvitePanel } from "./EncryptedInvitePanel";
import { GitHandoffPanel } from "./GitHandoffPanel";
import { GitHubActionsPanel } from "./GitHubActionsPanel";
import { GitHubRepositoryAccessPrompt, type GitHubRepositoryAccessPromptProps } from "./GitHubRepositoryAccessPrompt";
import { HostHandoffPanel } from "./HostHandoffPanel";
import { LocalHistoryPanel } from "./LocalHistoryPanel";
import { ModelPanel } from "./ModelPanel";
import { ProjectPanel } from "./ProjectPanel";
import { RoomMembersPanel, TeamRosterPanel } from "./RosterPanels";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import type { InspectorTab } from "../lib/core/uiTypes";
import type { HostHandoffRecord, InviteJoinRequest } from "../types";

type TerminalPanelComponent = typeof import("./TerminalPanel").TerminalPanel;
const TerminalPanel = React.lazy(() => import("./TerminalPanel").then((module) => ({ default: module.TerminalPanel })));

export function RoomInspectorWorkPanel({
  activeTab,
  project,
  teamRoster,
  roomMembers,
  hostHandoff,
  encryptedInvite,
  approvalPolicy,
  model,
  codexRuntime,
  localHistory,
  workspaceFiles,
  repositoryAccess,
  gitHandoff,
  githubActions,
  terminal
}: {
  activeTab: InspectorTab;
  project: ComponentProps<typeof ProjectPanel>;
  teamRoster: ComponentProps<typeof TeamRosterPanel>;
  roomMembers: ComponentProps<typeof RoomMembersPanel>;
  hostHandoff: ComponentProps<typeof HostHandoffPanel<HostHandoffRecord>>;
  encryptedInvite: ComponentProps<typeof EncryptedInvitePanel<InviteJoinRequest>>;
  approvalPolicy: ComponentProps<typeof ApprovalPolicyPanel>;
  model: ComponentProps<typeof ModelPanel>;
  codexRuntime: { roomId: string; projectPath: string };
  localHistory: ComponentProps<typeof LocalHistoryPanel>;
  workspaceFiles: ComponentProps<typeof WorkspaceFilesPanel>;
  repositoryAccess: GitHubRepositoryAccessPromptProps;
  gitHandoff: ComponentProps<typeof GitHandoffPanel>;
  githubActions: ComponentProps<typeof GitHubActionsPanel>;
  terminal: ComponentProps<TerminalPanelComponent>;
}) {
  if (activeTab === "files") {
    return (
      <>
        <ProjectPanel {...project} />
        <WorkspaceFilesPanel {...workspaceFiles} />
        <GitHubRepositoryAccessPrompt {...repositoryAccess} />
        <GitHandoffPanel {...gitHandoff} />
        <GitHubActionsPanel {...githubActions} />
      </>
    );
  }

  if (activeTab === "terminal") {
    return (
      <React.Suspense fallback={<div className="workflow-message">Opening terminal…</div>}>
        <TerminalPanel {...terminal} />
      </React.Suspense>
    );
  }

  if (activeTab === "browser") {
    return null;
  }

  return (
    <>
      <ProjectPanel {...project} />
      <TeamRosterPanel {...teamRoster} />
      <RoomMembersPanel {...roomMembers} />
      <HostHandoffPanel {...hostHandoff} />
      <EncryptedInvitePanel {...encryptedInvite} />
      <ApprovalPolicyPanel {...approvalPolicy} />
      <ModelPanel {...model} />
      <CodexThreadGraphPanel {...codexRuntime} />
      <CodexActivityTimeline roomId={codexRuntime.roomId} />
      <LocalHistoryPanel {...localHistory} />
    </>
  );
}
