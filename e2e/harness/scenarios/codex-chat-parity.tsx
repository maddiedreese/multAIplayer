import React from "react";
import { RoomChatPanel, type RoomChatMessageDisplay } from "../../../apps/desktop/src/components/RoomChatPanel";
import type { CodexActivity } from "../../../apps/desktop/src/types";

export const description =
  "Production chat components render human and Codex code, generated images, and expandable reasoning, tool, edit, and subagent activity.";
export const mockedBoundaries = [
  "Codex app-server event delivery",
  "MLS encryption and relay persistence",
  "generated-image blob upload"
] as const;

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const now = "2026-07-13T18:00:00.000Z";

const messages: RoomChatMessageDisplay[] = [
  {
    id: "human-code",
    author: "Maddie",
    role: "human",
    body: "Please preserve `roomId`.\n\n```ts\nconst roomId = 'encrypted-room';\n```",
    time: "11:00",
    selected: false,
    attachments: [],
    reactions: []
  },
  {
    id: "codex-image",
    author: "Codex via Maddie",
    role: "codex",
    body: "Implemented and generated the preview.\n\n```rust\nlet shared = true;\n```",
    time: "11:01",
    selected: false,
    attachments: [
      {
        id: "generated-image",
        name: "codex-image.png",
        meta: "PNG · encrypted",
        encryptedBlob: true,
        canPreview: true,
        image: { src: pixel, alt: "Codex-generated preview" }
      }
    ],
    reactions: []
  }
];

function activity(
  activityId: string,
  kind: CodexActivity["kind"],
  title: string,
  details: NonNullable<CodexActivity["details"]>,
  agent?: CodexActivity["agent"]
): CodexActivity {
  return {
    eventType: "codex.activity",
    activityId,
    turnId: "turn-parity",
    itemId: activityId,
    kind,
    status: "completed",
    title,
    details,
    ...(agent ? { agent } : {}),
    startedAt: now,
    updatedAt: now,
    host: "Maddie",
    hostUserId: "github:maddie"
  };
}

const activities: CodexActivity[] = [
  activity("reasoning", "reasoning", "Reasoning", {
    type: "reasoning",
    summaries: ["Checked the room boundary before editing."],
    rawContent: ["Provider-supplied raw reasoning shared by the host for this room."]
  }),
  activity("edit", "file_change", "File change", {
    type: "file_change",
    changes: [{ path: "src/chat.tsx", action: "update", diff: "+ renderGeneratedImage();" }]
  }),
  activity("tool", "tool", "Tool call", {
    type: "tool",
    name: "view_image",
    arguments: '{"path":"preview.png"}',
    result: "Image inspected"
  }),
  activity(
    "agent",
    "agent",
    "Agent activity",
    {
      type: "agent",
      prompt: "Audit the visual behavior",
      states: [{ threadId: "visual-auditor", status: "completed", message: "Looks correct" }]
    },
    { action: "spawn", senderId: "root", receiverIds: ["visual-auditor"] }
  )
];

const noop = () => undefined;

export default function CodexChatParityScenario() {
  return (
    <section className="e2e-chat-parity" aria-label="Codex chat parity UI contract">
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
        canSendMessage={false}
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
