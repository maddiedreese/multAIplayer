import type { MutableRefObject } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  maxEmbeddedAttachmentBytes,
  maxEmbeddedAttachmentBytesPerMessage,
  type MlsRelayMessage,
  type RequestStatusPlaintextPayload,
  type WorkspaceFileSaveRequestPlaintextPayload
} from "@multaiplayer/protocol";
import { createAttachmentBlob, loadAttachmentBlob } from "./workspaceClient";
import { decryptMlsBlob, encryptMlsBlob, type MlsBlobCiphertext } from "./mlsClient";
import { createMlsApplicationMessage, publishMlsApplicationMessage } from "./mlsApplicationMessage";
import { reportExpectedFailure } from "./nonFatalReporting";
import {
  getGitDiff,
  readProjectFile,
  writeProjectFile,
  type GitDiffResult,
  type ProjectFileContent
} from "./localBackend";
import { resolveFilePreviewTab, type FilePreviewTab } from "./filePreview";
import {
  attachmentReviewMessage,
  attachmentReviewScopeKey,
  decideAttachmentReview,
  reviewedAttachmentPathForScope
} from "./attachmentPolicy";
import { canStageRoomChatAttachment, roomChatGateMessage } from "./chatPolicy";
import { roomLockMessage } from "./appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import { createImageThumbnail } from "./codexGeneratedImage";
import { isAttachmentBlobContent } from "./localRoomHistoryPayload";
import {
  attachmentTypeFromName,
  canOpenProjectAttachment,
  embeddedAttachmentBytes,
  encodedBytes,
  validatePendingAttachments
} from "./appFormatters";
import type { ChatAttachment } from "../types";
import type { RelayClient } from "./relayClient";
import type { WorkspaceFileSaveRequest } from "../types";
import { useAppStore } from "../store/appStore";
import { currentSelectedRoom, currentSelectedRoomContext } from "./selectedWorkspace";

interface FileActionsOptions {
  selectedRoomIdRef: MutableRefObject<string>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  reportRoomFileActionInFlight: (roomId: string) => boolean;
}

