import type { ProjectFileContent, TerminalSnapshot } from "../lib/platform/localBackend";
import type { CodexRoomEvent, TerminalCommandRequest } from "../types";
import { decideAttachmentReview, reviewedAttachmentPathForScope } from "../lib/files/attachmentPolicy";
import { detectSecretRisks } from "../lib/security/secretRisks";
import {
  buildCodexEventRows,
  buildTerminalOutputLines,
  buildTerminalRequestRows
} from "../presentation/terminal/terminalDisplayRows";

interface UseFileTerminalDisplayOptions {
  selectedFile: ProjectFileContent | null;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
  sensitiveAttachmentReviewKey: string | null;
  selectedTerminal: TerminalSnapshot | null;
  terminalLines: string[];
  terminalRequests: TerminalCommandRequest[];
  codexEvents: CodexRoomEvent[];
}

export function useFileTerminalDisplay({
  selectedFile,
  selectedRoomId,
  selectedRoomProjectPath,
  sensitiveAttachmentReviewKey,
  selectedTerminal,
  terminalLines,
  terminalRequests,
  codexEvents
}: UseFileTerminalDisplayOptions) {
  const selectedAttachmentReview = selectedFile
    ? decideAttachmentReview(
        selectedFile.content,
        selectedFile.path,
        reviewedAttachmentPathForScope(
          sensitiveAttachmentReviewKey,
          selectedRoomId,
          selectedRoomProjectPath,
          selectedFile.path
        )
      )
    : null;
  const selectedFileRisks = selectedAttachmentReview?.risks ?? [];
  const selectedFileNeedsAttachmentReview = Boolean(selectedAttachmentReview?.requiresReview);
  const selectedSensitiveFileReviewed = Boolean(selectedAttachmentReview?.reviewed);
  const terminalRisks = selectedTerminal
    ? detectSecretRisks(selectedTerminal.lines.map((line) => line.text).join("\n"))
    : detectSecretRisks(terminalLines.join("\n"));
  const terminalOutputLines = buildTerminalOutputLines(selectedTerminal?.lines ?? terminalLines);
  const terminalRequestRows = buildTerminalRequestRows(terminalRequests);
  const codexEventRows = buildCodexEventRows(codexEvents);

  return {
    selectedAttachmentReview,
    selectedFileRisks,
    selectedFileNeedsAttachmentReview,
    selectedSensitiveFileReviewed,
    terminalRisks,
    terminalOutputLines,
    terminalRequestRows,
    codexEventRows
  };
}
