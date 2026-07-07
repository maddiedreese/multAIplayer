import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  maxEmbeddedAttachmentBytes,
  maxEmbeddedAttachmentBytesPerMessage
} from "@multaiplayer/protocol";
import { decryptJson, encryptJson } from "@multaiplayer/crypto";
import { createAttachmentBlob, loadAttachmentBlob } from "../lib/workspaceClient";
import { loadOrCreateRoomSecret } from "../lib/localHistory";
import { getGitDiff, readProjectFile, writeProjectFile, type GitDiffResult, type ProjectFileContent } from "../lib/localBackend";
import { resolveFilePreviewTab, type FilePreviewTab } from "../lib/filePreview";
import {
  attachmentReviewMessage,
  attachmentReviewScopeKey,
  decideAttachmentReview,
  reviewedAttachmentPathForScope
} from "../lib/attachmentPolicy";
import { canStageRoomChatAttachment, roomChatGateMessage } from "../lib/chatPolicy";
import { roomLockMessage } from "../lib/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { isAttachmentBlobContent } from "../lib/localRoomHistoryPayload";
import {
  attachmentTypeFromName,
  canOpenProjectAttachment,
  embeddedAttachmentBytes,
  encodedBytes,
  validatePendingAttachments
} from "../lib/appFormatters";
import type { ChatAttachment } from "../types";
import { useAppStore } from "../store/appStore";

interface UseFileActionsOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  localWorkspaceMessage: string;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  selectedFile: ProjectFileContent | null;
  pendingAttachmentsByRoom: Record<string, ChatAttachment[]>;
  sensitiveAttachmentReviewKey: string | null;
  setSensitiveAttachmentReviewKey: Dispatch<SetStateAction<string | null>>;
  reportRoomFileActionInFlight: (roomId: string) => boolean;
  setFileBusyForRoom: (roomId: string, busy: boolean) => void;
  setSelectedFileForRoom: (roomId: string, file: ProjectFileContent | null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: GitDiffResult | null) => void;
  setFilePreviewTabForRoom: (roomId: string, tab: FilePreviewTab) => void;
  setSelectedFileMessage: (message: string | null) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingAttachmentsForRoom: (
    roomId: string,
    updater: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])
  ) => void;
}

