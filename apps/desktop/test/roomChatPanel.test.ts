import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomChatPanel, type RoomChatMessageDisplay } from "../src/components/RoomChatPanel";
import type { CodexActivity } from "../src/types";

const noop = () => {};

function renderChat(messages: RoomChatMessageDisplay[], codexActivities: CodexActivity[] = []) {
  return renderToStaticMarkup(
    createElement(RoomChatPanel, {
      messages,
      codexActivities,
      markdownSelectionMode: false,
      approvalVisible: false,
      approvalSummary: {
        messages: "0 since last Codex response",
        attachments: "None",
        sandbox: "Workspace write",
        highPrivilegeLabels: [],
        riskFlags: []
      },
      isActiveHost: true,
      codexRunning: false,
      canApproveCodex: true,
      canUseChat: true,
      canSendMessage: false,
      roomLocked: false,
      lockedPlaceholder: "Room locked",
      chatEnabled: true,
      draft: "",
      replyTarget: null,
      roomGoal: null,
      pendingAttachments: [],
      localPreviewCards: [],
      pendingAttachmentSummary: "0/5 files",
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
    })
  );
}

test("RoomChatPanel composes transcript content before the composer", () => {
  const html = renderChat([
    {
      id: "m-boundary",
      author: "Avery",
      role: "human",
      body: "Keep the content boundary explicit.",
      time: "10:02",
      selected: false,
      attachments: [],
      reactions: []
    }
  ]);

  const contentIndex = html.indexOf('class="chat-scroll"');
  const composerIndex = html.indexOf('class="composer"');
  assert.ok(contentIndex >= 0);
  assert.ok(composerIndex > contentIndex);
  assert.equal(html.match(/class="chat-scroll"/g)?.length, 1);
  assert.match(html, /Keep the content boundary explicit\./);
});

test("RoomChatPanel renders fenced and inline code for human and Codex messages without parsing raw HTML", () => {
  const html = renderChat([
    {
      id: "human-code",
      author: "Avery",
      role: "human",
      body: "Use `roomId` here.\n\n```ts\nconst roomId = '<img src=x onerror=alert(1)>';\n```",
      time: "10:03",
      selected: false,
      attachments: [],
      reactions: []
    },
    {
      id: "codex-code",
      author: "Codex via Avery",
      role: "codex",
      body: "Done.\n\n```rust\nlet safe = true;\n```",
      time: "10:04",
      selected: false,
      attachments: [],
      reactions: []
    }
  ]);

  assert.match(html, /<code>roomId<\/code>/);
  assert.match(html, /class="language-ts"/);
  assert.match(html, /class="language-rust"/);
  assert.match(html, /aria-label="Copy ts code"/);
  assert.match(html, /aria-label="Copy rust code"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src="x"/);
});

test("RoomChatPanel renders only prevalidated inline image display sources", () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const html = renderChat([
    {
      id: "codex-image",
      author: "Codex via Avery",
      role: "codex",
      body: "Generated image:",
      time: "10:05",
      selected: false,
      attachments: [
        {
          id: "generated-image",
          name: "generated.png",
          meta: "image/png, 8 B",
          encryptedBlob: false,
          canPreview: true,
          image: { src: image, alt: "generated.png" }
        }
      ],
      reactions: []
    }
  ]);

  assert.match(html, /class="chat-image-attachment"/);
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(html, /alt="generated.png"/);
  assert.match(html, /loading="lazy"/);
});

test("RoomChatPanel shows Codex work and subagent disclosures in the conversation", () => {
  const html = renderChat(
    [],
    [
      {
        eventType: "codex.activity",
        activityId: "reasoning-1",
        turnId: "turn-1",
        itemId: "reasoning-1",
        kind: "reasoning",
        status: "running",
        title: "Reasoning",
        details: { type: "reasoning", summaries: ["Inspecting the renderer and its tests."] },
        startedAt: "2026-07-13T12:00:00.000Z",
        updatedAt: "2026-07-13T12:00:01.000Z",
        host: "Avery",
        hostUserId: "github:1"
      },
      {
        eventType: "codex.activity",
        activityId: "agent-1",
        turnId: "turn-1",
        itemId: "agent-1",
        kind: "agent",
        status: "completed",
        title: "Agent activity",
        agent: { action: "spawn", senderId: "root", receiverIds: ["child"] },
        details: { type: "agent", prompt: "Audit chat image support" },
        startedAt: "2026-07-13T12:00:00.000Z",
        updatedAt: "2026-07-13T12:00:02.000Z",
        host: "Avery",
        hostUserId: "github:1"
      }
    ]
  );
  assert.match(html, /Codex is working/);
  assert.match(html, /Thinking/);
  assert.match(html, /Inspecting the renderer/);
  assert.match(html, /Spawned a subagent/);
  assert.match(html, /Audit chat image support/);
});

test("RoomChatPanel hides zero-count reaction placeholders", () => {
  const html = renderChat([
    {
      id: "m1",
      author: "Avery",
      role: "human",
      body: "Ship the monochrome chat pass.",
      time: "9:41",
      selected: false,
      attachments: [],
      reactions: [
        { emoji: "👍", count: 0, active: false, title: "React" },
        { emoji: "✅", count: 0, active: false, title: "React" }
      ]
    }
  ]);

  assert.equal(html.includes("👍"), false);
  assert.equal(html.includes("✅"), false);
});

