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
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {}
});

const { loadOrCreateDeviceIdentity } = await import("../src/lib/identity/deviceIdentity");

test.beforeEach(() => {
  localStorage.clear();
});

test("browser runtime cannot create or load a device identity", async () => {
  await assert.rejects(
    loadOrCreateDeviceIdentity("github:browser", "device-browser"),
    /only in the native desktop app/
  );
  assert.equal(localStorage.getItem("multaiplayer:device-identity:v1"), null);
});

function nativeIdentity(githubUserId: string, deviceId: string) {
  return {
    githubUserId,
    deviceId,
    ciphersuite: 2 as const,
    signaturePublicKey: `signature:${githubUserId}:${deviceId}`,
    signatureKeyFingerprint: `signature-fingerprint:${githubUserId}:${deviceId}`,
    hpkePublicKey: `hpke:${githubUserId}:${deviceId}`,
    hpkeKeyFingerprint: `hpke-fingerprint:${githubUserId}:${deviceId}`,
    requiresRejoin: false
  };
}

test("native identity promises are shared only within an exact account and device scope", async () => {
  const calls: Array<{ githubUserId: string; deviceId: string }> = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: (_command: string, args: { request: { githubUserId: string; deviceId: string } }) => {
          calls.push(args.request);
          return Promise.resolve(nativeIdentity(args.request.githubUserId, args.request.deviceId));
        }
      }
    }
  });

  const first = loadOrCreateDeviceIdentity("github:one", "device-one");
  const repeated = loadOrCreateDeviceIdentity("github:one", "device-one");
  const otherDevice = loadOrCreateDeviceIdentity("github:one", "device-two");
  const otherAccount = loadOrCreateDeviceIdentity("github:two", "device-one");

  await Promise.all([first, repeated, otherDevice, otherAccount]);
  assert.deepEqual(calls, [
    { githubUserId: "github:one", deviceId: "device-one" },
    { githubUserId: "github:one", deviceId: "device-two" },
    { githubUserId: "github:two", deviceId: "device-one" }
  ]);
});

test("a rejected native identity initialization can be retried for the same scope", async () => {
  let attempts = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: (_command: string, args: { request: { githubUserId: string; deviceId: string } }) => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error("temporary failure"));
          return Promise.resolve(nativeIdentity(args.request.githubUserId, args.request.deviceId));
        }
      }
    }
  });

  await assert.rejects(loadOrCreateDeviceIdentity("github:retry", "device-retry"));
  const identity = await loadOrCreateDeviceIdentity("github:retry", "device-retry");
  assert.equal(identity.deviceId, "device-retry");
  assert.equal(attempts, 2);
});

test("native identity output must match the requested account and device before it can be cached", async () => {
  let returnMismatchedIdentity = true;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: (_command: string, args: { request: { githubUserId: string; deviceId: string } }) =>
          Promise.resolve(
            returnMismatchedIdentity
              ? nativeIdentity("github:other", "device-other")
              : nativeIdentity(args.request.githubUserId, args.request.deviceId)
          )
      }
    }
  });

  await assert.rejects(
    loadOrCreateDeviceIdentity("github:expected", "device-expected"),
    /does not match the requested account and device/
  );
  returnMismatchedIdentity = false;
  const identity = await loadOrCreateDeviceIdentity("github:expected", "device-expected");
  assert.equal(identity.githubUserId, "github:expected");
  assert.equal(identity.deviceId, "device-expected");
});
