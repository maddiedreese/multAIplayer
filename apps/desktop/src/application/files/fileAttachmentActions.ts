import type { MutableRefObject } from "react";
import {
  maxEmbeddedAttachmentBytes,
  maxEmbeddedAttachmentBytesPerMessage,
  type ClientRoomRecord
} from "@multaiplayer/protocol";
import { createAttachmentBlob, loadAttachmentBlob } from "../workspace/workspaceClient";
import { decryptMlsBlob, encryptMlsBlob, type MlsBlobCiphertext } from "../../lib/mls/mlsClient";
import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";
import type { ProjectFileContent } from "../../lib/platform/localBackend";
import {
  attachmentReviewMessage,
  attachmentReviewScopeKey,
  decideAttachmentReview,
  reviewedAttachmentPathForScope
} from "../../lib/files/attachmentPolicy";
import { canStageRoomChatAttachment, roomChatGateMessage } from "../../lib/chat/chatPolicy";
import { roomLockMessage } from "../runtime/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { createImageThumbnail } from "../codex/codexGeneratedImage";
import { isAttachmentBlobContent } from "../../lib/history/localRoomHistoryPayload";
import {
  attachmentTypeFromName,
  canOpenProjectAttachment,
  embeddedAttachmentBytes,
  encodedBytes,
  validatePendingAttachments
} from "../../lib/formatting/appFormatters";
import type { ChatAttachment } from "../../types";
import { useAppStore } from "../../store/appStore";
import type { FilePreviewTab } from "../../lib/files/filePreview";
import type { currentSelectedRoom, currentSelectedRoomContext } from "../workspace/selectedWorkspace";

interface FileAttachmentActionOptions {
  selectedRoomIdRef: MutableRefObject<string>;
  reportRoomFileActionInFlight: (roomId: string) => boolean;
  currentRoom: typeof currentSelectedRoom;
  currentContext: typeof currentSelectedRoomContext;
  currentRoomAccess: (room: ClientRoomRecord) => { locked: boolean; revoked: boolean };
  setSelectedFileMessage: (message: string | null) => void;
  setFileBusyForRoom: (roomId: string, busy: boolean) => void;
  setSelectedFileForRoom: (roomId: string, file: ProjectFileContent | null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: null) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
  setSensitiveAttachmentReviewKey: (key: string | null) => void;
  setInspectorTabForRoom: (roomId: string, tab: "files") => void;
  appendPendingAttachmentForRoom: (roomId: string, attachment: ChatAttachment) => void;
  removePendingAttachmentForRoom: (roomId: string, attachmentId: string) => void;
  openProjectFile: (path: string, preferredPreview?: FilePreviewTab) => Promise<void>;
}

