import {
  codexModelOptions,
  defaultCodexModel,
  type ApprovalPolicy,
  type RoomRecord
} from "@multaiplayer/protocol";
import type { GitDiffResult, ProjectFileContent, TerminalSnapshot } from "./localBackend";

export interface MarkdownChatAttachment {
  name: string;
  type: string;
  size: number;
  blobId?: string;
  blobBytes?: number;
}

export interface MarkdownReaction {
  emoji: string;
  reactors: Array<{ name: string }>;
}

export interface MarkdownChatMessage {
  id: string;
  author: string;
  role: "human" | "codex" | "system";
  body: string;
  time: string;
  attachments?: MarkdownChatAttachment[];
  reactions?: MarkdownReaction[];
}

const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  ask_every_turn: "Ask every Codex turn",
  auto_chat_only: "Auto-approve chat-only turns",
  auto_browser_allowed_sites: "Auto-approve allowed browser sites",
  never_host: "Never host this room"
};

export function buildPullRequestBody(
  messages: MarkdownChatMessage[],
  files: Array<{ path: string; status: string }>
): string {
  const recentMessages = messages.slice(-8).map((message) => `- **${escapeMarkdown(message.author)}**: ${normalizeMarkdownText(message.body)}`);
  const changedFiles = files.map((file) => `- \`${escapeBackticks(file.path)}\` (${escapeMarkdown(file.status)})`);

  return compactMarkdown([
    "## Summary",
    "Created from an approved multAIplayer room handoff.",
    "",
    "## Recent room context",
    recentMessages.join("\n") || "- No recent messages captured.",
    "",
    "## Changed files",
    changedFiles.join("\n") || "- No changed files reported.",
    "",
    "## Review notes",
    "- Verify the local diff before merging.",
    "- This PR was opened as a draft by default."
  ]);
}

export function buildRoomMarkdown(room: RoomRecord, teamName: string, messages: MarkdownChatMessage[]): string {
  return compactMarkdown([
    `# ${escapeMarkdown(room.name)}`,
    "",
    `Team: ${escapeMarkdown(teamName)}`,
    `Project: \`${escapeBackticks(room.projectPath)}\``,
    `Host: ${escapeMarkdown(formatHostStatus(room))}`,
    `Model: ${escapeMarkdown(formatCodexModel(room.codexModel ?? defaultCodexModel))}`,
    `Approval policy: ${escapeMarkdown(approvalPolicyLabels[room.approvalPolicy])}`,
    "",
    "## Transcript",
    messages.map(buildMessageMarkdown).join("\n\n---\n\n") || "_No loaded messages._"
  ]);
}

export function buildMessageMarkdown(message: MarkdownChatMessage): string {
  const attachments = message.attachments?.length
    ? [
        "",
        "Attachments:",
        ...message.attachments.map((attachment) => `- \`${escapeBackticks(attachment.name)}\` (${formatAttachmentMeta(attachment)})`)
      ]
    : [];
  const reactions = message.reactions?.length
    ? [
        "",
        "Reactions:",
        ...message.reactions.map((reaction) =>
          `- ${escapeMarkdown(reaction.emoji)} ${reaction.reactors.map((reactor) => escapeMarkdown(reactor.name)).join(", ")}`
        )
      ]
    : [];
  return compactMarkdown([
    `### ${escapeMarkdown(message.author)} (${message.role}, ${escapeMarkdown(message.time)})`,
    "",
    normalizeMarkdownText(message.body),
    ...attachments,
    ...reactions
  ]);
}

export function buildCodexOutputMarkdown(
  room: RoomRecord,
  codexMessage: MarkdownChatMessage,
  messages: MarkdownChatMessage[]
): string {
  const messageIndex = messages.findIndex((message) => message.id === codexMessage.id);
  const previousCodexIndex = messages
    .slice(0, Math.max(messageIndex, 0))
    .map((message, index) => ({ message, index }))
    .filter((item) => item.message.role === "codex")
    .at(-1)?.index ?? -1;
  const turnContext = messages.slice(previousCodexIndex + 1, messageIndex).filter((message) => message.role !== "codex");

  return compactMarkdown([
    `# ${escapeMarkdown(room.name)} Codex Turn Output`,
    "",
    `Project: \`${escapeBackticks(room.projectPath)}\``,
    `Model: ${escapeMarkdown(formatCodexModel(room.codexModel ?? defaultCodexModel))}`,
    `Time: ${escapeMarkdown(codexMessage.time)}`,
    "",
    "## Room Context",
    turnContext.map((message) => `- **${escapeMarkdown(message.author)}**: ${normalizeMarkdownText(message.body)}`).join("\n") ||
      "- No room messages captured before this Codex turn.",
    "",
    "## Codex Output",
    "",
    normalizeMarkdownText(codexMessage.body) || "_No Codex output captured._"
  ]);
}

