import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { isRecord } from "@multaiplayer/protocol";
import { createRelayPersistence } from "./persistence.js";

const parsed = parseArguments(process.argv.slice(2));
if (!existsSync(parsed.dataPath)) {
  throw new Error(`Relay store does not exist at ${parsed.dataPath}; no state was changed.`);
}
const persistence = createRelayPersistence({ dataPath: parsed.dataPath });

try {
  const loaded = await persistence.load();
  if (!isRecord(loaded) || loaded.version !== 1) {
    throw new Error("Relay store must exist and use version 1. Refusing to create or replace an unknown store.");
  }
  const hostedRoom = Array.isArray(loaded.rooms)
    ? loaded.rooms.find(
        (item) => isRecord(item) && item.hostUserId === parsed.userId && item.activeHostDeviceId === parsed.deviceId
      )
    : undefined;
  if (isRecord(hostedRoom)) {
    const roomId = typeof hostedRoom.id === "string" ? hostedRoom.id : "unknown";
    throw new Error(`Device still hosts room ${roomId}; hand off or delete that room before retiring the device.`);
  }
  const devices = Array.isArray(loaded.devices) ? loaded.devices : [];
  const retainedDevices = devices.filter((item) => !isOwnedByDevice(item, parsed.userId, parsed.deviceId));
  if (retainedDevices.length === devices.length) {
    throw new Error("The requested registered device does not exist; no relay state was changed.");
  }
  const keyPackages = Array.isArray(loaded.keyPackages) ? loaded.keyPackages : [];
  const retainedKeyPackages = keyPackages.filter((item) => !isOwnedByDevice(item, parsed.userId, parsed.deviceId));

  await persistence.save({
    ...loaded,
    devices: retainedDevices,
    keyPackages: retainedKeyPackages
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      userId: parsed.userId,
      deviceId: parsed.deviceId,
      removedDevices: devices.length - retainedDevices.length,
      removedKeyPackages: keyPackages.length - retainedKeyPackages.length
    })}\n`
  );
} finally {
  persistence.close();
}

function isOwnedByDevice(value: unknown, userId: string, deviceId: string): boolean {
  return isRecord(value) && value.userId === userId && value.deviceId === deviceId;
}

function parseArguments(args: string[]): { userId: string; deviceId: string; dataPath: string } {
  if (!args.includes("--confirm-relay-stopped")) {
    usage("--confirm-relay-stopped is required because the CLI must not race the single relay writer");
  }
  const [userId, deviceId] = args.filter((arg) => !arg.startsWith("--"));
  if (!validIdentifier(userId)) usage("user id must be non-empty, bounded, and control-character free");
  if (!validIdentifier(deviceId)) usage("device id must be non-empty, bounded, and control-character free");
  if (option(args, "confirm-device-id") !== deviceId) {
    usage("--confirm-device-id must exactly match the device id being retired");
  }
  const dataPathValue = option(args, "data-path") ?? process.env.MULTAIPLAYER_RELAY_DATA_PATH;
  if (!dataPathValue) usage("--data-path or MULTAIPLAYER_RELAY_DATA_PATH is required");
  return { userId, deviceId, dataPath: resolve(dataPathValue) };
}

function validIdentifier(value: string | undefined): value is string {
  return Boolean(value && value === value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value));
}

function option(args: string[], name: string) {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function usage(message: string): never {
  throw new Error(
    `${message}. Usage: devices:retire -- <user-id> <device-id> --data-path=<path> --confirm-relay-stopped --confirm-device-id=<device-id>`
  );
}
