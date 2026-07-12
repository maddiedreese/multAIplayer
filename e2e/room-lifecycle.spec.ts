import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { RelayEnvelope } from "@multaiplayer/protocol";
import {
  admitClient,
  createRoom,
  nextRelayEnvelope,
  openAuthenticatedClient,
  sendRoomMessage,
  type TestIdentity
} from "./helpers";

const removedIdentity: TestIdentity = {
  id: "github:e2e-removed-member",
  login: "e2e-removed-member",
  name: "Removed Member"
};
const successorIdentity: TestIdentity = {
  id: "github:e2e-successor",
  login: "e2e-successor",
  name: "Successor"
};

async function expectRelayPersistenceExcludes(markers: string[]): Promise<void> {
  const dataPath = process.env.MULTAIPLAYER_E2E_RELAY_DATA_PATH;
  expect(dataPath, "lifecycle E2E relay data path").toBeTruthy();
  const inspected: string[] = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${dataPath}${suffix}`;
    try {
      const bytes = await readFile(path);
      inspected.push(path);
      for (const marker of markers) {
        expect(bytes.includes(Buffer.from(marker, "utf8")), `${path} contains plaintext lifecycle content`).toBe(false);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  expect(inspected, "SQLite database or live sidecars inspected").not.toHaveLength(0);
}

async function roomKeyring(page: Page, roomId: string) {
  return page.evaluate(async (id) => {
    const loadModule = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<typeof import("../apps/desktop/src/lib/localHistory")>;
    const { loadRoomKeyring } = await loadModule("/src/lib/localHistory.ts");
    return loadRoomKeyring(id);
  }, roomId);
}

async function decryptEnvelopeWithClient(
  page: Page,
  envelope: RelayEnvelope,
  secret: NonNullable<Awaited<ReturnType<typeof roomKeyring>>>["keys"][string]
): Promise<boolean> {
  return page.evaluate(
    async ({ encryptedEnvelope, roomSecret }) => {
      const loadModule = new Function("specifier", "return import(specifier)") as (
        specifier: string
      ) => Promise<typeof import("../apps/desktop/src/lib/encryptedEnvelope")>;
      const { decryptRoomEnvelope } = await loadModule("/src/lib/encryptedEnvelope.ts");
      try {
        await decryptRoomEnvelope(encryptedEnvelope, roomSecret);
        return true;
      } catch {
        return false;
      }
    },
    { encryptedEnvelope: envelope, roomSecret: secret }
  );
}

test("real relay lifecycle preserves encrypted coordination across rotation, removal, and host handoff", async ({
  browser
}) => {
  test.setTimeout(120_000);
  const clients: Array<Awaited<ReturnType<typeof openAuthenticatedClient>>> = [];
  try {
    const host = await openAuthenticatedClient(browser);
    const removed = await openAuthenticatedClient(browser, removedIdentity);
    const successor = await openAuthenticatedClient(browser, successorIdentity);
    clients.push(host, removed, successor);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const teamName = `Lifecycle team ${suffix}`;
    const roomName = `Lifecycle room ${suffix}`;

    await host.page.getByRole("button", { name: "New team" }).click();
    await host.page.getByPlaceholder("Team name").fill(teamName);
    await host.page.getByRole("button", { name: "Create team" }).click();
    await expect(host.page.locator(".team-select", { hasText: teamName })).toBeVisible();
    await createRoom(host.page, roomName);
    const roomId = await host.page.evaluate(async (name) => {
      const response = await fetch("http://127.0.0.1:4322/teams", { credentials: "include" });
      const workspace = (await response.json()) as { rooms: Array<{ id: string; name: string }> };
      const room = workspace.rooms.find((candidate) => candidate.name === name);
      if (!room) throw new Error(`Room ${name} was not returned by the relay.`);
      return room.id;
    }, roomName);
    await host.page.getByRole("button", { name: "Host", exact: true }).click();
    await expect(host.page.getByRole("button", { name: "Handoff", exact: true })).toBeEnabled();

    await admitClient(host.page, removed.page);
    await expect(removed.page.getByRole("textbox", { name: "Room title" })).toHaveValue(roomName);
    await admitClient(host.page, successor.page);
    await expect(successor.page.getByRole("textbox", { name: "Room title" })).toHaveValue(roomName);

    const beforeRotation = `before rotation ${suffix}`;
    await sendRoomMessage(removed.page, beforeRotation);
    await expect(host.page.getByText(beforeRotation, { exact: true })).toBeVisible();
    await expect(successor.page.getByText(beforeRotation, { exact: true })).toBeVisible();

    await host.page.getByRole("button", { name: "Room", exact: true }).click();
    host.page.once("dialog", (dialog) => dialog.accept());
    await host.page.getByRole("button", { name: "Refresh room access" }).click();
    await expect(host.page.getByText("Refreshed room access for future messages and invites.")).toBeVisible();

    const afterRotation = `after rotation ${suffix}`;
    await sendRoomMessage(host.page, afterRotation);
    await expect(removed.page.getByText(afterRotation, { exact: true })).toBeVisible();
    await expect(successor.page.getByText(afterRotation, { exact: true })).toBeVisible();
    const removedPreRemovalKeyring = await roomKeyring(removed.page, roomId);
    expect(removedPreRemovalKeyring).not.toBeNull();

    const removedRow = host.page.locator(".team-member-row", { hasText: removedIdentity.id });
    await expect(removedRow).toBeVisible();
    await removedRow.getByRole("button", { name: "Remove" }).click();
    await expect(host.page.getByText(new RegExp(`Removed ${removedIdentity.login} from ${teamName}`))).toBeVisible();

    await expect(removed.page.getByPlaceholder(/access .* was removed on the relay/i)).toBeDisabled();
    const removedAccessStatus = await removed.page.evaluate(
      async ({ roomName }) => {
        const response = await fetch("http://127.0.0.1:4322/teams", { credentials: "include" });
        return { status: response.status, body: await response.text(), roomName };
      },
      { roomName }
    );
    expect(removedAccessStatus.status).toBe(200);
    expect(removedAccessStatus.body).not.toContain(roomName);

    const afterRemoval = `only current members ${suffix}`;
    const postRemovalEnvelopePromise = nextRelayEnvelope(
      successor.page,
      "chat.message",
      (envelope) => envelope.keyEpoch > removedPreRemovalKeyring!.currentEpoch
    );
    await sendRoomMessage(host.page, afterRemoval);
    const postRemovalEnvelope = await postRemovalEnvelopePromise;
    await expect(successor.page.getByText(afterRemoval, { exact: true })).toBeVisible();
    await expect(removed.page.getByText(afterRemoval, { exact: true })).toHaveCount(0);
    expect(postRemovalEnvelope.keyEpoch).toBeGreaterThan(removedPreRemovalKeyring!.currentEpoch);
    const removedOldSecret = removedPreRemovalKeyring!.keys[String(removedPreRemovalKeyring!.currentEpoch)]!;
    expect(await decryptEnvelopeWithClient(removed.page, postRemovalEnvelope, removedOldSecret)).toBe(false);
    const successorPostRemovalKeyring = await roomKeyring(successor.page, roomId);
    expect(successorPostRemovalKeyring?.currentEpoch).toBe(postRemovalEnvelope.keyEpoch);
    const successorNewSecret = successorPostRemovalKeyring!.keys[String(postRemovalEnvelope.keyEpoch)]!;
    expect(await decryptEnvelopeWithClient(successor.page, postRemovalEnvelope, successorNewSecret)).toBe(true);

    const handoffEnvelopePromise = nextRelayEnvelope(successor.page, "room.host");
    await host.page.getByRole("button", { name: "Handoff", exact: true }).click();
    const handoffEnvelope = await handoffEnvelopePromise;
    await expect(host.page.getByText(`${roomName} is ready for host handoff.`)).toBeVisible({ timeout: 15_000 });
    await successor.page.getByRole("button", { name: "Room", exact: true }).click();
    await expect(successor.page.locator(".handoff-row.available")).toBeVisible({ timeout: 15_000 });
    await successor.page.locator(".handoff-row.available").getByRole("button", { name: "Accept" }).click();
    await expect(successor.page.getByText(new RegExp(`You are now hosting ${roomName}`))).toBeVisible();
    await expect(successor.page.getByRole("button", { name: "Handoff", exact: true })).toBeEnabled();
    await expect(host.page.getByRole("button", { name: "Handoff", exact: true })).toBeDisabled();

    const afterHandoff = `successor coordination ${suffix}`;
    await sendRoomMessage(successor.page, afterHandoff);
    await expect(host.page.getByText(afterHandoff, { exact: true })).toBeVisible();
    await expect(removed.page.getByText(afterHandoff, { exact: true })).toHaveCount(0);

    // These exact strings traversed the production desktop encryption path.
    // Scan both the database and live WAL/SHM sidecars before the E2E runner
    // removes them, making the relay's no-plaintext-content claim executable.
    const handoffKeyring = await roomKeyring(successor.page, roomId);
    const handoffSecret = handoffKeyring!.keys[String(handoffEnvelope.keyEpoch)]!;
    const handoffPlaintext = await successor.page.evaluate(
      async ({ envelope, secret }) => {
        const loadModule = new Function("specifier", "return import(specifier)") as (
          specifier: string
        ) => Promise<typeof import("../apps/desktop/src/lib/encryptedEnvelope")>;
        const { decryptRoomEnvelope } = await loadModule("/src/lib/encryptedEnvelope.ts");
        return decryptRoomEnvelope<{ id: string }>(envelope, secret);
      },
      { envelope: handoffEnvelope, secret: handoffSecret }
    );
    await expectRelayPersistenceExcludes([
      beforeRotation,
      afterRotation,
      afterRemoval,
      afterHandoff,
      handoffPlaintext.id
    ]);
  } finally {
    await Promise.all(clients.map(({ context }) => context.close()));
  }
});
