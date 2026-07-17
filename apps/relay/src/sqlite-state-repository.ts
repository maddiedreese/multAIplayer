import Database from "better-sqlite3";
import { isRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import type { RoomKey } from "./state.js";
import type { StoredRelayMutation } from "./persistence-types.js";

export function loadNormalizedRelayState(db: Database.Database): unknown | null {
  const version = db.prepare("select value from relay_meta where key = ?").get("version") as
    { value?: unknown } | undefined;
  if (version?.value !== "1") {
    if (version?.value !== undefined || relayDatabaseContainsDurableState(db)) {
      throw new Error("Existing relay database has missing or unsupported version metadata.");
    }
    return null;
  }
  const savedAt = db.prepare("select value from relay_meta where key = ?").get("savedAt") as
    { value?: unknown } | undefined;
  return {
    version: 1,
    savedAt: typeof savedAt?.value === "string" ? savedAt.value : new Date().toISOString(),
    teams: loadJsonRows(db, "relay_teams", "id"),
    rooms: loadJsonRows(db, "relay_rooms", "id"),
    invites: loadJsonRows(db, "relay_invites", "id"),
    devices: loadJsonRows(db, "relay_devices", "key"),
    keyPackages: loadJsonRows(db, "relay_key_packages", "id"),
    consumedKeyPackages: loadJsonRows(db, "relay_consumed_key_packages", "key_package_hash"),
    inviteRequests: loadJsonRows(db, "relay_invite_requests", "id"),
    inviteResponses: loadJsonRows(db, "relay_invite_responses", "id"),
    inviteAckReceipts: loadJsonRows(db, "relay_invite_ack_receipts", "id"),
    acceptedMessageReceipts: loadJsonRows(db, "relay_accepted_message_receipts", "id"),
    teamMembers: loadJsonRows(db, "relay_team_members", "team_id"),
    authSessions: loadJsonRows(db, "relay_auth_sessions", "session_id"),
    accountRestrictions: loadJsonRows(db, "relay_account_restrictions", "user_id"),
    accountQuotaRecords: loadJsonRows(db, "relay_account_quota_records", "quota_key"),
    attachmentBlobs: loadJsonRows(db, "relay_attachment_blobs", "id"),
    mlsBacklog: loadMlsBacklogRows(db)
  };
}

const relayEntityTables: Record<
  Exclude<StoredRelayMutation["entity"], "mlsBacklog">,
  { table: string; keyColumn: string }
> = {
  teams: { table: "relay_teams", keyColumn: "id" },
  rooms: { table: "relay_rooms", keyColumn: "id" },
  invites: { table: "relay_invites", keyColumn: "id" },
  devices: { table: "relay_devices", keyColumn: "key" },
  keyPackages: { table: "relay_key_packages", keyColumn: "id" },
  consumedKeyPackages: { table: "relay_consumed_key_packages", keyColumn: "key_package_hash" },
  inviteRequests: { table: "relay_invite_requests", keyColumn: "id" },
  inviteResponses: { table: "relay_invite_responses", keyColumn: "id" },
  inviteAckReceipts: { table: "relay_invite_ack_receipts", keyColumn: "id" },
  acceptedMessageReceipts: { table: "relay_accepted_message_receipts", keyColumn: "id" },
  teamMembers: { table: "relay_team_members", keyColumn: "team_id" },
  authSessions: { table: "relay_auth_sessions", keyColumn: "session_id" },
  accountRestrictions: { table: "relay_account_restrictions", keyColumn: "user_id" },
  accountQuotaRecords: { table: "relay_account_quota_records", keyColumn: "quota_key" },
  attachmentBlobs: { table: "relay_attachment_blobs", keyColumn: "id" }
};

export function applyStoredRelayMutations(db: Database.Database, changes: StoredRelayMutation[]) {
  db.transaction(() => applyStoredRelayMutationsInTransaction(db, changes))();
}

export function applyStoredRelayMutationsInTransaction(
  db: Database.Database,
  changes: StoredRelayMutation[],
  skippedEntities: ReadonlySet<StoredRelayMutation["entity"]> = new Set()
) {
  const upsertMeta = db.prepare(
    "insert into relay_meta (key, value) values (?, ?) on conflict(key) do update set value=excluded.value"
  );
  upsertMeta.run("version", "1");
  upsertMeta.run("savedAt", new Date().toISOString());

  for (const change of changes) {
    if (skippedEntities.has(change.entity)) continue;
    if (change.entity === "mlsBacklog") {
      const messages =
        change.operation === "upsert" && isRecord(change.value) && Array.isArray(change.value.messages)
          ? (change.value.messages as MlsRelayMessage[])
          : [];
      saveMlsBacklogRowsInTransaction(db, change.key as RoomKey, messages);
      continue;
    }

    const { table, keyColumn } = relayEntityTables[change.entity];
    if (change.operation === "delete") {
      const roomKey =
        change.entity === "rooms"
          ? roomStorageKey(
              change.key,
              db.prepare("select data_json from relay_rooms where id = ?").get(change.key) as
                { data_json?: unknown } | undefined
            )
          : null;
      db.prepare(`delete from ${table} where ${keyColumn} = ?`).run(change.key);
      if (roomKey) db.prepare("delete from relay_room_epochs where room_key = ?").run(roomKey);
      continue;
    }
    db.prepare(
      `insert into ${table} (${keyColumn}, data_json) values (?, ?) on conflict(${keyColumn}) do update set data_json=excluded.data_json`
    ).run(change.key, JSON.stringify(change.value));
    if (change.entity === "rooms" && isRecord(change.value) && typeof change.value.teamId === "string") {
      const acceptedEpoch =
        typeof change.value.acceptedMlsEpoch === "number" && Number.isSafeInteger(change.value.acceptedMlsEpoch)
          ? change.value.acceptedMlsEpoch
          : 0;
      db.prepare(
        "insert into relay_room_epochs (room_key, accepted_epoch) values (?, ?) on conflict(room_key) do update set accepted_epoch=excluded.accepted_epoch"
      ).run(`${change.value.teamId}:${change.key}`, acceptedEpoch);
    }
  }
}

function roomStorageKey(roomId: string, row: { data_json?: unknown } | undefined): string | null {
  if (typeof row?.data_json !== "string") return null;
  try {
    const room = JSON.parse(row.data_json) as unknown;
    return isRecord(room) && typeof room.teamId === "string" ? `${room.teamId}:${roomId}` : null;
  } catch {
    return null;
  }
}

export function saveNormalizedRelayState(db: Database.Database, state: unknown) {
  if (!isRecord(state) || Array.isArray(state)) {
    throw new Error("Cannot persist malformed relay state.");
  }
  const savedAt = typeof state.savedAt === "string" ? state.savedAt : new Date().toISOString();
  db.transaction(() => {
    clearNormalizedRelayTables(db);
    db.prepare("insert into relay_meta (key, value) values (?, ?)").run("version", String(state.version ?? 1));
    db.prepare("insert into relay_meta (key, value) values (?, ?)").run("savedAt", savedAt);
    saveJsonRows(db, "relay_teams", "id", state.teams, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_rooms", "id", state.rooms, (item) => relayId(item, "id"));
    if (Array.isArray(state.rooms)) {
      const upsertEpoch = db.prepare(
        "insert into relay_room_epochs (room_key, accepted_epoch) values (?, ?) on conflict(room_key) do update set accepted_epoch=excluded.accepted_epoch"
      );
      for (const room of state.rooms)
        if (isRecord(room) && typeof room.teamId === "string" && typeof room.id === "string")
          upsertEpoch.run(
            `${room.teamId}:${room.id}`,
            typeof room.acceptedMlsEpoch === "number" ? room.acceptedMlsEpoch : 0
          );
    }
    saveJsonRows(db, "relay_invites", "id", state.invites, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_devices", "key", state.devices, (item) => {
      const userId = relayId(item, "userId");
      const deviceId = relayId(item, "deviceId");
      return userId && deviceId ? `${userId}:${deviceId}` : null;
    });
    saveJsonRows(db, "relay_key_packages", "id", state.keyPackages, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_consumed_key_packages", "key_package_hash", state.consumedKeyPackages, (item) =>
      relayId(item, "keyPackageHash")
    );
    saveJsonRows(db, "relay_invite_requests", "id", state.inviteRequests, (item) => relayId(item, "requestId"));
    saveJsonRows(db, "relay_invite_responses", "id", state.inviteResponses, (item) => relayId(item, "requestId"));
    saveJsonRows(db, "relay_invite_ack_receipts", "id", state.inviteAckReceipts, (item) => relayId(item, "requestId"));
    saveJsonRows(db, "relay_accepted_message_receipts", "id", state.acceptedMessageReceipts, (item) => {
      if (!isRecord(item) || typeof item.roomKey !== "string") return null;
      const messageId = relayId(item, "messageId");
      return messageId ? JSON.stringify([item.roomKey, messageId]) : null;
    });
    saveJsonRows(db, "relay_team_members", "team_id", state.teamMembers, (item) => relayId(item, "teamId"));
    saveJsonRows(db, "relay_auth_sessions", "session_id", state.authSessions, (item) => relayId(item, "sessionIdHash"));
    saveJsonRows(db, "relay_account_restrictions", "user_id", state.accountRestrictions, (item) =>
      relayId(item, "userId")
    );
    saveJsonRows(db, "relay_account_quota_records", "quota_key", state.accountQuotaRecords, (item) =>
      relayId(item, "key")
    );
    saveJsonRows(db, "relay_attachment_blobs", "id", state.attachmentBlobs, (item) => relayId(item, "id"));
    pruneMlsMessageRows(db, state.mlsBacklog);
  })();
}

function clearNormalizedRelayTables(db: Database.Database) {
  for (const table of [
    "relay_meta",
    "relay_teams",
    "relay_rooms",
    "relay_invites",
    "relay_devices",
    "relay_key_packages",
    "relay_consumed_key_packages",
    "relay_invite_requests",
    "relay_invite_responses",
    "relay_invite_ack_receipts",
    "relay_accepted_message_receipts",
    "relay_team_members",
    "relay_auth_sessions",
    "relay_account_restrictions",
    "relay_account_quota_records",
    "relay_attachment_blobs"
  ]) {
    db.prepare(`delete from ${table}`).run();
  }
}

function loadMlsBacklogRows(db: Database.Database): unknown[] {
  const rows = db
    .prepare("select room_key, message_id, data_json from relay_mls_messages order by room_key, sort_order, message_id")
    .all() as Array<{ room_key?: unknown; message_id?: unknown; data_json?: unknown }>;

  const backlog = new Map<string, unknown[]>();
  for (const row of rows) {
    if (typeof row.room_key !== "string" || typeof row.message_id !== "string" || typeof row.data_json !== "string") {
      throw new Error("Relay MLS backlog contains a malformed row.");
    }
    try {
      const parsed = JSON.parse(row.data_json) as unknown;
      if (
        !isRecord(parsed) ||
        parsed.id !== row.message_id ||
        typeof parsed.teamId !== "string" ||
        typeof parsed.roomId !== "string" ||
        `${parsed.teamId}:${parsed.roomId}` !== row.room_key
      ) {
        throw new Error("Relay MLS backlog row identity does not match its storage key.");
      }
      const messages = backlog.get(row.room_key) ?? [];
      messages.push(parsed);
      backlog.set(row.room_key, messages);
    } catch {
      throw new Error("Relay MLS backlog contains malformed JSON or a mismatched row identity.");
    }
  }
  return Array.from(backlog.entries()).map(([key, messages]) => ({ key, messages }));
}

export function saveMlsBacklogRows(db: Database.Database, roomKey: RoomKey, messages: MlsRelayMessage[]) {
  db.transaction(() => saveMlsBacklogRowsInTransaction(db, roomKey, messages))();
}

function saveMlsBacklogRowsInTransaction(db: Database.Database, roomKey: RoomKey, messages: MlsRelayMessage[]) {
  if (messages.length === 0) {
    db.prepare("delete from relay_mls_messages where room_key = ?").run(roomKey);
    return;
  }
  const messageIds = new Set(messages.map((message) => message.id));
  const existing = db.prepare("select message_id from relay_mls_messages where room_key = ?").all(roomKey) as Array<{
    message_id?: unknown;
  }>;
  const deleteMessage = db.prepare("delete from relay_mls_messages where room_key = ? and message_id = ?");
  for (const row of existing) {
    if (typeof row.message_id === "string" && !messageIds.has(row.message_id)) {
      deleteMessage.run(roomKey, row.message_id);
    }
  }

  const upsert = db.prepare(`
      insert into relay_mls_messages (room_key, message_id, sort_order, created_at, data_json)
      values (?, ?, ?, ?, ?)
      on conflict(room_key, message_id) do update set
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        data_json = excluded.data_json
    `);
  for (const [index, message] of messages.entries()) {
    upsert.run(roomKey, message.id, index, message.createdAt, JSON.stringify(message));
  }
}

function pruneMlsMessageRows(db: Database.Database, mlsBacklog: unknown) {
  if (!Array.isArray(mlsBacklog)) return;
  const retainedByRoom = new Map<string, Set<string>>();
  for (const item of mlsBacklog) {
    if (!isRecord(item) || Array.isArray(item) || typeof item.key !== "string" || !Array.isArray(item.messages))
      continue;
    retainedByRoom.set(
      item.key,
      new Set(
        item.messages
          .filter((message): message is Record<string, unknown> => isRecord(message) && !Array.isArray(message))
          .map((message) => message.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
  }

  const rows = db.prepare("select room_key, message_id from relay_mls_messages").all() as Array<{
    room_key?: unknown;
    message_id?: unknown;
  }>;
  const deleteMessage = db.prepare("delete from relay_mls_messages where room_key = ? and message_id = ?");
  for (const row of rows) {
    if (typeof row.room_key !== "string" || typeof row.message_id !== "string") continue;
    if (!retainedByRoom.get(row.room_key)?.has(row.message_id)) {
      deleteMessage.run(row.room_key, row.message_id);
    }
  }
}

export function appendMlsBacklogRow(
  db: Database.Database,
  roomKey: RoomKey,
  message: MlsRelayMessage,
  prunedMessageIds: string[]
) {
  db.transaction(() => {
    const deleteMessage = db.prepare("delete from relay_mls_messages where room_key = ? and message_id = ?");
    for (const messageId of prunedMessageIds) {
      deleteMessage.run(roomKey, messageId);
    }

    const latest = db
      .prepare("select max(sort_order) as sort_order from relay_mls_messages where room_key = ?")
      .get(roomKey) as { sort_order?: unknown } | undefined;
    const nextSortOrder = typeof latest?.sort_order === "number" ? latest.sort_order + 1 : 0;
    db.prepare(
      `
      insert or ignore into relay_mls_messages (room_key, message_id, sort_order, created_at, data_json)
      values (?, ?, ?, ?, ?)
    `
    ).run(roomKey, message.id, nextSortOrder, message.createdAt, JSON.stringify(message));
  })();
}

function loadJsonRows(db: Database.Database, table: string, keyColumn: string): unknown[] {
  const rows = db
    .prepare(`select ${keyColumn} as storage_key, data_json from ${table} order by ${keyColumn}`)
    .all() as Array<{
    storage_key?: unknown;
    data_json?: unknown;
  }>;
  const values: unknown[] = [];
  for (const row of rows) {
    if (typeof row.storage_key !== "string" || typeof row.data_json !== "string") {
      throw new Error(`Relay ${table} contains a malformed row.`);
    }
    try {
      const parsed = JSON.parse(row.data_json) as unknown;
      if (!isRecord(parsed) || storageKeyForRow(table, parsed) !== row.storage_key) {
        throw new Error(`Relay ${table} row identity does not match its storage key.`);
      }
      values.push(parsed);
    } catch {
      throw new Error(`Relay ${table} contains malformed JSON or a mismatched row identity.`);
    }
  }
  return values;
}

function storageKeyForRow(table: string, value: Record<string, unknown>): string | null {
  const stringField = (field: string) => (typeof value[field] === "string" && value[field] ? value[field] : null);
  if (table === "relay_devices") {
    const userId = stringField("userId");
    const deviceId = stringField("deviceId");
    return userId && deviceId ? `${userId}:${deviceId}` : null;
  }
  if (table === "relay_accepted_message_receipts") {
    const roomKey = stringField("roomKey");
    const messageId = stringField("messageId");
    return roomKey && messageId ? JSON.stringify([roomKey, messageId]) : null;
  }
  const fieldByTable: Record<string, string> = {
    relay_teams: "id",
    relay_rooms: "id",
    relay_invites: "id",
    relay_key_packages: "id",
    relay_consumed_key_packages: "keyPackageHash",
    relay_invite_requests: "requestId",
    relay_invite_responses: "requestId",
    relay_invite_ack_receipts: "requestId",
    relay_team_members: "teamId",
    relay_account_restrictions: "userId",
    relay_account_quota_records: "key",
    relay_attachment_blobs: "id"
  };
  if (table === "relay_auth_sessions") return stringField("sessionIdHash") ?? stringField("sessionId");
  const field = fieldByTable[table];
  return field ? stringField(field) : null;
}

function relayDatabaseContainsDurableState(db: Database.Database): boolean {
  const tables = [
    "relay_teams",
    "relay_rooms",
    "relay_invites",
    "relay_devices",
    "relay_key_packages",
    "relay_consumed_key_packages",
    "relay_invite_requests",
    "relay_invite_responses",
    "relay_invite_ack_receipts",
    "relay_accepted_message_receipts",
    "relay_team_members",
    "relay_auth_sessions",
    "relay_account_restrictions",
    "relay_account_quota_records",
    "relay_attachment_blobs",
    "relay_mls_messages",
    "relay_room_epochs",
    "relay_meta"
  ];
  return tables.some((table) => {
    const row = db.prepare(`select 1 as present from ${table} limit 1`).get() as { present?: unknown } | undefined;
    return row?.present === 1;
  });
}

function saveJsonRows(
  db: Database.Database,
  table: string,
  keyColumn: string,
  value: unknown,
  keyForItem: (item: Record<string, unknown>) => string | null
) {
  if (!Array.isArray(value)) return;
  const insert = db.prepare(`insert into ${table} (${keyColumn}, data_json) values (?, ?)`);
  for (const item of value) {
    if (!isRecord(item) || Array.isArray(item)) continue;
    const key = keyForItem(item);
    if (!key) continue;
    insert.run(key, JSON.stringify(item));
  }
}

function relayId(item: Record<string, unknown>, key: string): string | null {
  const value = item[key];
  return typeof value === "string" && value ? value : null;
}