export function createFileActions({
  selectedRoomIdRef,
  relayRef,
  seenEnvelopeIds,
  reportRoomFileActionInFlight
}: FileActionsOptions) {
  const currentContext = () => currentSelectedRoomContext();
  function currentRoomAccess(selectedRoom: RoomRecord) {
    const store = useAppStore.getState();
    const revoked = store.revokedRoomIds.has(selectedRoom.id) || store.revokedTeamIds.has(selectedRoom.teamId);
    return {
      revoked,
      locked: selectedRoom.archivedAt != null || store.forgottenRoomIds.has(selectedRoom.id) || revoked
    };
  }

  const setSelectedFileMessage = (message: string | null) =>
    useAppStore.getState().setFileMessageForRoom(useAppStore.getState().selectedRoomId, message);
  const setFileBusyForRoom = (roomId: string, busy: boolean) => useAppStore.getState().setFileBusyForRoom(roomId, busy);
  const setSelectedFileForRoom = (roomId: string, file: ProjectFileContent | null) =>
    useAppStore.getState().setSelectedFileForRoom(roomId, file);
  const setSelectedDiffForRoom = (roomId: string, diff: GitDiffResult | null) =>
    useAppStore.getState().setSelectedDiffForRoom(roomId, diff);
  const setFilePreviewTabForRoom = (roomId: string, tab: FilePreviewTab) =>
    useAppStore.getState().setFilePreviewTabForRoom(roomId, tab);
  const setFileMessageForRoom = (roomId: string, message: string | null) =>
    useAppStore.getState().setFileMessageForRoom(roomId, message);
  const appendFileSaveRequest = (roomId: string, request: WorkspaceFileSaveRequest) =>
    useAppStore.getState().appendFileSaveRequest(roomId, request);
  const updateFileSaveRequestStatus = (roomId: string, requestId: string, status: WorkspaceFileSaveRequest["status"]) =>
    useAppStore.getState().updateFileSaveRequestStatus(roomId, requestId, status);
  const appendPendingAttachmentForRoom = (roomId: string, attachment: ChatAttachment) =>
    useAppStore.getState().appendPendingAttachmentForRoom(roomId, attachment);
  const removePendingAttachmentForRoom = (roomId: string, attachmentId: string) =>
    useAppStore.getState().removePendingAttachmentForRoom(roomId, attachmentId);
  const setSensitiveAttachmentReviewKey = (key: string | null) =>
    useAppStore.getState().setSensitiveAttachmentReviewKey(key);
  const setInspectorTabForRoom = (roomId: string, tab: "files") =>
    useAppStore.getState().setInspectorTabForRoom(roomId, tab);

  async function openProjectFile(path: string, preferredPreview: FilePreviewTab = "file") {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before opening project files.");
      return;
    }
    if (!currentContext()?.canReadLocalWorkspace) {
      setSelectedFileMessage(currentContext()?.localWorkspaceMessage ?? "Workspace unavailable.");
      return;
    }
    const room = selectedRoom;
    if (reportRoomFileActionInFlight(room.id)) return;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const [fileResult, diff] = await Promise.all([
        readProjectFile(room.projectPath, path)
          .then((file) => ({ file, error: null }))
          .catch((error) => ({ file: null, error })),
        getGitDiff(room.projectPath, path).catch(() => {
          reportExpectedFailure("Git diff was unavailable while opening a workspace file");
          return null;
        })
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
    const selectedRoom = currentSelectedRoom();
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
    const selectedFile = store.filePanelByRoom[selectedRoom.id]?.selectedFile ?? null;
    if (!selectedFile) {
      setSelectedFileMessage("Select a project file before attaching it to the room.");
      return;
    }
    const roomId = selectedRoom.id;
    const teamId = selectedRoom.teamId;
    const fileToAttach = selectedFile;
    const roomPendingAttachments = store.roomChatByRoom[roomId]?.pendingAttachments ?? [];
    const review = decideAttachmentReview(
      fileToAttach.content,
      fileToAttach.path,
      reviewedAttachmentPathForScope(
        store.sensitiveAttachmentReviewKey,
        roomId,
        selectedRoom.projectPath,
        fileToAttach.path
      )
    );
    if (!review.canAttach) {
      setSensitiveAttachmentReviewKey(attachmentReviewScopeKey(roomId, selectedRoom.projectPath, fileToAttach.path));
      setFileMessageForRoom(roomId, attachmentReviewMessage(fileToAttach.path, review.risks));
      return;
    }
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
    if (shouldUploadBlob) {
      if (reportRoomFileActionInFlight(roomId)) return;
      try {
        setFileBusyForRoom(roomId, true);
        const originalContent = attachment.content ?? "";
        const inlineThumbnail = fileToAttach.mediaType
          ? await createImageThumbnail(originalContent).catch((_error) => {
              reportExpectedFailure("create an inline project-image thumbnail");
              return null;
            })
          : null;
        const blobId = `blob_${crypto.randomUUID()}`;
        const sealed = await encryptMlsBlob(roomId, blobId, {
          name: fileToAttach.path,
          type: attachment.type,
          size: fileToAttach.size,
          content: fileToAttach.content,
          truncated: fileToAttach.truncated
        });
        const blob = await createAttachmentBlob({
          blobId,
          teamId,
          roomId,
          name: fileToAttach.path,
          type: attachment.type,
          size: fileToAttach.size,
          epoch: sealed.epoch,
          sealedBlob: JSON.stringify(sealed)
        });
        attachment.content = inlineThumbnail ?? undefined;
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
    const nextPendingAttachments = [...roomPendingAttachments, attachment];
    const validationError = validatePendingAttachments(nextPendingAttachments);
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

  async function saveSelectedFileContent(content: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before editing project files.");
      return;
    }
    if (!currentContext()?.canReadLocalWorkspace) {
      setSelectedFileMessage(currentContext()?.localWorkspaceMessage ?? "Workspace unavailable.");
      return;
    }
    const { locked, revoked } = currentRoomAccess(selectedRoom);
    if (locked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, revoked));
      return;
    }
    const selectedFile = useAppStore.getState().filePanelByRoom[selectedRoom.id]?.selectedFile ?? null;
    if (!selectedFile) {
      setSelectedFileMessage("Select a project file before saving changes.");
      return;
    }
    const room = selectedRoom;
    const path = selectedFile.path;
    if (!currentContext()?.isActiveHost) {
      await requestFileSaveApproval(room, selectedFile, content);
      return;
    }
    await writeSelectedFileContent(room, path, content);
  }

  async function requestFileSaveApproval(room: RoomRecord, file: ProjectFileContent, content: string) {
    const request: WorkspaceFileSaveRequest = {
      eventType: "workspace.file.save",
      id: crypto.randomUUID(),
      requester: currentContext()?.localUser.name ?? "Local user",
      requesterUserId: currentContext()?.localUser.id ?? "local",
      path: file.path,
      previousContent: file.content,
      nextContent: content,
      requestedAt: new Date().toISOString(),
      status: "pending"
    };
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      appendFileSaveRequest(room.id, request);
      setFileMessageForRoom(room.id, "Saved file edit request locally because the relay is not connected.");
      return;
    }
    try {
      const payload: WorkspaceFileSaveRequestPlaintextPayload = {
        eventType: request.eventType,
        id: request.id,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        path: request.path,
        previousContent: request.previousContent,
        nextContent: request.nextContent,
        requestedAt: request.requestedAt
      };
      const envelope: MlsRelayMessage = await createMlsApplicationMessage(
        {
          id: crypto.randomUUID(),
          teamId: room.teamId,
          roomId: room.id,
          senderDeviceId: currentContext()?.deviceId ?? "local-device",
          senderUserId: currentContext()?.localUser.id ?? "local",
          createdAt: request.requestedAt,
          kind: "workspace.request"
        },
        payload
      );
      seenEnvelopeIds.current.add(envelope.id);
      await publishMlsApplicationMessage(client, envelope);
      appendFileSaveRequest(room.id, request);
      setFileMessageForRoom(room.id, `Requested host approval to save ${file.path}.`);
    } catch (error) {
      setFileMessageForRoom(room.id, String(error));
    }
  }

  async function writeSelectedFileContent(room: RoomRecord, path: string, content: string): Promise<boolean> {
    if (reportRoomFileActionInFlight(room.id)) return false;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const saved = await writeProjectFile(room.projectPath, path, content);
      const [file, diff] = await Promise.all([
        readProjectFile(room.projectPath, path),
        getGitDiff(room.projectPath, path).catch(() => {
          reportExpectedFailure("Git diff was unavailable after saving a workspace file");
          return null;
        })
      ]);
      if (selectedRoomIdRef.current === room.id) {
        setSelectedFileForRoom(room.id, {
          ...file,
          path: saved.path,
          size: saved.size
        });
        setSelectedDiffForRoom(room.id, diff);
        setFilePreviewTabForRoom(room.id, "file");
        setFileMessageForRoom(room.id, `Saved ${path}.`);
      }
      return true;
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) setFileMessageForRoom(room.id, String(error));
      return false;
    } finally {
      setFileBusyForRoom(room.id, false);
    }
  }

  async function publishFileSaveStatus(
    room: RoomRecord,
    requestId: string,
    status: RequestStatusPlaintextPayload["status"]
  ) {
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const payload: RequestStatusPlaintextPayload = {
      requestId,
      status,
      decidedBy: currentContext()?.localUser.name ?? "Local user",
      decidedByUserId: currentContext()?.localUser.id ?? "local",
      decidedAt: new Date().toISOString()
    };
    const envelope: MlsRelayMessage = await createMlsApplicationMessage(
      {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: currentContext()?.deviceId ?? "local-device",
        senderUserId: currentContext()?.localUser.id ?? "local",
        createdAt: payload.decidedAt,
        kind: "workspace.event"
      },
      payload
    );
    seenEnvelopeIds.current.add(envelope.id);
    await publishMlsApplicationMessage(client, envelope);
  }

  async function approveFileSaveRequest(request: WorkspaceFileSaveRequest) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before approving file edits.");
      return;
    }
    if (!currentContext()?.isActiveHost) {
      setSelectedFileMessage(currentContext()?.hostGateMessage ?? "Claim host before continuing.");
      return;
    }
    if (!currentContext()?.canReadLocalWorkspace) {
      setSelectedFileMessage(currentContext()?.localWorkspaceMessage ?? "Workspace unavailable.");
      return;
    }
    const { locked, revoked } = currentRoomAccess(selectedRoom);
    if (locked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, revoked));
      return;
    }
    const fileSaveRequests = useAppStore.getState().filePanelByRoom[selectedRoom.id]?.saveRequests ?? [];
    if (!fileSaveRequests.some((item) => item.id === request.id && item.status === "pending")) {
      setFileMessageForRoom(selectedRoom.id, "That file edit request is no longer pending.");
      return;
    }
    const room = selectedRoom;
    const saved = await writeSelectedFileContent(room, request.path, request.nextContent);
    if (!saved) return;
    updateFileSaveRequestStatus(room.id, request.id, "approved");
    publishFileSaveStatus(room, request.id, "approved").catch((error) => setFileMessageForRoom(room.id, String(error)));
  }

  function denyFileSaveRequest(requestId: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before denying file edits.");
      return;
    }
    if (!currentContext()?.isActiveHost) {
      setSelectedFileMessage(currentContext()?.hostGateMessage ?? "Claim host before continuing.");
      return;
    }
    const fileSaveRequests = useAppStore.getState().filePanelByRoom[selectedRoom.id]?.saveRequests ?? [];
    if (!fileSaveRequests.some((item) => item.id === requestId && item.status === "pending")) {
      setFileMessageForRoom(selectedRoom.id, "That file edit request is no longer pending.");
      return;
    }
    const room = selectedRoom;
    updateFileSaveRequestStatus(room.id, requestId, "denied");
    publishFileSaveStatus(room, requestId, "denied").catch((error) => setFileMessageForRoom(room.id, String(error)));
    setFileMessageForRoom(room.id, "Denied file edit request.");
  }

  function removePendingAttachment(attachmentId: string) {
    const selectedRoom = currentSelectedRoom();
    if (selectedRoom) removePendingAttachmentForRoom(selectedRoom.id, attachmentId);
  }

  async function openEncryptedAttachmentBlob(attachment: ChatAttachment) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedFileMessage("Create or join a room before opening encrypted attachments.");
      return;
    }
    const { locked, revoked } = currentRoomAccess(selectedRoom);
    if (locked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, revoked));
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
      const blob = await loadAttachmentBlob(attachment.blobId, room.teamId, room.id);
      if (blob.roomId !== room.id || blob.teamId !== room.teamId) {
        throw new Error("Attachment blob belongs to a different room.");
      }
      const sealed = JSON.parse(blob.sealedBlob) as MlsBlobCiphertext;
      if (sealed.epoch !== blob.epoch) throw new Error("Attachment blob epoch metadata is inconsistent.");
      const decrypted = await decryptMlsBlob(room.id, blob.id, sealed);
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
    approveFileSaveRequest,
    denyFileSaveRequest,
    attachSelectedFileToMessage,
    removePendingAttachment,
    openEncryptedAttachmentBlob
  };
}
