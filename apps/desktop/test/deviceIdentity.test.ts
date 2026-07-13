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

const { loadOrCreateDeviceIdentity, resetDeviceIdentity } = await import("../src/lib/deviceIdentity");

test.beforeEach(() => {
  localStorage.clear();
});

test("web preview cannot create or load a device identity", async () => {
  await assert.rejects(loadOrCreateDeviceIdentity(), /only in the native desktop app/);
  assert.equal(localStorage.getItem("multaiplayer:device-identity:v1"), null);
});

test("web preview cannot reset a native device identity", async () => {
  await assert.rejects(resetDeviceIdentity(), /only in the native desktop app/);
});
