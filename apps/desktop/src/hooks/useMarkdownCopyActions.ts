import type { RoomRecord } from "@multaiplayer/protocol";
import type {
  GitDiffResult,
  GitStatusSummary,
  ProjectFileContent,
  TerminalLine,
  TerminalSnapshot
} from "../lib/localBackend";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  buildCodexOutputMarkdown,
  buildDiffSummaryMarkdown,
  buildMessageMarkdown,
  buildProjectMarkdown,
  buildPullRequestBody,
  buildRoomMarkdown,
  buildSelectedMessagesMarkdown,
  buildTerminalMarkdown
} from "../lib/markdownExport";
import { detectSecretRisks } from "../lib/secretRisks";
import type { ChatMessage, MarkdownCopyFallback } from "../types";

interface UseMarkdownCopyActionsOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  localWorkspaceMessage: string;
  selectedRoom: RoomRecord;
  teams: Array<{ id: string; name: string }>;
  messages: ChatMessage[];
  selectedMessages: ChatMessage[];
  gitStatus: GitStatusSummary | null;
  selectedFile: ProjectFileContent | null;
  selectedDiff: GitDiffResult | null;
  selectedFileRisks: string[];
  selectedTerminal: TerminalSnapshot | null;
  terminalLines: string[];
  terminalRisks: string[];
  setMarkdownCopyFallbackForRoom: (roomId: string, fallback: MarkdownCopyFallback | null) => void;
  setSelectedChatMessage: (message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setSelectedFileMessage: (message: string | null) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
  setSelectedTerminalError: (message: string | null) => void;
  setTerminalErrorForRoom: (roomId: string, message: string | null) => void;
  setSelectedGitWorkflowMessage: (message: string | null) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
}

export function useMarkdownCopyActions({
  hasSelectedRoom,
  canReadLocalWorkspace,
  localWorkspaceMessage,
  selectedRoom,
  teams,
  messages,
  selectedMessages,
  gitStatus,
  selectedFile,
  selectedDiff,
  selectedFileRisks,
  selectedTerminal,
  terminalLines,
  terminalRisks,
  setMarkdownCopyFallbackForRoom,
  setSelectedChatMessage,
  setChatMessageForRoom,
  setSelectedFileMessage,
  setFileMessageForRoom,
  setSelectedTerminalError,
  setTerminalErrorForRoom,
  setSelectedGitWorkflowMessage,
  setGitWorkflowMessageForRoom
}: UseMarkdownCopyActionsOptions) {
  async function copyMarkdownWithFallback(
    title: string,
    markdown: string,
    onMessage: (message: string) => void,
    roomId = selectedRoom.id
  ) {
    const result = await copyTextToClipboard(markdown);
    if (result.status === "copied") {
      setMarkdownCopyFallbackForRoom(roomId, null);
      onMessage(`Copied ${title} as Markdown.`);
      return;
    }
    setMarkdownCopyFallbackForRoom(roomId, { title, markdown });
    onMessage(`${title} Markdown is ready below because copying was blocked.`);
  }

  async function copyProjectMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before copying project context.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildProjectMarkdown(
      selectedRoom.name,
      selectedRoom.projectPath,
      gitStatus?.files ?? [],
      selectedFile,
      selectedDiff,
      selectedFile
        ? selectedFileRisks
        : selectedDiff
          ? detectSecretRisks(selectedDiff.diff, selectedDiff.path)
          : []
    );
    await copyMarkdownWithFallback("project context", markdown, (message) => setFileMessageForRoom(roomId, message), roomId);
  }

  async function copyRoomMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before copying room chat.");
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildRoomMarkdown(selectedRoom, teams.find((team) => team.id === selectedRoom.teamId)?.name ?? "Unknown team", messages);
    await copyMarkdownWithFallback("room chat", markdown, (message) => setChatMessageForRoom(roomId, message), roomId);
  }

  async function copySelectedMessagesMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before copying selected messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (selectedMessages.length === 0) {
      setChatMessageForRoom(roomId, "Select one or more messages to copy.");
      return;
    }
    const markdown = buildSelectedMessagesMarkdown(selectedRoom, selectedMessages);
    await copyMarkdownWithFallback("selected messages", markdown, (message) => setChatMessageForRoom(roomId, message), roomId);
  }

  async function copyMessageMarkdown(message: ChatMessage) {
    const roomId = selectedRoom.id;
    const markdown = buildMessageMarkdown(message);
    await copyMarkdownWithFallback("message", markdown, (copyMessage) => setChatMessageForRoom(roomId, copyMessage), roomId);
  }

  async function copyCodexOutputMarkdown(message: ChatMessage) {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before copying Codex output.");
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildCodexOutputMarkdown(selectedRoom, message, messages);
    await copyMarkdownWithFallback("Codex turn output", markdown, (copyMessage) => setChatMessageForRoom(roomId, copyMessage), roomId);
  }

  async function copyTerminalMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before copying terminal output.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const lines: TerminalLine[] = selectedTerminal?.lines ?? terminalLines.map((line) => ({ stream: "system", text: line }));
    const markdown = buildTerminalMarkdown(selectedRoom, selectedTerminal, lines, terminalRisks);
    await copyMarkdownWithFallback("terminal output", markdown, (message) => setTerminalErrorForRoom(roomId, message), roomId);
  }

  async function copyDiffSummaryMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before copying a diff summary.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildDiffSummaryMarkdown(
      selectedRoom,
      gitStatus?.branch ?? "unknown",
      gitStatus?.files ?? [],
      selectedDiff,
      selectedDiff ? detectSecretRisks(selectedDiff.diff, selectedDiff.path) : []
    );
    await copyMarkdownWithFallback("diff summary", markdown, (message) => setFileMessageForRoom(roomId, message), roomId);
  }

  async function copyPullRequestDraftMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedGitWorkflowMessage("Create or join a room before copying a PR draft.");
      return;
    }
    const roomId = selectedRoom.id;
    if (!canReadLocalWorkspace) {
      setGitWorkflowMessageForRoom(roomId, localWorkspaceMessage);
      return;
    }
    const markdown = buildPullRequestBody(messages, gitStatus?.files ?? []);
    await copyMarkdownWithFallback("PR description draft", markdown, (message) => setGitWorkflowMessageForRoom(roomId, message), roomId);
  }

  return {
    copyMarkdownWithFallback,
    copyProjectMarkdown,
    copyRoomMarkdown,
    copySelectedMessagesMarkdown,
    copyMessageMarkdown,
    copyCodexOutputMarkdown,
    copyTerminalMarkdown,
    copyDiffSummaryMarkdown,
    copyPullRequestDraftMarkdown
  };
}