test("RoomChatPanel renders Codex approval risk warnings", () => {
  const html = renderToStaticMarkup(
    createElement(RoomChatPanel, {
      messages: [],
      markdownSelectionMode: false,
      approvalVisible: true,
      approvalSummary: {
        messages: "Maddie: inspect this output",
        attachments: "output.log (1 KB)",
        sandbox: "Workspace write",
        highPrivilegeLabels: [],
        riskFlags: [
          {
            id: "attachment-output.log:agent-directed",
            label: "attachment output.log contains agent-directed phrasing",
            source: "attachment output.log",
            risk: "Agent-directed phrasing",
            severity: "warning"
          }
        ]
      },
      isActiveHost: true,
      codexRunning: false,
      canApproveCodex: true,
      canUseChat: true,
      canSendMessage: false,
      roomLocked: false,
      lockedPlaceholder: "Room locked",
      chatEnabled: true,
      draft: "",
      replyTarget: null,
      roomGoal: null,
      pendingAttachments: [],
      localPreviewCards: [],
      pendingAttachmentSummary: "0/5 files",
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
    })
  );

  assert.equal(html.includes("Review warnings"), true);
  assert.equal(html.includes("attachment output.log contains agent-directed phrasing"), true);
});

test("RoomChatPanel distinguishes high-privilege Codex approvals", () => {
  const html = renderToStaticMarkup(
    createElement(RoomChatPanel, {
      messages: [],
      markdownSelectionMode: false,
      approvalVisible: true,
      approvalSummary: {
        messages: "Maddie: run the deployment check",
        attachments: "None",
        sandbox: "Full access",
        highPrivilegeLabels: ["full-access Codex", "terminal context"],
        riskFlags: []
      },
      isActiveHost: true,
      codexRunning: false,
      canApproveCodex: true,
      canUseChat: true,
      canSendMessage: false,
      roomLocked: false,
      lockedPlaceholder: "Room locked",
      chatEnabled: true,
      draft: "",
      replyTarget: null,
      roomGoal: null,
      pendingAttachments: [],
      localPreviewCards: [],
      pendingAttachmentSummary: "0/5 files",
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
    })
  );

  assert.equal(html.includes("High-privilege host action"), true);
  assert.equal(html.includes("full-access Codex, terminal context"), true);
});

test("RoomChatPanel keeps reactions that have activity", () => {
  const html = renderChat([
    {
      id: "m1",
      author: "Avery",
      role: "human",
      body: "Ready for review.",
      time: "9:48",
      selected: false,
      attachments: [],
      reactions: [
        { emoji: "👍", count: 1, active: false, title: "Jordan" },
        { emoji: "✅", count: 0, active: false, title: "React" }
      ]
    }
  ]);

  assert.equal(html.includes("👍"), true);
  assert.equal(html.includes("✅"), false);
});

test("RoomChatPanel renders reply previews and composer reply target", () => {
  const html = renderToStaticMarkup(
    createElement(RoomChatPanel, {
      messages: [
        {
          id: "m2",
          author: "Jordan",
          role: "human",
          body: "Agreed, do that.",
          time: "9:43",
          replyPreview: {
            author: "Avery",
            body: "Use approach B."
          },
          selected: false,
          attachments: [],
          reactions: []
        }
      ],
      approvalVisible: false,
      approvalSummary: {
        messages: "0 since last Codex response",
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
      draft: "yes",
      replyTarget: {
        author: "Avery",
        body: "Use approach B."
      },
      roomGoal: null,
      pendingAttachments: [],
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
    })
  );

  assert.equal(html.includes("Replying to Avery"), true);
  assert.equal(html.includes("Use approach B."), true);
  assert.equal(html.includes("Agreed, do that."), true);
});

test("RoomChatPanel renders queued Codex turns", () => {
  const html = renderToStaticMarkup(
    createElement(RoomChatPanel, {
      messages: [],
      approvalVisible: false,
      approvalSummary: {
        messages: "0 since last Codex response",
        attachments: "None",
        sandbox: "Workspace write",
        highPrivilegeLabels: [],
        riskFlags: []
      },
      isActiveHost: true,
      codexRunning: true,
      canApproveCodex: true,
      canUseChat: true,
      canSendMessage: false,
      roomLocked: false,
      lockedPlaceholder: "Room locked",
      chatEnabled: true,
      draft: "",
      replyTarget: null,
      queuedCodexTurns: [
        {
          turnId: "turn-queued-1",
          requestedBy: "Maddie",
          queuedAt: "2026-07-07T12:00:00.000Z",
          messagesSinceLastCodex: 3,
          canCancel: true
        }
      ],
      roomGoal: null,
      pendingAttachments: [],
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
    })
  );

  assert.equal(html.includes("Codex queue"), true);
  assert.equal(html.includes("1 waiting"), true);
  assert.equal(html.includes("Maddie"), true);
  assert.equal(html.includes("3 messages ready at turn start"), true);
});

test("RoomChatPanel renders editable markers and deleted tombstones", () => {
  const html = renderChat([
    {
      id: "m1",
      author: "Maddie",
      role: "human",
      body: "Updated plan",
      time: "9:44",
      edited: true,
      canEdit: true,
      canDelete: true,
      selected: false,
      attachments: [],
      reactions: []
    },
    {
      id: "m2",
      author: "Jordan",
      role: "human",
      body: "Message deleted",
      time: "9:45",
      deleted: true,
      selected: false,
      attachments: [],
      reactions: []
    }
  ]);

  assert.equal(html.includes("(edited)"), true);
  assert.equal(html.includes("Edit message"), true);
  assert.equal(html.includes("Delete message"), true);
  assert.equal(html.includes("Message deleted"), true);
});
