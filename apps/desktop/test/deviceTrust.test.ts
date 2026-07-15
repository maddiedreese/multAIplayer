import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage
});

const { buildDeviceFingerprintMarkdown, isDeviceKeyTrusted, loadTrustedDeviceKeys, trustDeviceKey, untrustDeviceKey } =
  await import("../src/lib/identity/deviceTrust");

const trustStorageKey = "multaiplayer:trusted-device-keys:v1";
const fingerprintA = `sha256:${Array(16).fill("abcd").join(":")}`;
const fingerprintB = `sha256:${Array(16).fill("1111").join(":")}`;

test.beforeEach(() => {
  localStorage.clear();
});

test("trustDeviceKey persists room-scoped device fingerprints", () => {
  const trusted = trustDeviceKey([], " room-a ", " device-a ", fingerprintA, "2026-07-04T12:00:00.000Z");

  assert.equal(isDeviceKeyTrusted(trusted, "room-a", "device-a", fingerprintA), true);
  assert.equal(isDeviceKeyTrusted(loadTrustedDeviceKeys(), "room-a", "device-a", fingerprintA), true);
  assert.equal(isDeviceKeyTrusted(trusted, "room-b", "device-a", fingerprintA), false);
});

test("changed fingerprints are not trusted for the same device id", () => {
  const trusted = trustDeviceKey([], "room-a", "device-a", fingerprintA, "2026-07-04T12:00:00.000Z");

  assert.equal(isDeviceKeyTrusted(trusted, "room-a", "device-a", fingerprintB), false);
});

test("trustDeviceKey replaces prior trust for the same room and device", () => {
  const first = trustDeviceKey([], "room-a", "device-a", fingerprintA, "2026-07-04T12:00:00.000Z");
  const second = trustDeviceKey(first, "room-a", "device-a", fingerprintB, "2026-07-04T13:00:00.000Z");

  assert.equal(isDeviceKeyTrusted(second, "room-a", "device-a", fingerprintA), false);
  assert.equal(isDeviceKeyTrusted(second, "room-a", "device-a", fingerprintB), true);
  assert.equal(second.length, 1);
});

test("untrustDeviceKey removes the local trust record", () => {
  const trusted = trustDeviceKey([], "room-a", "device-a", fingerprintA, "2026-07-04T12:00:00.000Z");
  const next = untrustDeviceKey(trusted, "room-a", "device-a");

  assert.equal(isDeviceKeyTrusted(next, "room-a", "device-a", fingerprintA), false);
  assert.deepEqual(loadTrustedDeviceKeys(), []);
});

test("loadTrustedDeviceKeys drops corrupted trust storage", () => {
  localStorage.setItem(trustStorageKey, "{not-json");

  assert.deepEqual(loadTrustedDeviceKeys(), []);
  assert.equal(localStorage.getItem(trustStorageKey), null);
});

test("buildDeviceFingerprintMarkdown produces local device-note text", () => {
  const markdown = buildDeviceFingerprintMarkdown({
    roomName: "Core Desktop",
    displayName: "Maddie",
    deviceId: "device-123",
    fingerprint: fingerprintA,
    trusted: true
  });

  assert.match(markdown, /^# Device fingerprint for Maddie/);
  assert.match(markdown, /Room: Core Desktop/);
  assert.match(markdown, /Device: device-123/);
  assert.match(markdown, /Trust status: locally trusted/);
  assert.match(markdown, new RegExp(`\`\`\`text\\n${fingerprintA}\\n\`\`\``));
  assert.match(markdown, /local device note/);
  assert.match(markdown, /Compare the fingerprint out of band/);
});

test("legacy truncated trust entries are invalidated", () => {
  localStorage.setItem(
    trustStorageKey,
    JSON.stringify([
      {
        roomId: "room-a",
        deviceId: "device-a",
        fingerprint: "abcd:abcd:abcd:abcd",
        trustedAt: "2026-07-04T12:00:00.000Z"
      }
    ])
  );
  assert.deepEqual(loadTrustedDeviceKeys(), []);
});
