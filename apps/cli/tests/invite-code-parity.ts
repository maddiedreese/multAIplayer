import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  decodeNoSecretRoomInvite,
  encodeNoSecretRoomInvite
} from "../../desktop/src/lib/invite/noSecretRoomInvite.ts";

const invite = {
  version: 4 as const,
  teamId: "team-core",
  roomId: "room-core",
  roomName: "Compiler work",
  capabilityHandle: "desktop_capability_handle",
  capabilityUrlValue: "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo",
  expiresAt: "2026-07-19T12:34:56.000Z",
  hostUserId: "github:host",
  hostDeviceId: "device_host",
  hostHpkePublicKey: Buffer.alloc(65, 4).toString("base64"),
  hostHpkeKeyFingerprint: `sha256:${Array.from({ length: 16 }, () => "abcd").join(":")}`
};

if (process.argv[2] === "emit-desktop") {
  const payload = encodeNoSecretRoomInvite(invite);
  process.stdout.write(
    `https://open.multaiplayer.com/invite#invite=invite_desktop&multaiplayerJoin=${payload}&approval=request`
  );
} else if (process.argv[2] === "accept-cli") {
  const code = readFileSync(0, "utf8").trim();
  const url = new URL(code);
  const payload = new URLSearchParams(url.hash.slice(1)).get("multaiplayerJoin");
  assert.ok(payload);
  assert.deepEqual(decodeNoSecretRoomInvite(payload), {
    ...invite,
    capabilityHandle: "super_secret_handle"
  });
} else {
  throw new Error("expected emit-desktop or accept-cli");
}
