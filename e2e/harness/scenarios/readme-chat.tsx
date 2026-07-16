import React from "react";
import { RoomChatPanel, type RoomChatMessageDisplay } from "../../../apps/desktop/src/components/RoomChatPanel";
import type { CodexActivity } from "../../../apps/desktop/src/types";

export const description = "The production room chat shows a teammate request and Codex work in dark mode.";
export const mockedBoundaries = ["Codex app-server event delivery", "MLS encryption and relay persistence"] as const;

const noop = () => undefined;
const now = "2026-07-15T18:00:00.000Z";
export const readmeMessages: RoomChatMessageDisplay[] = [
  {
    id: "teammate-request",
    author: "Maya",
    role: "human",
    body: "Can we make inviting a teammate feel clear from the first click?",
    time: "11:42",
    selected: false,
    attachments: [],
    reactions: [{ emoji: "👍", count: 2, reacted: true }]
  },
  {
    id: "codex-result",
    author: "Codex via Avery",
    role: "codex",
    body: "Simplified the invite flow, added verified-device feedback, and covered the full keyboard path.",
    time: "11:44",
    selected: false,
    attachments: [],
    reactions: []
  }
];
export const readmeActivities: CodexActivity[] = [
  {
    eventType: "codex.activity",
    activityId: "invite-flow-edit",
    turnId: "readme-turn",
    itemId: "invite-flow-edit",
    kind: "file_change",
    status: "completed",
    title: "Polished teammate invites",
    details: {
      type: "file_change",
      changes: [
        { path: "src/components/InvitePanel.tsx", action: "update", diff: "+ <VerifiedDeviceStatus />" },
        { path: "e2e/invite-join.spec.ts", action: "update", diff: "+ test('supports keyboard invite flow', ...);" }
      ]
    },
    startedAt: now,
    updatedAt: now,
    host: "Avery",
    hostUserId: "github:avery"
  }
];

export const readmeChatProps: React.ComponentProps<typeof RoomChatPanel> = {
  messages: readmeMessages,
  codexActivities: readmeActivities,
  approvalVisible: false,
  approvalSummary: {
    messages: "0",
    attachments: "None",
    sandbox: "Workspace write",
    highPrivilegeLabels: [],
    riskFlags: []
  },
  isActiveHost: true,
  codexRunning: false,
  canApproveCodex: true,
  canUseChat: true,
  canSendMessage: true,
  roomLocked: false,
  lockedPlaceholder: "Room locked",
  chatEnabled: true,
  draft: "",
  pendingAttachments: [],
  replyTarget: null,
  roomGoal: null,
  localPreviewCards: [],
  pendingAttachmentSummary: "0/5 files",
  markdownSelectionMode: false,
  onToggleMessageSelection: noop,
  onCopyMessageMarkdown: noop,
  onOpenAttachment: noop,
  onToggleReaction: noop,
  onEditMessage: noop,
  onDeleteMessage: noop,
  onDenyApproval: noop,
  onApproveApproval: noop,
  onInvokeCodex: noop,
  onRemovePendingAttachment: noop,
  onPauseGoal: noop,
  onResumeGoal: noop,
  onEditGoal: noop,
  onDeleteGoal: noop,
  onTickGoalElapsed: noop,
  onOpenLocalPreview: noop,
  onCopyLocalPreviewLink: noop,
  onStopLocalPreview: noop,
  onOpenFileSelector: noop,
  onReplyToMessage: noop,
  onCancelReply: noop,
  onCancelQueuedCodexTurn: noop,
  onDraftChange: noop,
  onSendMessage: noop
};

export default function ReadmeChatScenario() {
  return (
    <section className="readme-chat-surface" data-readme-capture aria-label="Shared Codex room chat feature">
      <RoomChatPanel {...readmeChatProps} />
    </section>
  );
}
