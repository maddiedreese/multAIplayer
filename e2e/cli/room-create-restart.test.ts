import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  WebSocket,
  createAuthenticatedTestDevice,
  onceOpen,
  startRelayWithWorkspace,
  waitForJoined
} from "../../apps/relay/test/support/relay.js";

test("CLI room create, host bootstrap, open, and relay restart keep the project path local", async () => {
  const userId = "github:maddiedreese";
  const deviceId = "device-cli-room-journey";
  const projectRoot = await mkdtemp(join(tmpdir(), "multaiplayer-cli-project-"));
  const canonicalProject = await realpath(projectRoot);
  let relay = await startRelayWithWorkspace();
  let socket: WebSocket | undefined;
  try {
    const device = await createAuthenticatedTestDevice(relay.baseUrl, userId, deviceId);
    const createBody = {
      teamId: "team-core",
      name: "CLI restart journey",
      approvalPolicy: "ask_every_turn"
    };
    assert.equal(JSON.stringify(createBody).includes(canonicalProject), false);
    const createdResponse = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: device.cookie },
      body: JSON.stringify(createBody)
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as {
      room: {
        id: string;
        teamId: string;
        name: string;
        host: string;
        hostUserId: string;
        hostStatus: string;
        acceptedMlsEpoch?: number;
        activeHostDeviceId?: string;
        approvalPolicy: string;
      };
    };
    assert.deepEqual(
      {
        teamId: created.room.teamId,
        name: created.room.name,
        hostUserId: created.room.hostUserId,
        hostStatus: created.room.hostStatus,
        acceptedMlsEpoch: created.room.acceptedMlsEpoch,
        activeHostDeviceId: created.room.activeHostDeviceId,
        approvalPolicy: created.room.approvalPolicy
      },
      {
        teamId: "team-core",
        name: "CLI restart journey",
        hostUserId: userId,
        hostStatus: "offline",
        acceptedMlsEpoch: undefined,
        activeHostDeviceId: undefined,
        approvalPolicy: "ask_every_turn"
      }
    );

    socket = new WebSocket(relay.wsUrl, { headers: { cookie: device.cookie } });
    await onceOpen(socket);
    const joined = waitForJoined(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: created.room.teamId,
        roomId: created.room.id,
        userId,
        deviceId,
        deviceSessionToken: device.token
      })
    );
    await joined;
    const hostResponse = await fetch(`${relay.baseUrl}/rooms/${created.room.id}/host`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: device.cookie,
        "x-device-session": device.token
      },
      body: JSON.stringify({
        host: created.room.host,
        hostUserId: userId,
        hostDeviceId: deviceId,
        hostStatus: "active"
      })
    });
    assert.equal(hostResponse.status, 200);
    const hosted = (await hostResponse.json()) as { room: Record<string, unknown> };
    assert.equal(hosted.room.hostStatus, "active");
    assert.equal(hosted.room.activeHostDeviceId, deviceId);
    assert.equal(hosted.room.acceptedMlsEpoch, 0);
    assert.equal(JSON.stringify(hosted).includes(canonicalProject), false);

    const handoffAttempt = await fetch(`${relay.baseUrl}/rooms/${created.room.id}/host`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: device.cookie,
        "x-device-session": device.token
      },
      body: JSON.stringify({
        host: created.room.host,
        hostUserId: userId,
        hostDeviceId: "device-other",
        hostStatus: "active"
      })
    });
    assert.equal(handoffAttempt.status, 409);

    socket.close();
    socket = undefined;
    const dataPath = relay.dataPath;
    await relay.close({ preserveData: true });
    relay = await startRelayWithWorkspace({}, undefined, dataPath);
    const reopenedResponse = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: device.cookie }
    });
    assert.equal(reopenedResponse.status, 200);
    const reopened = (await reopenedResponse.json()) as { rooms: Array<Record<string, unknown>> };
    const room = reopened.rooms.find((candidate) => candidate.id === created.room.id);
    assert.ok(room);
    assert.equal(room.hostStatus, "active");
    assert.equal(room.activeHostDeviceId, deviceId);
    assert.equal(room.acceptedMlsEpoch, 0);
    assert.equal(JSON.stringify(reopened).includes(canonicalProject), false);
    assert.equal((await readFile(dataPath)).includes(Buffer.from(canonicalProject)), false);
  } finally {
    socket?.close();
    await relay.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
