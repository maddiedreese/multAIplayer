import test from "node:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  Database,
  WebSocket,
  assert,
  defaultWorkspaceFixture,
  delay,
  join,
  onceOpen,
  startRelayWithWorkspace,
  waitForJoined
} from "../support/relay.js";
import type { RelayHarness } from "../support/relay.js";

const env = {
  MULTAIPLAYER_RELAY_BACKLOG_LIMIT: "1000",
  MULTAIPLAYER_RELAY_RATE_LIMITS: "false",
  MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER: "100",
  MULTAIPLAYER_RELAY_METRICS_TOKEN: "soak-metrics-token-at-least-32-characters"
};
const teamId = "team-core";
const roomId = "room-desktop";
const userId = "github:maddiedreese";
const deviceId = "host-device-1";

const durationMs = envInteger("MULTAIPLAYER_RELAY_SOAK_DURATION_MS", 1_500);
const concurrentClients = envInteger("MULTAIPLAYER_RELAY_SOAK_CLIENTS", 8);
const restartCycles = envInteger("MULTAIPLAYER_RELAY_SOAK_RESTART_CYCLES", 2);
const roomCount = envInteger("MULTAIPLAYER_RELAY_SOAK_ROOMS", 50);
const memberCount = envInteger("MULTAIPLAYER_RELAY_SOAK_MEMBERS", 100);

test("deterministic relay chaos preserves SQLite and MLS ordering", { timeout: durationMs + 60_000 }, async () => {
  const startedAt = Date.now();
  const relay = await startRelayWithWorkspace(env, defaultWorkspaceFixture(roomCount, memberCount));
  const backupPath = join(relay.tempDir, "relay-live-backup.sqlite");
  let current: Awaited<ReturnType<typeof startRelayWithWorkspace>> | null = relay;
  let restored: Awaited<ReturnType<typeof startRelayWithWorkspace>> | null = null;
  let publisher: WebSocket | null = null;
  const messageIds: string[] = [];
  const acknowledgementLatencies: number[] = [];
  const reconnectLatencies: number[] = [];
  const requestLatencies: number[] = [];
  const errors: string[] = [];
  let maxActiveSockets = 0;
  let maxMetricsBytes = 0;
  let maxWalBytes = 0;
  let maxEventLoopDelayP99Ms = 0;
  let maxEventLoopDelayMs = 0;
  let reconnects = 0;
  let nextMessage = 0;
  try {
    publisher = await joinedSocket(relay.wsUrl, deviceId);
    acknowledgementLatencies.push(await publish(publisher, message("soak-commit-0", "commit", 0)));
    messageIds.push("soak-commit-0");
    publisher.close();
    publisher = null;

    for (let cycle = 0; cycle < restartCycles; cycle += 1) {
      const active: RelayHarness = current!;
      const phaseDeadline = Date.now() + Math.max(250, Math.floor(durationMs / restartCycles));
      publisher = await joinedSocket(active.wsUrl, deviceId);
      const churn = churnUntil(active.wsUrl, phaseDeadline, concurrentClients, reconnectLatencies, errors).then(
        (count) => (reconnects += count)
      );
      const sample = sampleOperationalBounds(active, phaseDeadline);
      const requests = requestUntil(active.baseUrl, phaseDeadline, requestLatencies, errors);
      const backup = cycle === 0 ? delay(50).then(() => liveBackup(active.dataPath, backupPath)) : Promise.resolve();
      while (Date.now() < phaseDeadline) {
        const id = `soak-application-${nextMessage++}`;
        acknowledgementLatencies.push(await publish(publisher, message(id, "application", 1)));
        messageIds.push(id);
      }
      await Promise.all([churn, backup, requests]);
      const bounds = await sample;
      maxActiveSockets = Math.max(maxActiveSockets, bounds.maxActiveSockets);
      maxMetricsBytes = Math.max(maxMetricsBytes, bounds.maxMetricsBytes);
      maxWalBytes = Math.max(maxWalBytes, bounds.maxWalBytes);
      maxEventLoopDelayP99Ms = Math.max(maxEventLoopDelayP99Ms, bounds.maxEventLoopDelayP99Ms);
      maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, bounds.maxEventLoopDelayMs);
      publisher.close();
      publisher = null;
      await delay(100);
      assert.equal((await relayMetrics(active.baseUrl)).activeSockets, 0, "cycle leaked WebSocket sessions");
      if (cycle % 2 === 0) await active.close({ preserveData: true });
      else await active.crash({ preserveData: true });
      current = cycle + 1 < restartCycles ? await startRelayWithWorkspace(env, undefined, relay.dataPath) : null;
    }

    assert.deepEqual(errors, []);

    const source = inspectDatabase(relay.dataPath);
    assert.equal(source.integrity, "ok");
    assert.equal(source.count, Math.min(1_000, messageIds.length));
    assert.equal(source.distinctCount, source.count);
    assert.equal(source.acceptedEpoch, 1);
    assert.equal(source.latestId, messageIds.at(-1));

    restored = await startRelayWithWorkspace(env, undefined, backupPath);
    const backup = inspectDatabase(backupPath);
    assert.equal(backup.integrity, "ok");
    assert.equal(backup.count, backup.distinctCount);
    assert.ok(backup.count >= 1 && backup.count <= source.count);
    assert.equal(backup.acceptedEpoch, 1);

    const reportsDir = fileURLToPath(new URL("../../reports/soak", import.meta.url));
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      join(reportsDir, "result.json"),
      `${JSON.stringify(
        {
          seed: 0,
          configuredDurationMs: durationMs,
          durationMs: Date.now() - startedAt,
          concurrentClients,
          roomCount,
          memberCount,
          restartCycles,
          reconnects,
          publishedMessages: messageIds.length,
          retainedMessages: source.count,
          restoredMessages: backup.count,
          acceptedEpoch: source.acceptedEpoch,
          integrity: source.integrity,
          acknowledgementLatencyMs: latencySummary(acknowledgementLatencies),
          reconnectLatencyMs: latencySummary(reconnectLatencies),
          requestLatencyMs: latencySummary(requestLatencies),
          eventLoopDelayMs: { p99: maxEventLoopDelayP99Ms, max: maxEventLoopDelayMs },
          maxActiveSockets,
          maxWalBytes,
          maxMetricsBytes,
          leakedSockets: 0,
          errors
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  } finally {
    publisher?.close();
    if (restored) await restored.close();
    else if (current) await current.close();
    else await relay.close();
  }
});

async function requestUntil(baseUrl: string, deadline: number, latencies: number[], errors: string[]) {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/teams`);
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`request returned ${response.status}`);
      latencies.push(performance.now() - started);
    } catch (error) {
      errors.push(String(error));
    }
    await delay(10);
  }
}

