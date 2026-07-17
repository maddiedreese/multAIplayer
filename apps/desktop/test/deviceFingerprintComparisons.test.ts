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
  isDeviceFingerprintCompared,
  loadDeviceFingerprintComparisons,
  recordDeviceFingerprintComparison,
  removeDeviceFingerprintComparison
} = await import("../src/lib/identity/deviceFingerprintComparisons");

const comparisonStorageKey = "multaiplayer:device-fingerprint-comparisons:v1";
const fingerprintA = `sha256:${Array(16).fill("abcd").join(":")}`;
const fingerprintB = `sha256:${Array(16).fill("1111").join(":")}`;

test.beforeEach(() => {
  localStorage.clear();
});

test("recordDeviceFingerprintComparison persists room-scoped device fingerprints", () => {
  const comparisons = recordDeviceFingerprintComparison(
    [],
    " room-a ",
    " device-a ",
    fingerprintA,
    "2026-07-04T12:00:00.000Z"
  );

  assert.equal(isDeviceFingerprintCompared(comparisons, "room-a", "device-a", fingerprintA), true);
  assert.equal(
    isDeviceFingerprintCompared(loadDeviceFingerprintComparisons(), "room-a", "device-a", fingerprintA),
    true
  );
  assert.equal(isDeviceFingerprintCompared(comparisons, "room-b", "device-a", fingerprintA), false);
  assert.notEqual(localStorage.getItem(comparisonStorageKey), null);
});

test("changed fingerprints are not marked compared for the same device id", () => {
  const comparisons = recordDeviceFingerprintComparison(
    [],
    "room-a",
    "device-a",
    fingerprintA,
    "2026-07-04T12:00:00.000Z"
  );

  assert.equal(isDeviceFingerprintCompared(comparisons, "room-a", "device-a", fingerprintB), false);
});

test("recordDeviceFingerprintComparison replaces a prior comparison for the same room and device", () => {
  const first = recordDeviceFingerprintComparison([], "room-a", "device-a", fingerprintA, "2026-07-04T12:00:00.000Z");
  const second = recordDeviceFingerprintComparison(
    first,
    "room-a",
    "device-a",
    fingerprintB,
    "2026-07-04T13:00:00.000Z"
  );

  assert.equal(isDeviceFingerprintCompared(second, "room-a", "device-a", fingerprintA), false);
  assert.equal(isDeviceFingerprintCompared(second, "room-a", "device-a", fingerprintB), true);
  assert.equal(second.length, 1);
});

test("removeDeviceFingerprintComparison removes the local comparison record", () => {
  const comparisons = recordDeviceFingerprintComparison(
    [],
    "room-a",
    "device-a",
    fingerprintA,
    "2026-07-04T12:00:00.000Z"
  );
  const next = removeDeviceFingerprintComparison(comparisons, "room-a", "device-a");

  assert.equal(isDeviceFingerprintCompared(next, "room-a", "device-a", fingerprintA), false);
  assert.deepEqual(loadDeviceFingerprintComparisons(), []);
});

test("loadDeviceFingerprintComparisons drops corrupted current comparison storage", () => {
  localStorage.setItem(comparisonStorageKey, "{not-json");

  assert.deepEqual(loadDeviceFingerprintComparisons(), []);
  assert.equal(localStorage.getItem(comparisonStorageKey), null);
});

test("buildDeviceFingerprintMarkdown produces local device-note text", () => {
  const markdown = buildDeviceFingerprintMarkdown({
    roomName: "Core Desktop",
    displayName: "Maddie",
    deviceId: "device-123",
    fingerprint: fingerprintA,
    comparedLocally: true
  });

  assert.match(markdown, /^# Device fingerprint for Maddie/);
  assert.match(markdown, /Room: Core Desktop/);
  assert.match(markdown, /Device: device-123/);
  assert.match(markdown, /Comparison note: fingerprint compared on this device/);
  assert.match(markdown, new RegExp(`\`\`\`text\\n${fingerprintA}\\n\`\`\``));
  assert.match(markdown, /advisory note stored only on this device/);
  assert.match(markdown, /Compare the fingerprint out of band/);
  assert.match(markdown, /does not authenticate the person, grant access, or change MLS or relay authority/);
});
