import Database from "better-sqlite3";
import { chmodSync, existsSync } from "node:fs";

export function openRelayDatabase(dataPath: string, walAutoCheckpointPages = 1_000): Database.Database {
  const db = new Database(dataPath);
  chmodSync(dataPath, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma(`wal_autocheckpoint = ${walAutoCheckpointPages}`);
  db.pragma("foreign_keys = ON");
  db.exec(`
    create table if not exists relay_meta (key text primary key, value text not null);
    create table if not exists relay_teams (id text primary key, data_json text not null);
    create table if not exists relay_rooms (id text primary key, data_json text not null);
    create table if not exists relay_invites (id text primary key, data_json text not null);
    create table if not exists relay_devices (key text primary key, data_json text not null);
    create table if not exists relay_key_packages (id text primary key, data_json text not null);
    create table if not exists relay_consumed_key_packages (key_package_hash text primary key, data_json text not null);
    create table if not exists relay_invite_requests (id text primary key, data_json text not null);
    create table if not exists relay_invite_responses (id text primary key, data_json text not null);
    create table if not exists relay_invite_ack_receipts (id text primary key, data_json text not null);
    create table if not exists relay_accepted_message_receipts (id text primary key, data_json text not null);
    create table if not exists relay_team_members (team_id text primary key, data_json text not null);
    create table if not exists relay_auth_sessions (session_id text primary key, data_json text not null);
    create table if not exists relay_account_restrictions (user_id text primary key, data_json text not null);
    create table if not exists relay_account_quota_records (quota_key text primary key, data_json text not null);
    create table if not exists relay_attachment_blobs (id text primary key, data_json text not null);
    create table if not exists relay_mls_messages (
      room_key text not null,
      message_id text not null,
      sort_order integer not null,
      created_at text not null,
      data_json text not null,
      primary key (room_key, message_id)
    );
    create table if not exists relay_room_epochs (room_key text primary key, accepted_epoch integer not null);
  `);
  for (const path of [dataPath, `${dataPath}-wal`, `${dataPath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600);
  }
  return db;
}