async function joinedSocket(wsUrl: string, socketDeviceId: string): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl);
  await onceOpen(socket);
  const joined = waitForJoined(socket);
  socket.send(JSON.stringify({ type: "join", teamId, roomId, userId, deviceId: socketDeviceId }));
  await joined;
  return socket;
}

async function churnUntil(
  wsUrl: string,
  deadline: number,
  clients: number,
  latencies: number[],
  errors: string[]
): Promise<number> {
  const workers = Array.from({ length: clients }, (_, worker) =>
    (async () => {
      let count = 0;
      while (Date.now() < deadline) {
        const started = Date.now();
        try {
          const socket = await joinedSocket(wsUrl, `${deviceId}-churn-${worker}`);
          latencies.push(Date.now() - started);
          socket.close();
          count += 1;
        } catch (error) {
          errors.push(String(error));
        }
        await delay(25);
      }
      return count;
    })()
  );
  return (await Promise.all(workers)).reduce((sum, count) => sum + count, 0);
}

function message(id: string, messageType: "application" | "commit", epochHint: number) {
  return {
    id,
    teamId,
    roomId,
    senderUserId: userId,
    senderDeviceId: deviceId,
    createdAt: new Date().toISOString(),
    messageType,
    epochHint,
    mlsMessage: "AA=="
  };
}

async function publish(socket: WebSocket, value: ReturnType<typeof message>): Promise<number> {
  const started = Date.now();
  const acknowledged = waitForMessage(socket, value.id);
  socket.send(JSON.stringify({ type: "publish", message: value }));
  await acknowledged;
  return Date.now() - started;
}