export function useFileActions({
  hasSelectedRoom,
  canReadLocalWorkspace,
  localWorkspaceMessage,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  selectedFile,
  pendingAttachmentsByRoom,
  sensitiveAttachmentReviewKey,
  setSensitiveAttachmentReviewKey,
  reportRoomFileActionInFlight,
  setFileBusyForRoom,
  setSelectedFileForRoom,
  setSelectedDiffForRoom,
  setFilePreviewTabForRoom,
  setSelectedFileMessage,
  setFileMessageForRoom,
  setPendingAttachmentsForRoom
}: UseFileActionsOptions) {
  const setInspectorTabForRoom = useAppStore((state) => state.setInspectorTabForRoom);

  async function openProjectFile(path: string, preferredPreview: FilePreviewTab = "file") {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before opening project files.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    if (reportRoomFileActionInFlight(room.id)) return;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const [fileResult, diff] = await Promise.all([
        readProjectFile(room.projectPath, path).then((file) => ({ file, error: null })).catch((error) => ({ file: null, error })),
        getGitDiff(room.projectPath, path).catch(() => null)
      ]);
      if (selectedRoomIdRef.current !== room.id) return;
      if (!fileResult.file && !(preferredPreview === "diff" && diff?.diff.trim())) {
        throw fileResult.error;
      }
      setSelectedFileForRoom(room.id, fileResult.file);
      setSelectedDiffForRoom(room.id, diff);
      setFilePreviewTabForRoom(room.id, resolveFilePreviewTab(preferredPreview, Boolean(diff?.diff.trim())));
      setSensitiveAttachmentReviewKey(null);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) setFileMessageForRoom(room.id, String(error));
    } finally {
      setFileBusyForRoom(room.id, false);
    }
  }

  async function attachSelectedFileToMessage() {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before attaching project files.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    if (!canStageRoomChatAttachment(selectedRoom, isSelectedRoomLocked)) {
      setSelectedFileMessage(roomChatGateMessage(selectedRoom, isSelectedRoomLocked));
      return;
    }
    if (!selectedFile) {
      setSelectedFileMessage("Select a project file before attaching it to the room.");
      return;
    }
    const roomId = selectedRoom.id;
    const teamId = selectedRoom.teamId;
    const fileToAttach = selectedFile;
    const roomPendingAttachments = pendingAttachmentsByRoom[roomId] ?? [];
    const review = decideAttachmentReview(
      fileToAttach.content,
      fileToAttach.path,
      reviewedAttachmentPathForScope(sensitiveAttachmentReviewKey, roomId, selectedRoom.projectPath, fileToAttach.path)
    );
    if (!review.canAttach) {
      setSensitiveAttachmentReviewKey(attachmentReviewScopeKey(roomId, selectedRoom.projectPath, fileToAttach.path));
      setFileMessageForRoom(roomId, attachmentReviewMessage(fileToAttach.path, review.risks));
      return;
    }
    const attachment: ChatAttachment = {
      id: crypto.randomUUID(),
      name: fileToAttach.path,
      type: attachmentTypeFromName(fileToAttach.path),
      size: fileToAttach.size,
      content: fileToAttach.content,
      truncated: fileToAttach.truncated
    };
    if (roomPendingAttachments.some((item) => item.name === attachment.name)) {
      setFileMessageForRoom(roomId, `${attachment.name} is already attached to the next room message.`);
      return;
    }
    const selectedContentBytes = encodedBytes(attachment.content ?? "");
    const shouldUploadBlob = selectedContentBytes > maxEmbeddedAttachmentBytes ||
      embeddedAttachmentBytes(roomPendingAttachments) + selectedContentBytes > maxEmbeddedAttachmentBytesPerMessage;
    if (shouldUploadBlob) {
      if (reportRoomFileActionInFlight(roomId)) return;
      try {
        setFileBusyForRoom(roomId, true);
        const secret = await loadOrCreateRoomSecret(roomId);
        const blob = await createAttachmentBlob({
          teamId,
          roomId,
          name: fileToAttach.path,
          type: attachment.type,
          size: fileToAttach.size,
          payload: await encryptJson({
            name: fileToAttach.path,
            type: attachment.type,
            size: fileToAttach.size,
            content: fileToAttach.content,
            truncated: fileToAttach.truncated
          }, secret)
        });
        attachment.content = undefined;
        attachment.blobId = blob.id;
        attachment.blobBytes = selectedContentBytes;
        attachment.truncated = fileToAttach.truncated || selectedContentBytes > maxEmbeddedAttachmentBytes;
      } catch (error) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setFileMessageForRoom(roomId, `Could not upload encrypted attachment blob: ${String(error)}`);
        }
        return;
      } finally {
        setFileBusyForRoom(roomId, false);
      }
    }
    setPendingAttachmentsForRoom(roomId, (current) => {
      if (current.some((item) => item.name === attachment.name)) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setFileMessageForRoom(roomId, `${attachment.name} is already attached to the next room message.`);
        }
        return current;
      }
      const next = [...current, attachment];
      const validationError = validatePendingAttachments(next);
      if (validationError) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setFileMessageForRoom(roomId, validationError);
        return current;
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSensitiveAttachmentReviewKey(null);
        setFileMessageForRoom(roomId, attachment.blobId
          ? `Attached ${fileToAttach.path} as an encrypted blob for the next room message.`
          : `Attached ${fileToAttach.path} to the next room message.`);
      }
      return next;
    });
  }

  async function saveSelectedFileContent(content: string) {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before editing project files.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!selectedFile) {
      setSelectedFileMessage("Select a project file before saving changes.");
      return;
    }
    const room = selectedRoom;
    const path = selectedFile.path;
    if (reportRoomFileActionInFlight(room.id)) return;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const saved = await writeProjectFile(room.projectPath, path, content);
      const [file, diff] = await Promise.all([
        readProjectFile(room.projectPath, path),
        getGitDiff(room.projectPath, path).catch(() => null)
      ]);
      if (selectedRoomIdRef.current !== room.id) return;
      setSelectedFileForRoom(room.id, {
        ...file,
        path: saved.path,
        size: saved.size
      });
      setSelectedDiffForRoom(room.id, diff);
      setFilePreviewTabForRoom(room.id, "file");
      setFileMessageForRoom(room.id, `Saved ${path}.`);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) setFileMessageForRoom(room.id, String(error));
    } finally {
      setFileBusyForRoom(room.id, false);
    }
  }

  function removePendingAttachment(attachmentId: string) {
    setPendingAttachmentsForRoom(selectedRoom.id, (current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
  }

  async function openEncryptedAttachmentBlob(attachment: ChatAttachment) {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before opening encrypted attachments.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const room = selectedRoom;
    if (!attachment.blobId) {
      if (attachment.content) {
        if (selectedRoomIdRef.current !== room.id) return;
        setSelectedDiffForRoom(room.id, null);
        setSelectedFileForRoom(room.id, {
          path: attachment.name,
          size: attachment.size,
          truncated: Boolean(attachment.truncated),
          content: attachment.content
        });
        setInspectorTabForRoom(room.id, "files");
        setFileMessageForRoom(room.id, `Opened inline attachment ${attachment.name}.`);
      } else if (canOpenProjectAttachment(attachment)) {
        await openProjectFile(attachment.name, "file");
      }
      return;
    }
    if (reportRoomFileActionInFlight(room.id)) return;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const [blob, secret] = await Promise.all([
        loadAttachmentBlob(attachment.blobId, room.teamId, room.id),
        loadOrCreateRoomSecret(room.id)
      ]);
      if (blob.roomId !== room.id || blob.teamId !== room.teamId) {
        throw new Error("Attachment blob belongs to a different room.");
      }
      const decrypted = await decryptJson<unknown>(blob.payload, secret);
      if (!isAttachmentBlobContent(decrypted)) {
        throw new Error("Attachment blob payload was not a supported file preview.");
      }
      if (selectedRoomIdRef.current !== room.id) return;
      setSelectedDiffForRoom(room.id, null);
      setSelectedFileForRoom(room.id, {
        path: decrypted.name || attachment.name,
        size: decrypted.size ?? attachment.size,
        truncated: Boolean(decrypted.truncated),
        content: decrypted.content
      });
      setInspectorTabForRoom(room.id, "files");
      setFileMessageForRoom(room.id, `Opened encrypted attachment ${decrypted.name || attachment.name}.`);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) {
        setFileMessageForRoom(room.id, `Could not open encrypted attachment: ${String(error)}`);
      }
    } finally {
      setFileBusyForRoom(room.id, false);
    }
  }

  return {
    openProjectFile,
    saveSelectedFileContent,
    attachSelectedFileToMessage,
    removePendingAttachment,
    openEncryptedAttachmentBlob
  };
}
