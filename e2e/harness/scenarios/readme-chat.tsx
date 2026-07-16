import React from "react";
import { RoomChatPanel, type RoomChatMessageDisplay } from "../../../apps/desktop/src/components/RoomChatPanel";
import type { CodexActivity } from "../../../apps/desktop/src/types";

export const description = "The production room chat shows a teammate request and Codex work in dark mode.";
export const mockedBoundaries = ["Codex app-server event delivery", "MLS encryption and relay persistence"] as const;

const noop = () => undefined;
const now = "2026-07-15T18:00:00.000Z";
const messages: RoomChatMessageDisplay[] = [
  {
    id: "teammate-request",
    author: "Maya",
    role: "human",
    body: "Can you tighten the empty state and verify the preview at mobile width?",
    time: "11:42",
    selected: false,
    attachments: [],
    reactions: [{ emoji: "👍", count: 2, reacted: true }]
  },
  {
    id: "codex-result",
    author: "Codex via Avery",
    role: "codex",
    body: "Updated the empty state and added a focused responsive test. The preview now stays readable down to 360 px.",
    time: "11:44",
    selected: false,
    attachments: [],
    reactions: []
  }
];
const activities: CodexActivity[] = [
  {
    eventType: "codex.activity",
    activityId: "responsive-edit",
    turnId: "readme-turn",
    itemId: "responsive-edit",
    kind: "file_change",
    status: "completed",
    title: "Updated the responsive empty state",
    details: {
      type: "file_change",
      changes: [
        { path: "src/components/EmptyState.tsx", action: "update", diff: "+ <p>Start by inviting your team.</p>" },
        { path: "test/empty-state.test.tsx", action: "create", diff: "+ test('fits mobile width', ...);" }
      ]
    },
    startedAt: now,
    updatedAt: now,
    host: "Avery",
    hostUserId: "github:avery"
  }
];

export default function ReadmeChatScenario() {
  return (
    <section className="readme-chat-surface" data-readme-capture aria-label="Shared Codex room chat feature">
      <RoomChatPanel
        messages={messages}
        codexActivities={activities}
        approvalVisible={false}
        approvalSummary={{
          messages: "0",
          attachments: "None",
          sandbox: "Workspace write",
          highPrivilegeLabels: [],
          riskFlags: []
        }}
        isActiveHost
        codexRunning={false}
        canApproveCodex
        canUseChat
        canSendMessage
        roomLocked={false}
        lockedPlaceholder="Room locked"
        chatEnabled
        draft=""
        pendingAttachments={[]}
        replyTarget={null}
        roomGoal={null}
        localPreviewCards={[]}
        pendingAttachmentSummary="0/5 files"
        markdownSelectionMode={false}
        onToggleMessageSelection={noop}
        onCopyMessageMarkdown={noop}
        onOpenAttachment={noop}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onDenyApproval={noop}
        onApproveApproval={noop}
        onInvokeCodex={noop}
        onRemovePendingAttachment={noop}
        onPauseGoal={noop}
        onResumeGoal={noop}
        onEditGoal={noop}
        onDeleteGoal={noop}
        onTickGoalElapsed={noop}
        onOpenLocalPreview={noop}
        onCopyLocalPreviewLink={noop}
        onStopLocalPreview={noop}
        onOpenFileSelector={noop}
        onReplyToMessage={noop}
        onCancelReply={noop}
        onCancelQueuedCodexTurn={noop}
        onDraftChange={noop}
        onSendMessage={noop}
      />
    </section>
  );
}
