import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomChatPanel, type RoomChatMessageDisplay } from "../src/components/RoomChatPanel";

const noop = () => {};

function renderChat(messages: RoomChatMessageDisplay[]) {
  return renderToStaticMarkup(createElement(RoomChatPanel, {
    messages,
    approvalVisible: false,
    approvalSummary: {
      messages: "0 since last Codex response",
      attachments: "None",
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
    pendingAttachments: [],
    pendingAttachmentSummary: "0/5 files",
    onToggleMessageSelection: noop,
    onCopyMessageMarkdown: noop,
    onCopyCodexOutputMarkdown: noop,
    onOpenAttachment: noop,
    onToggleReaction: noop,
    onDenyApproval: noop,
    onApproveApproval: noop,
    onInvokeCodex: noop,
    onRemovePendingAttachment: noop,
    onDraftChange: noop,
    onSendMessage: noop
  }));
}

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
  const html = renderToStaticMarkup(createElement(RoomChatPanel, {
    messages: [],
    approvalVisible: true,
    approvalSummary: {
      messages: "Maddie: inspect this output",
      attachments: "output.log (1 KB)",
      riskFlags: [{
        id: "attachment-output.log:agent-directed",
        label: "attachment output.log contains agent-directed phrasing",
        source: "attachment output.log",
        risk: "Agent-directed phrasing",
        severity: "warning"
      }]
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
    pendingAttachments: [],
    pendingAttachmentSummary: "0/5 files",
    onToggleMessageSelection: noop,
    onCopyMessageMarkdown: noop,
    onCopyCodexOutputMarkdown: noop,
    onOpenAttachment: noop,
    onToggleReaction: noop,
    onDenyApproval: noop,
    onApproveApproval: noop,
    onInvokeCodex: noop,
    onRemovePendingAttachment: noop,
    onDraftChange: noop,
    onSendMessage: noop
  }));

  assert.equal(html.includes("Review warnings"), true);
  assert.equal(html.includes("attachment output.log contains agent-directed phrasing"), true);
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
