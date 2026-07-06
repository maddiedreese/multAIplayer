import type { ComponentProps } from "react";
import { ApprovalPolicyPanel } from "./ApprovalPolicyPanel";
import { EncryptedInvitePanel } from "./EncryptedInvitePanel";
import { GitHandoffPanel } from "./GitHandoffPanel";
import { GitHubActionsPanel } from "./GitHubActionsPanel";
import { HostHandoffPanel } from "./HostHandoffPanel";
import { LocalHistoryPanel } from "./LocalHistoryPanel";
import { ModelPanel } from "./ModelPanel";
import { ProjectPanel } from "./ProjectPanel";
import { RoomModePanel } from "./RoomModePanel";
import { RoomMembersPanel, TeamRosterPanel } from "./RosterPanels";
import { TerminalPanel } from "./TerminalPanel";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import type { HostHandoffRecord, InviteJoinRequest } from "../types";

export function RoomInspectorWorkPanel({
  project,
  teamRoster,
  roomMembers,
  hostHandoff,
  encryptedInvite,
  approvalPolicy,
  roomMode,
  model,
  localHistory,
  workspaceFiles,
  gitHandoff,
  githubActions,
  terminal
}: {
  project: ComponentProps<typeof ProjectPanel>;
  teamRoster: ComponentProps<typeof TeamRosterPanel>;
  roomMembers: ComponentProps<typeof RoomMembersPanel>;
  hostHandoff: ComponentProps<typeof HostHandoffPanel<HostHandoffRecord>>;
  encryptedInvite: ComponentProps<typeof EncryptedInvitePanel<InviteJoinRequest>>;
  approvalPolicy: ComponentProps<typeof ApprovalPolicyPanel>;
  roomMode: ComponentProps<typeof RoomModePanel>;
  model: ComponentProps<typeof ModelPanel>;
  localHistory: ComponentProps<typeof LocalHistoryPanel>;
  workspaceFiles: ComponentProps<typeof WorkspaceFilesPanel>;
  gitHandoff: ComponentProps<typeof GitHandoffPanel>;
  githubActions: ComponentProps<typeof GitHubActionsPanel>;
  terminal: ComponentProps<typeof TerminalPanel>;
}) {
  return (
    <>
      <ProjectPanel {...project} />
      <TeamRosterPanel {...teamRoster} />
      <RoomMembersPanel {...roomMembers} />
      <HostHandoffPanel {...hostHandoff} />
      <EncryptedInvitePanel {...encryptedInvite} />
      <ApprovalPolicyPanel {...approvalPolicy} />
      <RoomModePanel {...roomMode} />
      <ModelPanel {...model} />
      <LocalHistoryPanel {...localHistory} />
      <WorkspaceFilesPanel {...workspaceFiles} />
      <GitHandoffPanel {...gitHandoff} />
      <GitHubActionsPanel {...githubActions} />
      <TerminalPanel {...terminal} />
    </>
  );
}