export function buildProjectMarkdown(
  roomName: string,
  projectPath: string,
  files: Array<{ path: string; status: string; added?: number; removed?: number }>,
  selectedFile: ProjectFileContent | null,
  selectedDiff: GitDiffResult | null,
  sensitiveRisks: string[] = []
): string {
  const changedFiles = files.map((file) => {
    const churn = typeof file.added === "number" || typeof file.removed === "number"
      ? ` (+${file.added ?? 0}/-${file.removed ?? 0})`
      : "";
    return `- \`${escapeBackticks(file.path)}\` (${escapeMarkdown(file.status)})${churn}`;
  });

  return compactMarkdown([
    `# ${escapeMarkdown(roomName)} Project Context`,
    "",
    `Project: \`${escapeBackticks(projectPath)}\``,
    "",
    ...sensitiveWarningBlock(sensitiveRisks),
    "",
    "## Changed Files",
    changedFiles.join("\n") || "- No changed files reported.",
    "",
    ...(selectedDiff?.diff.trim()
      ? [
          `## Diff: ${escapeMarkdown(selectedDiff.path)}`,
          "",
          fencedCode(selectedDiff.diff, "diff"),
          ""
        ]
      : []),
    ...(selectedFile
      ? [
          `## ${escapeMarkdown(selectedFile.path)}`,
          "",
          selectedFile.truncated ? `> Preview truncated at ${formatBytes(encodedBytes(selectedFile.content))}.` : "",
          "",
          fencedCode(selectedFile.content)
        ]
      : ["## Selected File", "", "No file selected."])
  ]);
}

export function buildDiffSummaryMarkdown(
  room: RoomRecord,
  branch: string,
  files: Array<{ path: string; status: string; added?: number; removed?: number }>,
  selectedDiff: GitDiffResult | null,
  sensitiveRisks: string[] = []
): string {
  const changedFiles = files.map((file) => {
    const added = file.added ?? 0;
    const removed = file.removed ?? 0;
    return `- \`${escapeBackticks(file.path)}\` (${escapeMarkdown(file.status)}, +${added}/-${removed})`;
  });

  return compactMarkdown([
    `# ${escapeMarkdown(room.name)} Diff Summary`,
    "",
    `Project: \`${escapeBackticks(room.projectPath)}\``,
    `Branch: ${escapeMarkdown(branch)}`,
    "",
    ...sensitiveWarningBlock(sensitiveRisks),
    "",
    "## Changed Files",
    changedFiles.join("\n") || "- No changed files reported.",
    "",
    ...(selectedDiff?.diff.trim()
      ? [
          `## Selected Diff: ${escapeMarkdown(selectedDiff.path)}`,
          "",
          fencedCode(selectedDiff.diff, "diff")
        ]
      : ["## Selected Diff", "", "No changed file selected."])
  ]);
}

export function buildTerminalMarkdown(
  room: RoomRecord,
  terminal: TerminalSnapshot | null,
  lines: Array<{ stream: string; text: string }>,
  sensitiveRisks: string[] = []
): string {
  const title = terminal ? terminal.name : "Room terminal log";
  const output = lines.length
    ? lines.map((line) => line.stream === "stdout" ? line.text : `[${line.stream}] ${line.text}`).join("\n")
    : "(No terminal output.)";
  return compactMarkdown([
    `# ${escapeMarkdown(room.name)} Terminal Output`,
    "",
    `Project: \`${escapeBackticks(room.projectPath)}\``,
    `Terminal: ${escapeMarkdown(title)}`,
    ...(terminal
      ? [
          `Command: \`${escapeBackticks(terminal.command)}\``,
          `Working directory: \`${escapeBackticks(terminal.cwd)}\``,
          `Status: ${terminal.running ? "running" : terminal.exitStatus ?? "done"}`
        ]
      : []),
    "",
    ...sensitiveWarningBlock(sensitiveRisks),
    "",
    fencedCode(output, "text")
  ]);
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|-])/g, "\\$1");
}

export function fencedCode(value: string, language = ""): string {
  const longestFence = value.match(/`{3,}/g)?.reduce((longest, fence) => Math.max(longest, fence.length), 2) ?? 2;
  const fence = "`".repeat(longestFence + 1);
  return [`${fence}${language}`, value, fence].join("\n");
}

function normalizeMarkdownText(value: string): string {
  return value || "_No content._";
}

function escapeBackticks(value: string): string {
  return value.replace(/`/g, "\\`");
}

function formatHostStatus(room: RoomRecord): string {
  if (room.hostStatus === "active") return `Hosted by ${room.host}`;
  if (room.hostStatus === "handoff") return `Handoff from ${room.host}`;
  return "No active host";
}

function formatCodexModel(model: string): string {
  return codexModelOptions.find((option) => option.id === model)?.label ?? model;
}

function formatAttachmentMeta(attachment: MarkdownChatAttachment): string {
  const blobNote = attachment.blobId ? `, encrypted blob${attachment.blobBytes ? ` preview ${formatBytes(attachment.blobBytes)}` : ""}` : "";
  return `${attachment.type}, ${formatBytes(attachment.size)}${blobNote}`;
}

function sensitiveWarningBlock(risks: string[]): string[] {
  const uniqueRisks = Array.from(new Set(risks)).filter(Boolean);
  if (uniqueRisks.length === 0) return [];
  return [
    "> [!WARNING]",
    `> This export may contain sensitive material: ${uniqueRisks.map(escapeMarkdown).join(", ")}. Review before sharing outside the room.`
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function compactMarkdown(parts: string[]): string {
  return parts.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd();
}
