import assert from "node:assert/strict";
import { test } from "node:test";
import { seededRooms } from "./support/workspaceFixtures";
import {
  buildRoomNotificationPreview,
  getRoomNotificationEligibility,
  roomIdFromNotificationExtra,
  roomNotificationTitle
} from "../src/lib/room/roomNotifications";
import { useAppStore } from "../src/store/appStore";
import { projectRoomSettingsPanelMaps } from "../src/store/slices/roomSettingsSlice";
import type { ChatMessage } from "../src/types";

const room = seededRooms[0];
const message: ChatMessage = {
  id: "message-1",
  author: "Avery",
  role: "human",
  body: "Hello from a decrypted room message.",
  time: "10:30 AM"
};

function eligibility(overrides: Partial<Parameters<typeof getRoomNotificationEligibility>[0]> = {}) {
  return getRoomNotificationEligibility({
    relayOpen: true,
    room,
    message,
    selectedRoomId: "other-room",
    localDeviceId: "local-device",
    senderDeviceId: "remote-device",
    localUserId: "github:local",
    senderUserId: "github:remote",
    mutedRoomIds: new Set(),
    forgottenRoomIds: new Set(),
    revokedRoomIds: new Set(),
    revokedTeamIds: new Set(),
    ...overrides
  });
}

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("room notification preview uses decrypted message content and bounds length", () => {
  assert.equal(buildRoomNotificationPreview(message), "Hello from a decrypted room message.");
  assert.equal(
    buildRoomNotificationPreview({
      ...message,
      body: "   ",
      attachments: [{ id: "a", name: "notes.md", type: "text/markdown", size: 12 }]
    }),
    "Shared an attachment."
  );

  const preview = buildRoomNotificationPreview({ ...message, body: "x".repeat(400) });
  assert.equal(preview.length, 180);
  assert.ok(preview.endsWith("..."));
});

test("room notification eligibility suppresses focused, local, muted, locked, and closed cases", () => {
  assert.deepEqual(eligibility(), { eligible: true });
  assert.deepEqual(eligibility({ selectedRoomId: room.id }), { eligible: false, reason: "focused_room" });
  assert.deepEqual(eligibility({ senderDeviceId: "local-device" }), { eligible: false, reason: "local_sender" });
  assert.deepEqual(eligibility({ senderUserId: "github:local" }), { eligible: false, reason: "local_sender" });
  assert.deepEqual(eligibility({ mutedRoomIds: new Set([room.id]) }), { eligible: false, reason: "muted" });
  assert.deepEqual(eligibility({ forgottenRoomIds: new Set([room.id]) }), { eligible: false, reason: "locked" });
  assert.deepEqual(eligibility({ revokedRoomIds: new Set([room.id]) }), { eligible: false, reason: "locked" });
  assert.deepEqual(eligibility({ revokedTeamIds: new Set([room.teamId]) }), { eligible: false, reason: "locked" });
  assert.deepEqual(eligibility({ relayOpen: false }), { eligible: false, reason: "relay_closed" });
});

test("room notification title and click payload target the room without plaintext", () => {
  assert.equal(roomNotificationTitle(room, message), `Avery in ${room.name}`);
  assert.equal(roomIdFromNotificationExtra({ roomId: room.id, teamId: room.teamId }), room.id);
  assert.equal(roomIdFromNotificationExtra({ roomId: "" }), null);
});

test("room notification mute is local room settings state", () => {
  const store = useAppStore.getState();
  store.setRoomNotificationsMuted(room.id, true);

  let projected = projectRoomSettingsPanelMaps(useAppStore.getState().roomSettingsByRoom);
  assert.equal(projected.notificationMutedRoomIds.has(room.id), true);

  useAppStore.getState().setRoomNotificationsMuted(room.id, false);
  projected = projectRoomSettingsPanelMaps(useAppStore.getState().roomSettingsByRoom);
  assert.equal(projected.notificationMutedRoomIds.has(room.id), false);
});
