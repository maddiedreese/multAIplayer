import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCodexOutputMarkdown,
  buildDiffSummaryMarkdown,
  buildMessageMarkdown,
  buildProjectMarkdown,
  buildPullRequestBody,
  buildRoomMarkdown,
  buildSelectedMessagesMarkdown,
  buildTerminalMarkdown,
  fencedCode,
  inlineCode
} from "../src/lib/markdownExport";
import type { RoomRecord } from "@multaiplayer/protocol";

const room: RoomRecord = {
  id: "room-test",
  teamId: "team-test",
  name: "Docs & Diff Room",
  projectPath: "/Users/maddie/dev/mult`AI`player",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("buildMessageMarkdown includes escaped author, attachments, and reactions", () => {
  const markdown = buildMessageMarkdown({
    id: "message-1",
    author: "Maddie_[host]",
    role: "human",
    body: "Can you review `diff` output?",
    time: "10:30",
    attachments: [{
      id: "attachment-1",
      name: "src/app`main`.tsx",
      type: "code",
      size: 2048,
      blobId: "blob-1",
      blobBytes: 120000
    }],
    reactions: [{ emoji: "+1", reactors: [{ name: "Priya_A" }] }]
  });

  assert.match(markdown, /^### Maddie\\_\\\[host\\\] \(human, 10:30\)/);
  assert.match(markdown, /Can you review `diff` output\?/);
  assert.match(markdown, /``src\/app`main`\.tsx`` \(code, 2 KB, encrypted blob preview 117 KB\)/);
  assert.match(markdown, /\\\+1 Priya\\_A/);
});

test("buildRoomMarkdown includes metadata and message separators", () => {
  const markdown = buildRoomMarkdown(room, "Core_Team", [
    { id: "a", author: "A", role: "human", body: "first", time: "10:00" },
    { id: "b", author: "B", role: "human", body: "second", time: "10:01" }
  ]);

  assert.match(markdown, /^# Docs & Diff Room/);
  assert.match(markdown, /Team: Core\\_Team/);
  assert.match(markdown, /Project: ``\/Users\/maddie\/dev\/mult`AI`player``/);
  assert.match(markdown, /Hosted by Maddie/);
  assert.match(markdown, /\n\n---\n\n/);
});

test("buildSelectedMessagesMarkdown includes only selected transcript messages", () => {
  const markdown = buildSelectedMessagesMarkdown(room, [
    { id: "b", author: "B", role: "human", body: "selected second", time: "10:01" },
    { id: "c", author: "Codex", role: "codex", body: "selected output", time: "10:02" }
  ]);

  assert.match(markdown, /^# Docs & Diff Room Selected Messages/);
  assert.match(markdown, /Project: ``\/Users\/maddie\/dev\/mult`AI`player``/);
  assert.match(markdown, /selected second/);
  assert.match(markdown, /selected output/);
  assert.doesNotMatch(markdown, /first unselected/);
  assert.match(markdown, /\n\n---\n\n/);
});

test("buildCodexOutputMarkdown captures messages since the previous Codex turn", () => {
  const messages = [
    { id: "m1", author: "Human", role: "human" as const, body: "before old codex", time: "10:00" },
    { id: "c1", author: "Codex", role: "codex" as const, body: "old output", time: "10:01" },
    { id: "m2", author: "Priya", role: "human" as const, body: "fix the tests", time: "10:02" },
    { id: "m3", author: "Maddie", role: "human" as const, body: "and update docs", time: "10:03" },
    { id: "c2", author: "Codex", role: "codex" as const, body: "new output", time: "10:04" }
  ];

  const markdown = buildCodexOutputMarkdown(room, messages[4], messages);
  assert.doesNotMatch(markdown, /before old codex/);
  assert.match(markdown, /\*\*Priya\*\*: fix the tests/);
  assert.match(markdown, /\*\*Maddie\*\*: and update docs/);
  assert.match(markdown, /## Codex Output\n\nnew output/);
});

test("project and diff exports use fences longer than embedded code fences", () => {
  const diff = [
    "diff --git a/README.md b/README.md",
    "+```",
    "+inside diff",
    "+```"
  ].join("\n");
  const markdown = buildProjectMarkdown(
    room.name,
    room.projectPath,
    [{ path: "README.md", status: "modified", added: 3, removed: 0 }],
    {
      path: "README.md",
      size: 42,
      truncated: true,
      content: "```\ninside file\n```"
    },
    { path: "README.md", diff }
  );

  assert.match(markdown, /````diff\ndiff --git/);
  assert.match(markdown, /````\n\n## README/);
  assert.match(markdown, /> Preview truncated at 19 B\./);
  assert.match(markdown, /````\n```\ninside file\n```\n````/);
});

test("buildDiffSummaryMarkdown and buildTerminalMarkdown include operational context", () => {
  const diffMarkdown = buildDiffSummaryMarkdown(
    room,
    "feature/markdown",
    [{ path: "src/App.tsx", status: "modified", added: 10, removed: 2 }],
    { path: "src/App.tsx", diff: "+hello" }
  );
  assert.match(diffMarkdown, /Branch: feature\/markdown/);
  assert.match(diffMarkdown, /`src\/App\.tsx` \(modified, \+10\/-2\)/);

  const terminalMarkdown = buildTerminalMarkdown(
    room,
    {
      id: "terminal-1",
      roomId: room.id,
      name: "tests",
      cwd: room.projectPath,
      command: "npm test",
      running: false,
      exitStatus: 0,
      startedAt: new Date().toISOString(),
      lines: []
    },
    [
      { stream: "system", text: "$ npm test" },
      { stream: "stdout", text: "ok" },
      { stream: "stderr", text: "warn" }
    ]
  );
  assert.match(terminalMarkdown, /Terminal: tests/);
  assert.match(terminalMarkdown, /Command: `npm test`/);
  assert.match(terminalMarkdown, /```text\n\[system\] \$ npm test\nok\n\[stderr\] warn\n```/);
});

test("project, diff, and terminal exports include sensitive-content warnings", () => {
  const projectMarkdown = buildProjectMarkdown(
    room.name,
    room.projectPath,
    [{ path: ".env", status: "modified", added: 1, removed: 0 }],
    {
      path: ".env",
      size: 32,
      truncated: false,
      content: "SECRET_TOKEN=test-value"
    },
    null,
    ["Sensitive file access", "Credential-looking output"]
  );
  assert.match(projectMarkdown, /> \[!WARNING\]/);
  assert.match(projectMarkdown, /Sensitive file access, Credential\\-looking output/);

  const diffMarkdown = buildDiffSummaryMarkdown(
    room,
    "feature/secrets",
    [{ path: ".env", status: "modified", added: 1, removed: 0 }],
    { path: ".env", diff: "+SECRET_TOKEN=test-value" },
    ["Environment variables"]
  );
  assert.match(diffMarkdown, /> This export may contain sensitive material: Environment variables/);

  const terminalMarkdown = buildTerminalMarkdown(
    room,
    null,
    [{ stream: "stdout", text: "API_KEY=test-value" }],
    ["Credential-looking output"]
  );
  assert.match(terminalMarkdown, /> This export may contain sensitive material: Credential\\-looking output/);
});

test("buildPullRequestBody escapes authors and changed files", () => {
  const markdown = buildPullRequestBody(
    [{ id: "m1", author: "Maddie_*", role: "human", body: "ship the `alpha`", time: "10:00" }],
    [{ path: "src/new`file`.ts", status: "modified" }]
  );

  assert.match(markdown, /\*\*Maddie\\_\\\*\*\*: ship the `alpha`/);
  assert.match(markdown, /``src\/new`file`\.ts`` \(modified\)/);
});

test("fencedCode expands fences beyond embedded backticks", () => {
  assert.equal(fencedCode("````\ninside\n````", "text"), "`````text\n````\ninside\n````\n`````");
});

test("inlineCode safely contains backticks, backslashes, whitespace, and newlines", () => {
  assert.equal(inlineCode("src/`odd\\name`.ts"), "``src/`odd\\name`.ts``");
  assert.equal(inlineCode("`edge`"), "`` `edge` ``");
  assert.equal(inlineCode(" line one\nline two "), "`  line one line two  `");
});
