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

const {
  buildDeviceFingerprintMarkdown,
  isDeviceKeyTrusted,
  loadTrustedDeviceKeys,
  trustDeviceKey,
  untrustDeviceKey
} = await import("../src/lib/deviceTrust");

const trustStorageKey = "multaiplayer:trusted-device-keys:v1";

test.beforeEach(() => {
  localStorage.clear();
});

test("trustDeviceKey persists room-scoped device fingerprints", () => {
  const trusted = trustDeviceKey([], " room-a ", " device-a ", "abcdef1234567890", "2026-07-04T12:00:00.000Z");

  assert.equal(isDeviceKeyTrusted(trusted, "room-a", "device-a", "abcdef1234567890"), true);
  assert.equal(isDeviceKeyTrusted(loadTrustedDeviceKeys(), "room-a", "device-a", "abcdef1234567890"), true);
  assert.equal(isDeviceKeyTrusted(trusted, "room-b", "device-a", "abcdef1234567890"), false);
});

test("changed fingerprints are not trusted for the same device id", () => {
  const trusted = trustDeviceKey([], "room-a", "device-a", "abcdef1234567890", "2026-07-04T12:00:00.000Z");

  assert.equal(isDeviceKeyTrusted(trusted, "room-a", "device-a", "1111111234567890"), false);
});

test("trustDeviceKey replaces prior trust for the same room and device", () => {
  const first = trustDeviceKey([], "room-a", "device-a", "abcdef1234567890", "2026-07-04T12:00:00.000Z");
  const second = trustDeviceKey(first, "room-a", "device-a", "1111111234567890", "2026-07-04T13:00:00.000Z");

  assert.equal(isDeviceKeyTrusted(second, "room-a", "device-a", "abcdef1234567890"), false);
  assert.equal(isDeviceKeyTrusted(second, "room-a", "device-a", "1111111234567890"), true);
  assert.equal(second.length, 1);
});

test("untrustDeviceKey removes the local trust record", () => {
  const trusted = trustDeviceKey([], "room-a", "device-a", "abcdef1234567890", "2026-07-04T12:00:00.000Z");
  const next = untrustDeviceKey(trusted, "room-a", "device-a");

  assert.equal(isDeviceKeyTrusted(next, "room-a", "device-a", "abcdef1234567890"), false);
  assert.deepEqual(loadTrustedDeviceKeys(), []);
});

test("loadTrustedDeviceKeys drops corrupted trust storage", () => {
  localStorage.setItem(trustStorageKey, "{not-json");

  assert.deepEqual(loadTrustedDeviceKeys(), []);
  assert.equal(localStorage.getItem(trustStorageKey), null);
});

test("buildDeviceFingerprintMarkdown produces verification text", () => {
  const markdown = buildDeviceFingerprintMarkdown({
    roomName: "Core Desktop",
    displayName: "Maddie",
    deviceId: "device-123",
    fingerprint: "abcdef1234567890abcdef",
    trusted: true
  });

  assert.match(markdown, /^# Device fingerprint for Maddie/);
  assert.match(markdown, /Room: Core Desktop/);
  assert.match(markdown, /Device: device-123/);
  assert.match(markdown, /Trust status: locally trusted/);
  assert.match(markdown, /```text\nabcdef1234567890abcdef\n```/);
  assert.match(markdown, /Verify this fingerprint out of band/);
});