export function createFileAttachmentActions(options: FileAttachmentActionOptions) {
  const {
    selectedRoomIdRef,
    reportRoomFileActionInFlight,
    currentRoom,
    currentContext,
    currentRoomAccess,
    setSelectedFileMessage,
    setFileBusyForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFileMessageForRoom,
    setSensitiveAttachmentReviewKey,
    setInspectorTabForRoom,
    appendPendingAttachmentForRoom,
    removePendingAttachmentForRoom,
    openProjectFile
  } = options;

  async function attachSelectedFileToMessage() {
    const context = selectedFileAttachmentContext();
    if (!context) return;
    const { selectedRoom, fileToAttach, roomPendingAttachments } = context;
    const roomId = selectedRoom.id;
    const attachment: ChatAttachment = {
      id: crypto.randomUUID(),
      name: fileToAttach.path,
      type: fileToAttach.mediaType ?? attachmentTypeFromName(fileToAttach.path),
      size: fileToAttach.size,
      content: fileToAttach.content,
      truncated: fileToAttach.truncated
    };
    if (roomPendingAttachments.some((item) => item.name === attachment.name)) {
      setFileMessageForRoom(roomId, `${attachment.name} is already attached to the next room message.`);
      return;
    }
    const selectedContentBytes = encodedBytes(attachment.content ?? "");
    const shouldUploadBlob =
      selectedContentBytes > maxEmbeddedAttachmentBytes ||
      embeddedAttachmentBytes(roomPendingAttachments) + selectedContentBytes > maxEmbeddedAttachmentBytesPerMessage;
    if (
      shouldUploadBlob &&
      !(await uploadAttachmentBlob(attachment, fileToAttach, selectedRoom.teamId, roomId, selectedContentBytes))
    )
      return;
    const validationError = validatePendingAttachments([...roomPendingAttachments, attachment]);
    if (validationError) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setFileMessageForRoom(roomId, validationError);
      return;
    }
    appendPendingAttachmentForRoom(roomId, attachment);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setSensitiveAttachmentReviewKey(null);
      setFileMessageForRoom(
        roomId,
        attachment.blobId
          ? `Attached ${fileToAttach.path} as an encrypted blob for the next room message.`
          : `Attached ${fileToAttach.path} to the next room message.`
      );
    }
  }

  function selectedFileAttachmentContext() {
    const selectedRoom = currentRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before attaching project files.");
      return;
    }
    if (!currentContext()?.canReadLocalWorkspace) {
      setSelectedFileMessage(currentContext()?.localWorkspaceMessage ?? "Workspace unavailable.");
      return;
    }
    const { locked } = currentRoomAccess(selectedRoom);
    if (!canStageRoomChatAttachment(selectedRoom, locked)) {
      setSelectedFileMessage(roomChatGateMessage(selectedRoom, locked));
      return;
    }
    const store = useAppStore.getState();
    const fileToAttach = store.filePanelByRoom[selectedRoom.id]?.selectedFile ?? null;
    if (!fileToAttach) {
      setSelectedFileMessage("Select a project file before attaching it to the room.");
      return;
    }
    const roomPendingAttachments = store.roomChatByRoom[selectedRoom.id]?.pendingAttachments ?? [];
    const review = decideAttachmentReview(
      fileToAttach.content,
      fileToAttach.path,
      reviewedAttachmentPathForScope(
        store.sensitiveAttachmentReviewKey,
        selectedRoom.id,
        selectedRoom.projectPath,
        fileToAttach.path
      )
    );
    if (!review.canAttach) {
      setSensitiveAttachmentReviewKey(
        attachmentReviewScopeKey(selectedRoom.id, selectedRoom.projectPath, fileToAttach.path)
      );
      setFileMessageForRoom(selectedRoom.id, attachmentReviewMessage(fileToAttach.path, review.risks));
      return;
    }
    return { selectedRoom, fileToAttach, roomPendingAttachments };
  }

  async function uploadAttachmentBlob(
    attachment: ChatAttachment,
    file: ProjectFileContent,
    teamId: string,
    roomId: string,
    contentBytes: number
  ) {
    if (reportRoomFileActionInFlight(roomId)) return false;
    try {
      setFileBusyForRoom(roomId, true);
      const inlineThumbnail = file.mediaType
        ? await createImageThumbnail(attachment.content ?? "").catch(() => {
            reportExpectedFailure("create an inline project-image thumbnail");
            return null;
          })
        : null;
      const blobId = `blob_${crypto.randomUUID()}`;
      const sealed = await encryptMlsBlob(roomId, blobId, {
        name: file.path,
        type: attachment.type,
        size: file.size,
        content: file.content,
        truncated: file.truncated
      });
      const blob = await createAttachmentBlob({
        blobId,
        teamId,
        roomId,
        name: file.path,
        type: attachment.type,
        size: file.size,
        epoch: sealed.epoch,
        sealedBlob: JSON.stringify(sealed)
      });
      if (inlineThumbnail) attachment.content = inlineThumbnail;
      else delete attachment.content;
      attachment.blobId = blob.id;
      attachment.blobBytes = contentBytes;
      attachment.truncated = file.truncated || contentBytes > maxEmbeddedAttachmentBytes;
      return true;
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setFileMessageForRoom(roomId, `Could not upload encrypted attachment blob: ${String(error)}`);
      }
      return false;
    } finally {
      setFileBusyForRoom(roomId, false);
    }
  }

  function removePendingAttachment(attachmentId: string) {
    const room = currentRoom();
    if (room) removePendingAttachmentForRoom(room.id, attachmentId);
  }

  async function openEncryptedAttachmentBlob(attachment: ChatAttachment) {
    const selectedRoom = currentRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before opening encrypted attachments.");
      return;
    }
    const { locked, revoked } = currentRoomAccess(selectedRoom);
    if (locked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, revoked));
      return;
    }
    if (!attachment.blobId) {
      if (attachment.content) {
        if (selectedRoomIdRef.current !== selectedRoom.id) return;
        setSelectedDiffForRoom(selectedRoom.id, null);
        setSelectedFileForRoom(selectedRoom.id, {
          path: attachment.name,
          size: attachment.size,
          truncated: Boolean(attachment.truncated),
          content: attachment.content
        });
        setInspectorTabForRoom(selectedRoom.id, "files");
        setFileMessageForRoom(selectedRoom.id, `Opened inline attachment ${attachment.name}.`);
      } else if (canOpenProjectAttachment(attachment)) await openProjectFile(attachment.name, "file");
      return;
    }
    if (reportRoomFileActionInFlight(selectedRoom.id)) return;
    setFileBusyForRoom(selectedRoom.id, true);
    setFileMessageForRoom(selectedRoom.id, null);
    try {
      const blob = await loadAttachmentBlob(attachment.blobId, selectedRoom.teamId, selectedRoom.id);
      if (blob.roomId !== selectedRoom.id || blob.teamId !== selectedRoom.teamId)
        throw new Error("Attachment blob belongs to a different room.");
      const sealed = JSON.parse(blob.sealedBlob) as MlsBlobCiphertext;
      if (sealed.epoch !== blob.epoch) throw new Error("Attachment blob epoch metadata is inconsistent.");
      const decrypted = await decryptMlsBlob(selectedRoom.id, blob.id, sealed);
      if (!isAttachmentBlobContent(decrypted))
        throw new Error("Attachment blob payload was not a supported file preview.");
      if (selectedRoomIdRef.current !== selectedRoom.id) return;
      setSelectedDiffForRoom(selectedRoom.id, null);
      setSelectedFileForRoom(selectedRoom.id, {
        path: decrypted.name || attachment.name,
        size: decrypted.size ?? attachment.size,
        truncated: Boolean(decrypted.truncated),
        content: decrypted.content
      });
      setInspectorTabForRoom(selectedRoom.id, "files");
      setFileMessageForRoom(selectedRoom.id, `Opened encrypted attachment ${decrypted.name || attachment.name}.`);
    } catch (error) {
      if (selectedRoomIdRef.current === selectedRoom.id)
        setFileMessageForRoom(selectedRoom.id, `Could not open encrypted attachment: ${String(error)}`);
    } finally {
      setFileBusyForRoom(selectedRoom.id, false);
    }
  }

  return { attachSelectedFileToMessage, removePendingAttachment, openEncryptedAttachmentBlob };
}
