import type { ComponentProps } from "react";
import { ApprovalPolicyPanel } from "./ApprovalPolicyPanel";
import { EncryptedInvitePanel } from "./EncryptedInvitePanel";
import { GitHandoffPanel } from "./GitHandoffPanel";
import { GitHubActionsPanel } from "./GitHubActionsPanel";
import { HostHandoffPanel } from "./HostHandoffPanel";
import { LocalHistoryPanel } from "./LocalHistoryPanel";
import { ModelPanel } from "./ModelPanel";
import { ProjectPanel } from "./ProjectPanel";
import { RoomMembersPanel, TeamRosterPanel } from "./RosterPanels";
import { TerminalPanel } from "./TerminalPanel";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import type { InspectorTab } from "./RoomInspectorPanel";
import type { HostHandoffRecord, InviteJoinRequest } from "../types";

export function RoomInspectorWorkPanel({
  activeTab,
  project,
  teamRoster,
  roomMembers,
  hostHandoff,
  encryptedInvite,
  approvalPolicy,
  model,
  localHistory,
  workspaceFiles,
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
  localHistory: ComponentProps<typeof LocalHistoryPanel>;
  workspaceFiles: ComponentProps<typeof WorkspaceFilesPanel>;
  gitHandoff: ComponentProps<typeof GitHandoffPanel>;
  githubActions: ComponentProps<typeof GitHubActionsPanel>;
  terminal: ComponentProps<typeof TerminalPanel>;
}) {
  if (activeTab === "files") {
    return (
      <>
        <ProjectPanel {...project} />
        <WorkspaceFilesPanel {...workspaceFiles} />
        <GitHandoffPanel {...gitHandoff} />
        <GitHubActionsPanel {...githubActions} />
      </>
    );
  }

  if (activeTab === "terminal") {
    return <TerminalPanel {...terminal} />;
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
      <LocalHistoryPanel {...localHistory} />
    </>
  );
}
