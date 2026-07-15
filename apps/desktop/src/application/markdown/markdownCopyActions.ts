import type { TerminalLine } from "../../lib/platform/localBackend";
import { copyTextToClipboard } from "../../lib/core/clipboard";
import {
  buildCodexOutputMarkdown,
  buildDiffSummaryMarkdown,
  buildMessageMarkdown,
  buildProjectMarkdown,
  buildPullRequestBody,
  buildRoomMarkdown,
  buildSelectedMessagesMarkdown,
  buildTerminalMarkdown
} from "../../lib/files/markdownExport";
import { detectSecretRisks } from "../../lib/security/secretRisks";
import type { ChatMessage } from "../../types";
import { useAppStore } from "../../store/appStore";
import { currentSelectedRoom, currentSelectedRoomContext } from "../workspace/selectedWorkspace";

export function createMarkdownCopyActions() {
  async function copyMarkdownWithFallback(
    title: string,
    markdown: string,
    onMessage: (message: string) => void,
    roomId = useAppStore.getState().selectedRoomId
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setFileMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying project context."
        );
      return;
    }
    if (!currentSelectedRoomContext()?.canReadLocalWorkspace) {
      useAppStore
        .getState()
        .setFileMessageForRoom(
          selectedRoom.id,
          currentSelectedRoomContext()?.localWorkspaceMessage ?? "Workspace unavailable."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const store = useAppStore.getState();
    const gitStatus = store.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null;
    const selectedFile = store.filePanelByRoom[roomId]?.selectedFile ?? null;
    const selectedDiff = store.filePanelByRoom[roomId]?.selectedDiff ?? null;
    const markdown = buildProjectMarkdown(
      selectedRoom.name,
      selectedRoom.projectPath,
      gitStatus?.files ?? [],
      selectedFile,
      selectedDiff,
      selectedFile
        ? detectSecretRisks(selectedFile.content, selectedFile.path)
        : selectedDiff
          ? detectSecretRisks(selectedDiff.diff, selectedDiff.path)
          : []
    );
    await copyMarkdownWithFallback(
      "project context",
      markdown,
      (message) => useAppStore.getState().setFileMessageForRoom(roomId, message),
      roomId
    );
  }

  async function copyRoomMarkdown() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setChatMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying room chat."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const messages = useAppStore.getState().messagesByRoom[roomId] ?? [];
    const markdown = buildRoomMarkdown(
      selectedRoom,
      useAppStore.getState().teams.find((team) => team.id === selectedRoom.teamId)?.name ?? "Unknown team",
      messages
    );
    await copyMarkdownWithFallback(
      "room chat",
      markdown,
      (message) => useAppStore.getState().setChatMessageForRoom(roomId, message),
      roomId
    );
  }

  async function copySelectedMessagesMarkdown() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setChatMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying selected messages."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const store = useAppStore.getState();
    const messages = store.messagesByRoom[roomId] ?? [];
    const selectedMessageIds = store.roomChatByRoom[roomId]?.selectedMessageIds ?? [];
    const selectedMessages = messages.filter((message) => selectedMessageIds.includes(message.id));
    if (selectedMessages.length === 0) {
      useAppStore.getState().setChatMessageForRoom(roomId, "Select one or more messages to copy.");
      return;
    }
    const markdown = buildSelectedMessagesMarkdown(selectedRoom, selectedMessages);
    await copyMarkdownWithFallback(
      "selected messages",
      markdown,
      (message) => useAppStore.getState().setChatMessageForRoom(roomId, message),
      roomId
    );
  }

  async function copyMessageMarkdown(message: ChatMessage) {
    const roomId = useAppStore.getState().selectedRoomId;
    const markdown = buildMessageMarkdown(message);
    await copyMarkdownWithFallback(
      "message",
      markdown,
      (copyMessage) => useAppStore.getState().setChatMessageForRoom(roomId, copyMessage),
      roomId
    );
  }

  async function copyCodexOutputMarkdown(message: ChatMessage) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setChatMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying Codex output."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const messages = useAppStore.getState().messagesByRoom[roomId] ?? [];
    const markdown = buildCodexOutputMarkdown(selectedRoom, message, messages);
    await copyMarkdownWithFallback(
      "Codex turn output",
      markdown,
      (copyMessage) => useAppStore.getState().setChatMessageForRoom(roomId, copyMessage),
      roomId
    );
  }

  async function copyTerminalMarkdown() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setTerminalErrorForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying terminal output."
        );
      return;
    }
    if (!currentSelectedRoomContext()?.canReadLocalWorkspace) {
      useAppStore
        .getState()
        .setTerminalErrorForRoom(
          selectedRoom.id,
          currentSelectedRoomContext()?.localWorkspaceMessage ?? "Workspace unavailable."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const store = useAppStore.getState();
    const selectedTerminalId = store.terminalRuntimeByRoom[roomId]?.selectedTerminalId;
    const selectedTerminal = store.terminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
    const terminalLines = store.terminalRuntimeByRoom[roomId]?.lines ?? [];
    const lines: TerminalLine[] =
      selectedTerminal?.lines ?? terminalLines.map((line) => ({ stream: "system", text: line }));
    const terminalRisks = detectSecretRisks(lines.map((line) => line.text).join("\n"));
    const markdown = buildTerminalMarkdown(selectedRoom, selectedTerminal, lines, terminalRisks);
    await copyMarkdownWithFallback(
      "terminal output",
      markdown,
      (message) => useAppStore.getState().setTerminalErrorForRoom(roomId, message),
      roomId
    );
  }

  async function copyDiffSummaryMarkdown() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setFileMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying a diff summary."
        );
      return;
    }
    if (!currentSelectedRoomContext()?.canReadLocalWorkspace) {
      useAppStore
        .getState()
        .setFileMessageForRoom(
          selectedRoom.id,
          currentSelectedRoomContext()?.localWorkspaceMessage ?? "Workspace unavailable."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const store = useAppStore.getState();
    const gitStatus = store.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null;
    const selectedDiff = store.filePanelByRoom[roomId]?.selectedDiff ?? null;
    const markdown = buildDiffSummaryMarkdown(
      selectedRoom,
      gitStatus?.branch ?? "unknown",
      gitStatus?.files ?? [],
      selectedDiff,
      selectedDiff ? detectSecretRisks(selectedDiff.diff, selectedDiff.path) : []
    );
    await copyMarkdownWithFallback(
      "diff summary",
      markdown,
      (message) => useAppStore.getState().setFileMessageForRoom(roomId, message),
      roomId
    );
  }

  async function copyPullRequestDraftMarkdown() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setGitWorkflowMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before copying a PR draft."
        );
      return;
    }
    const roomId = selectedRoom.id;
    if (!currentSelectedRoomContext()?.canReadLocalWorkspace) {
      useAppStore
        .getState()
        .setGitWorkflowMessageForRoom(
          roomId,
          currentSelectedRoomContext()?.localWorkspaceMessage ?? "Workspace unavailable."
        );
      return;
    }
    const store = useAppStore.getState();
    const messages = store.messagesByRoom[roomId] ?? [];
    const gitStatus = store.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null;
    const markdown = buildPullRequestBody(messages, gitStatus?.files ?? []);
    await copyMarkdownWithFallback(
      "PR description draft",
      markdown,
      (message) => useAppStore.getState().setGitWorkflowMessageForRoom(roomId, message),
      roomId
    );
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
