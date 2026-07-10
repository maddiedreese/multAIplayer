import type { RoomRecord } from "@multaiplayer/protocol";
import type {
  GitDiffResult,
  GitStatusSummary,
  ProjectFileContent,
  TerminalLine,
  TerminalSnapshot
} from "./localBackend";
import { copyTextToClipboard } from "./clipboard";
import {
  buildCodexOutputMarkdown,
  buildDiffSummaryMarkdown,
  buildMessageMarkdown,
  buildProjectMarkdown,
  buildPullRequestBody,
  buildRoomMarkdown,
  buildSelectedMessagesMarkdown,
  buildTerminalMarkdown
} from "./markdownExport";
import { detectSecretRisks } from "./secretRisks";
import type { ChatMessage } from "../types";
import { useAppStore } from "../store/appStore";

interface MarkdownCopyActionsOptions {
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
}

export function createMarkdownCopyActions({
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
  terminalRisks
}: MarkdownCopyActionsOptions) {
  async function copyMarkdownWithFallback(
    title: string,
    markdown: string,
    onMessage: (message: string) => void,
    roomId = selectedRoom.id
  ) {
    const result = await copyTextToClipboard(markdown);
    if (result.status === "copied") {
      useAppStore.getState().setMarkdownCopyFallbackForRoom(roomId, null);
      onMessage(`Copied ${title} as Markdown.`);
      return;
    }
    useAppStore.getState().setMarkdownCopyFallbackForRoom(roomId, { title, markdown });
    onMessage(`${title} Markdown is ready below because copying was blocked.`);
  }

  async function copyProjectMarkdown() {
    if (!hasSelectedRoom) {
      useAppStore.getState().setFileMessageForRoom(selectedRoom.id, "Create or join a room before copying project context.");
      return;
    }
    if (!canReadLocalWorkspace) {
      useAppStore.getState().setFileMessageForRoom(selectedRoom.id, localWorkspaceMessage);
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
    await copyMarkdownWithFallback("project context", markdown, (message) => useAppStore.getState().setFileMessageForRoom(roomId, message), roomId);
  }

  async function copyRoomMarkdown() {
    if (!hasSelectedRoom) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, "Create or join a room before copying room chat.");
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildRoomMarkdown(selectedRoom, teams.find((team) => team.id === selectedRoom.teamId)?.name ?? "Unknown team", messages);
    await copyMarkdownWithFallback("room chat", markdown, (message) => useAppStore.getState().setChatMessageForRoom(roomId, message), roomId);
  }

  async function copySelectedMessagesMarkdown() {
    if (!hasSelectedRoom) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, "Create or join a room before copying selected messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (selectedMessages.length === 0) {
      useAppStore.getState().setChatMessageForRoom(roomId, "Select one or more messages to copy.");
      return;
    }
    const markdown = buildSelectedMessagesMarkdown(selectedRoom, selectedMessages);
    await copyMarkdownWithFallback("selected messages", markdown, (message) => useAppStore.getState().setChatMessageForRoom(roomId, message), roomId);
  }

  async function copyMessageMarkdown(message: ChatMessage) {
    const roomId = selectedRoom.id;
    const markdown = buildMessageMarkdown(message);
    await copyMarkdownWithFallback("message", markdown, (copyMessage) => useAppStore.getState().setChatMessageForRoom(roomId, copyMessage), roomId);
  }

  async function copyCodexOutputMarkdown(message: ChatMessage) {
    if (!hasSelectedRoom) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, "Create or join a room before copying Codex output.");
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildCodexOutputMarkdown(selectedRoom, message, messages);
    await copyMarkdownWithFallback("Codex turn output", markdown, (copyMessage) => useAppStore.getState().setChatMessageForRoom(roomId, copyMessage), roomId);
  }

  async function copyTerminalMarkdown() {
    if (!hasSelectedRoom) {
      useAppStore.getState().setTerminalErrorForRoom(selectedRoom.id, "Create or join a room before copying terminal output.");
      return;
    }
    if (!canReadLocalWorkspace) {
      useAppStore.getState().setTerminalErrorForRoom(selectedRoom.id, localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const lines: TerminalLine[] = selectedTerminal?.lines ?? terminalLines.map((line) => ({ stream: "system", text: line }));
    const markdown = buildTerminalMarkdown(selectedRoom, selectedTerminal, lines, terminalRisks);
    await copyMarkdownWithFallback("terminal output", markdown, (message) => useAppStore.getState().setTerminalErrorForRoom(roomId, message), roomId);
  }

  async function copyDiffSummaryMarkdown() {
    if (!hasSelectedRoom) {
      useAppStore.getState().setFileMessageForRoom(selectedRoom.id, "Create or join a room before copying a diff summary.");
      return;
    }
    if (!canReadLocalWorkspace) {
      useAppStore.getState().setFileMessageForRoom(selectedRoom.id, localWorkspaceMessage);
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
    await copyMarkdownWithFallback("diff summary", markdown, (message) => useAppStore.getState().setFileMessageForRoom(roomId, message), roomId);
  }

  async function copyPullRequestDraftMarkdown() {
    if (!hasSelectedRoom) {
      useAppStore.getState().setGitWorkflowMessageForRoom(selectedRoom.id, "Create or join a room before copying a PR draft.");
      return;
    }
    const roomId = selectedRoom.id;
    if (!canReadLocalWorkspace) {
      useAppStore.getState().setGitWorkflowMessageForRoom(roomId, localWorkspaceMessage);
      return;
    }
    const markdown = buildPullRequestBody(messages, gitStatus?.files ?? []);
    await copyMarkdownWithFallback("PR description draft", markdown, (message) => useAppStore.getState().setGitWorkflowMessageForRoom(roomId, message), roomId);
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
