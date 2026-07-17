import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { deviceIdentityFailureMessage, useDeviceIdentityLifecycle } from "../src/hooks/useDeviceIdentityLifecycle";
import { useGitHubAuth } from "../src/hooks/useGitHubAuth";
import { useAppStore } from "../src/store/appStore";
import { NativeCommandError } from "../src/lib/platform/nativeCommandError";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:1420/"
});

Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.setItem(
    "multaiplayer:app-config",
    JSON.stringify({ relayHttpUrl: "http://127.0.0.1:4322", relayWsUrl: "ws://127.0.0.1:4322/rooms" })
  );
  useAppStore.getState().resetAppStore();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function installAuthResponses(options: {
  mutationsRequireAuth: boolean;
  authenticated: () => boolean;
  onAuthMe?: () => void;
}) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/config")) {
      return Response.json({
        provider: "github",
        configured: true,
        scopes: ["read:user"],
        mutationsRequireAuth: options.mutationsRequireAuth,
        allowedOrigins: ["http://127.0.0.1:1420"],
        sessionPersistence: "identity_only"
      });
    }
    if (url.endsWith("/auth/me")) {
      options.onAuthMe?.();
      return options.authenticated()
        ? Response.json({ user: { id: "github:native-host", login: "native-host", name: "Native Host" } })
        : Response.json({ error: "authentication required" }, { status: 401 });
    }
    throw new Error(`Unexpected auth bootstrap request: ${url}`);
  };
}

test("auth-required startup keeps native identity gated after an unauthenticated /auth/me response", async () => {
  let authenticated = false;
  let authMeResponses = 0;
  installAuthResponses({
    mutationsRequireAuth: true,
    authenticated: () => authenticated,
    onAuthMe: () => {
      authMeResponses += 1;
    }
  });

  const first = renderHook(() => useGitHubAuth("http://127.0.0.1:4322"));
  await waitFor(() => assert.equal(first.result.current.authConfig?.mutationsRequireAuth, true));
  await waitFor(() => assert.equal(authMeResponses, 1));
  assert.equal(first.result.current.currentUser, null);
  assert.equal(first.result.current.identityResolved, false);

  first.unmount();
  authenticated = true;
  const refreshed = renderHook(() => useGitHubAuth("http://127.0.0.1:4322"));
  await waitFor(() => assert.equal(refreshed.result.current.currentUser?.id, "github:native-host"));
  await waitFor(() => assert.equal(refreshed.result.current.identityResolved, true));
});

test("unauthenticated LAN mode enables a local identity only after auth policy and user resolution", async () => {
  installAuthResponses({ mutationsRequireAuth: false, authenticated: () => false });

  const auth = renderHook(() => useGitHubAuth("http://127.0.0.1:4322"));
  assert.equal(auth.result.current.identityResolved, false);
  await waitFor(() => assert.equal(auth.result.current.authConfig?.mutationsRequireAuth, false));
  await waitFor(() => assert.equal(auth.result.current.identityResolved, true));
  assert.equal(auth.result.current.currentUser, null);
});

test("failed auth configuration settles fail closed and retries config plus current-user resolution once", async () => {
  let configRequests = 0;
  let userRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/config")) {
      configRequests += 1;
      return configRequests === 1
        ? Response.json({ error: "temporary relay failure" }, { status: 503 })
        : Response.json({
            provider: "github",
            configured: true,
            scopes: ["read:user"],
            mutationsRequireAuth: true,
            allowedOrigins: ["http://127.0.0.1:1420"],
            sessionPersistence: "identity_only"
          });
    }
    if (url.endsWith("/auth/me")) {
      userRequests += 1;
      return userRequests === 1
        ? Response.json({ error: "authentication required" }, { status: 401 })
        : Response.json({ user: { id: "github:recovered", login: "recovered" } });
    }
    throw new Error(`Unexpected auth recovery request: ${url}`);
  };

  const auth = renderHook(() => useGitHubAuth("http://127.0.0.1:4322"));
  await waitFor(() => assert.equal(auth.result.current.authConfigResolved, true));
  await waitFor(() => assert.equal(auth.result.current.currentUserResolved, true));
  assert.equal(auth.result.current.authConfig, null, "unknown policy must not fall back to anonymous LAN mode");
  assert.equal(auth.result.current.identityResolved, false);
  assert.match(auth.result.current.authError ?? "", /temporary relay failure/);

  act(() => auth.result.current.retryAuthBootstrap());
  await waitFor(() => assert.equal(auth.result.current.currentUser?.id, "github:recovered"));
  await waitFor(() => assert.equal(auth.result.current.identityResolved, true));
  assert.equal(configRequests, 2);
  assert.equal(userRequests, 2);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(configRequests, 2, "stable resolved auth must not create a retry loop");
  assert.equal(userRequests, 2, "stable resolved user state must not create a retry loop");
});

