import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadOnlyRoomArchive,
  projectReadOnlyRoomArchive,
  roomArchiveOmissions
} from "../src/application/history/roomArchive";
import { useAppStore } from "../src/store/appStore";

test("room archive projection strips authority and pending actions but retains resolved display history", () => {
  useAppStore.getState().resetAppStore();
  useAppStore.setState((state) => ({
    messagesByRoom: {
      ...state.messagesByRoom,
      room: [
        {
          id: "message",
          author: "Maddie",
          role: "human",
          body: "hello",
          time: "now",
          attachments: [
            { id: "a", name: "note.txt", type: "text/plain", size: 6, content: "secret", blobId: "ciphertext-id" }
          ]
        }
      ]
    },
    terminalRuntimeByRoom: {
      room: {
        requests: [
          {
            id: "pending",
            command: "rm -rf /",
            cwd: "/tmp",
            requester: "M",
            requesterUserId: "u",
            requestedAt: "2026-07-14T00:00:00Z",
            status: "pending"
          },
          {
            id: "denied",
            command: "pwd",
            cwd: "/tmp",
            requester: "M",
            requesterUserId: "u",
            requestedAt: "2026-07-14T00:00:00Z",
            status: "denied"
          }
        ]
      }
    },
    codexRuntimeByRoom: {
      room: {
        pendingApproval: {
          turnId: "turn",
          roomId: "room",
          requestedBy: "M",
          requestedByUserId: "u",
          queuedAt: "now",
          messages: [],
          summary: { text: "pending", files: [], commands: [] }
        }
      }
    }
  }));

  const archive = buildReadOnlyRoomArchive(useAppStore.getState(), "room", "Room", "Team", "2026-07-14T00:00:00Z");
  assert.equal(archive.history.terminalRequests.length, 1);
  assert.equal((archive.history.terminalRequests[0] as { id: string }).id, "denied");
  assert.equal(JSON.stringify(archive).includes("pendingApproval"), false);
  assert.equal(JSON.stringify(archive).includes("ciphertext-id"), false);
  assert.deepEqual(archive.omissions, roomArchiveOmissions);

  const projected = projectReadOnlyRoomArchive(archive);
  assert.equal(projected.history.messages[0]?.body, "hello");
  assert.equal(projected.history.terminalRequests[0]?.status, "denied");
});

test("opened archives are normalized instead of trusted as live state", () => {
  const archive = buildReadOnlyRoomArchive(
    useAppStore.getState(),
    "missing",
    "Room",
    undefined,
    "2026-07-14T00:00:00Z"
  );
  archive.history.messages = [{ id: "bad", body: 123 }];
  archive.history.terminalRequests = [{ status: "approved", command: 12 }];
  const projected = projectReadOnlyRoomArchive(archive);
  assert.deepEqual(projected.history.messages, []);
  assert.deepEqual(projected.history.terminalRequests, []);
  assert.deepEqual(projected.history.inviteRequests, []);
  assert.deepEqual(projected.history.hostHandoffs, []);
  assert.deepEqual(projected.history.queuedCodexTurns, []);
});