function waitForMessage(socket: WebSocket, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${id}`)), 5_000);
    const listener = (raw: Buffer) => {
      const value = JSON.parse(raw.toString()) as { type?: string; messageId?: string; message?: string };
      if (value.type === "error") {
        clearTimeout(timer);
        socket.off("message", listener);
        reject(new Error(value.message ?? "relay rejected soak message"));
      } else if (value.type === "published" && value.messageId === id) {
        clearTimeout(timer);
        socket.off("message", listener);
        resolve();
      }
    };
    socket.on("message", listener);
  });
}

async function sampleOperationalBounds(relay: { baseUrl: string; dataPath: string }, deadline: number) {
  let maxActiveSockets = 0;
  let maxMetricsBytes = 0;
  let maxWalBytes = 0;
  let maxEventLoopDelayP99Ms = 0;
  let maxEventLoopDelayMs = 0;
  while (Date.now() < deadline) {
    const metrics = await relayMetrics(relay.baseUrl);
    maxActiveSockets = Math.max(maxActiveSockets, metrics.activeSockets);
    maxMetricsBytes = Math.max(maxMetricsBytes, metrics.bytes);
    maxEventLoopDelayP99Ms = Math.max(maxEventLoopDelayP99Ms, metrics.eventLoopDelayP99Ms);
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, metrics.eventLoopDelayMaxMs);
    maxWalBytes = Math.max(maxWalBytes, await fileSize(`${relay.dataPath}-wal`));
    await delay(100);
  }
  return { maxActiveSockets, maxMetricsBytes, maxWalBytes, maxEventLoopDelayP99Ms, maxEventLoopDelayMs };
}

async function relayMetrics(baseUrl: string) {
  const response = await fetch(`${baseUrl}/metrics`, {
    headers: { authorization: `Bearer ${env.MULTAIPLAYER_RELAY_METRICS_TOKEN}` }
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.length > 0 && text.length < 1_000_000);
  assert.match(text, /multaiplayer_relay_envelopes_published_total/);
  const activeSockets = Number(text.match(/^multaiplayer_relay_active_sockets (\d+)$/m)?.[1] ?? "NaN");
  const eventLoopDelayP99Ms =
    Number(text.match(/^multaiplayer_relay_event_loop_delay_p99_seconds ([\d.e+-]+)$/m)?.[1] ?? "NaN") * 1_000;
  const eventLoopDelayMaxMs =
    Number(text.match(/^multaiplayer_relay_event_loop_delay_max_seconds ([\d.e+-]+)$/m)?.[1] ?? "NaN") * 1_000;
  assert.ok(Number.isFinite(activeSockets));
  assert.ok(Number.isFinite(eventLoopDelayP99Ms));
  assert.ok(Number.isFinite(eventLoopDelayMaxMs));
  return { activeSockets, bytes: text.length, eventLoopDelayP99Ms, eventLoopDelayMaxMs };
}

async function fileSize(path: string): Promise<number> {
  return stat(path).then(
    (value) => value.size,
    () => 0
  );
}

function latencySummary(values: number[]) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1)!
  };
}

function percentile(sorted: number[], quantile: number) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}

function envInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function liveBackup(sourcePath: string, backupPath: string) {
  const database = new Database(sourcePath);
  try {
    await database.backup(backupPath);
  } finally {
    database.close();
  }
}

function inspectDatabase(path: string) {
  const database = new Database(path, { readonly: true });
  try {
    const integrity = (database.pragma("integrity_check", { simple: true }) as string) ?? "unknown";
    const counts = database
      .prepare("select count(*) as count, count(distinct message_id) as distinctCount from relay_mls_messages")
      .get() as { count: number; distinctCount: number };
    const epoch = database
      .prepare("select accepted_epoch as acceptedEpoch from relay_room_epochs where room_key = ?")
      .get(`${teamId}:${roomId}`) as { acceptedEpoch: number } | undefined;
    const latest = database
      .prepare("select message_id as id from relay_mls_messages where room_key = ? order by sort_order desc limit 1")
      .get(`${teamId}:${roomId}`) as { id: string } | undefined;
    return { integrity, ...counts, acceptedEpoch: epoch?.acceptedEpoch ?? 0, latestId: latest?.id };
  } finally {
    database.close();
  }
}