test("device identity lifecycle never invokes native MLS before identity resolution", async () => {
  const invocations: Array<{ command: string; args: unknown }> = [];
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: unknown) => {
      invocations.push({ command, args });
      return {
        githubUserId: "github:native-host",
        deviceId: "device-native-host",
        ciphersuite: 2,
        signaturePublicKey: "signature-key",
        signatureKeyFingerprint: "sha256:signature",
        hpkePublicKey: "hpke-key",
        hpkeKeyFingerprint: "sha256:hpke",
        requiresRejoin: false
      };
    }
  };
  const noop = () => undefined;
  const lifecycle = renderHook(
    ({ identityResolved }: { identityResolved: boolean }) =>
      useDeviceIdentityLifecycle({
        relayHttpUrl: "http://127.0.0.1:4322",
        identityResolved,
        deviceId: "device-native-host",
        userId: "github:native-host",
        displayName: "Native Host",
        deviceIdentity: null,
        replaceDeviceIdentity: noop,
        setDeviceIdentityStatusMessage: noop
      }),
    { initialProps: { identityResolved: false } }
  );

  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(invocations.length, 0);

  lifecycle.rerender({ identityResolved: true });
  await waitFor(() => assert.equal(invocations.length, 1));
  assert.deepEqual(invocations[0], {
    command: "mls_identity_initialize",
    args: { request: { githubUserId: "github:native-host", deviceId: "device-native-host" } }
  });
});

test("device identity remediation reserves account-switching copy for a typed scope mismatch", () => {
  const mismatch = deviceIdentityFailureMessage(
    new NativeCommandError("identity_scope_mismatch", "Native copy may change")
  );
  assert.match(mismatch, /Sign back into the original account/);
  assert.match(mismatch, /account switching .* is not supported/i);

  const storageFailure = deviceIdentityFailureMessage(
    new NativeCommandError("storage_error", "Keychain access was denied")
  );
  assert.match(storageFailure, /Keychain access and local storage/);
  assert.doesNotMatch(storageFailure, /Keychain access was denied/);
  assert.doesNotMatch(storageFailure, /original account|account switching/i);
});

test("an old identity registration cannot restore its device session after identity is unresolved", async () => {
  let releaseSession!: (response: Response) => void;
  const deferredSession = new Promise<Response>((resolve) => {
    releaseSession = resolve;
  });
  let sessionRequested = false;
  const statuses: Array<string | null> = [];
  const identity = {
    githubUserId: "github:old",
    deviceId: "device-shared",
    ciphersuite: 2 as const,
    signaturePublicKey: "signature-key",
    signatureKeyFingerprint: "sha256:signature",
    publicKeyFingerprint: "sha256:signature",
    hpkePublicKey: "hpke-key",
    hpkeKeyFingerprint: "sha256:hpke",
    requiresRejoin: false
  };
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (command: string) => {
      if (command === "mls_identity_initialize") return identity;
      if (command === "mls_device_auth_sign") {
        return { signatureDer: "c2lnbmF0dXJl", publicKeySpkiDer: "a2V5" };
      }
      throw new Error(`Unexpected native command: ${command}`);
    }
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/devices") && init?.method === "POST") {
      return Response.json({ device: { deviceId: identity.deviceId } });
    }
    if (url.endsWith("/challenge")) {
      return Response.json({ challenge: "Y2hhbGxlbmdl", expiresAt: "2030-01-01T00:00:00.000Z" });
    }
    if (url.endsWith("/session")) {
      sessionRequested = true;
      return deferredSession;
    }
    throw new Error(`Unexpected device lifecycle request: ${url}`);
  };

  const lifecycle = renderHook(
    ({ identityResolved }: { identityResolved: boolean }) =>
      useDeviceIdentityLifecycle({
        relayHttpUrl: "http://127.0.0.1:4322",
        identityResolved,
        deviceId: identity.deviceId,
        userId: identity.githubUserId,
        displayName: "Old account",
        deviceIdentity: identity,
        replaceDeviceIdentity: () => undefined,
        setDeviceIdentityStatusMessage: (message) => statuses.push(message)
      }),
    { initialProps: { identityResolved: true } }
  );

  await waitFor(() => assert.equal(sessionRequested, true));
  lifecycle.rerender({ identityResolved: false });
  releaseSession(Response.json({ deviceSessionToken: "stale-old-token", expiresAt: "2030-01-01T00:15:00.000Z" }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.equal(useAppStore.getState().deviceSessionToken, null);
  assert.equal(statuses.includes("Device identity registered and authenticated with relay."), false);
  assert.equal(
    statuses.some((message) => message?.includes("stale-old-token")),
    false
  );
});
