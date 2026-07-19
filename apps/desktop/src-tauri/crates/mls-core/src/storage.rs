use mls_rs_core::group::{EpochRecord, GroupState, GroupStateStorage};
use mls_rs_provider_sqlite::{
    connection_strategy::{
        CipheredConnectionStrategy, FileConnectionStrategy, SqlCipherConfig, SqlCipherKey,
    },
    storage::{Item, SqLiteApplicationStorage, SqLiteGroupStateStorage, SqLiteKeyPackageStorage},
    JournalMode, SqLiteDataStorageEngine, SqLiteDataStorageError,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use thiserror::Error;
use zeroize::Zeroizing;

mod atomic_group;
mod delivery_receipts;
mod encrypted_store;
mod history_ciphertext;
mod invite_receipts;
mod outbox;
mod pending_invites;
mod retained_material;

use encrypted_store::{
    blob_key_name, escape_like, outbox_key, unix_seconds, validate_component,
    validate_identity_component, validate_outbox,
};
pub use encrypted_store::{
    ConsumedInviteReceipt, ConsumedJoinReceipt, DeniedInviteReceipt, OutboxItem,
    PendingInviteRequest, StoreError,
};

const MAX_OUTBOX_PAYLOAD: usize = 1024 * 1024;
type StagedHistorySecret = Option<(String, u64, Vec<u8>)>;
pub const DEFAULT_HISTORY_RETENTION_DAYS: u16 = 30;
const DEFAULT_BLOB_KEY_DAYS: u64 = 30;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetainedSecret {
    expires_at_unix_seconds: u64,
    secret: Vec<u8>,
}

pub struct EncryptedStore {
    engine: SqLiteDataStorageEngine<CipheredConnectionStrategy<FileConnectionStrategy>>,
    application: SqLiteApplicationStorage,
}

#[derive(Clone, Debug)]
pub struct AtomicGroupStateStorage {
    connection: Arc<Mutex<Connection>>,
    staged_outbox: Arc<Mutex<Vec<OutboxItem>>>,
    staged_history_secret: Arc<Mutex<StagedHistorySecret>>,
    staged_outbox_delete: Arc<Mutex<Vec<String>>>,
    staged_invite_receipts: Arc<Mutex<Vec<ConsumedInviteReceipt>>>,
    staged_join_receipts: Arc<Mutex<Vec<ConsumedJoinReceipt>>>,
    staged_invite_receipt_delete: Arc<Mutex<Vec<String>>>,
    max_epoch_retention: u64,
    #[cfg(test)]
    room_deletion_failure: Arc<Mutex<Option<RoomDeletionStage>>>,
}

/// Owns one set of mutations that must be committed with an MLS group-state write.
///
/// Staging is ambient because `mls-rs` calls [`GroupStateStorage::write`] without an
/// application-defined transaction argument. Keeping the staging methods on this guard makes
/// cleanup automatic when any later operation returns early. A successful group-state write
/// clears the same buffers, so the guard's final cleanup is intentionally idempotent.
pub(crate) struct StagedWriteGuard {
    storage: AtomicGroupStateStorage,
}

impl StagedWriteGuard {
    pub(crate) fn stage_invite_receipt(
        &self,
        receipt: ConsumedInviteReceipt,
    ) -> Result<(), StoreError> {
        self.storage.stage_invite_receipt(receipt)
    }

    pub(crate) fn stage_invite_receipt_delete(
        &self,
        capability_handle: &str,
    ) -> Result<(), StoreError> {
        self.storage.stage_invite_receipt_delete(capability_handle)
    }

    pub(crate) fn stage_outbox(&self, item: OutboxItem) -> Result<(), StoreError> {
        self.storage.stage_outbox(item)
    }

    pub(crate) fn stage_join_receipt(
        &self,
        receipt: ConsumedJoinReceipt,
    ) -> Result<(), StoreError> {
        self.storage.stage_join_receipt(receipt)
    }

    pub(crate) fn stage_history_secret(
        &self,
        room_id: &str,
        epoch: u64,
        secret: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.storage.stage_history_secret(room_id, epoch, secret)
    }

    pub(crate) fn stage_outbox_delete(&self, id: &str) -> Result<(), StoreError> {
        self.storage.stage_outbox_delete(id)
    }
}

impl Drop for StagedWriteGuard {
    fn drop(&mut self) {
        self.storage.clear_all_staged();
    }
}

impl AtomicGroupStateStorage {
    pub fn new(connection: Connection) -> Self {
        Self {
            connection: Arc::new(Mutex::new(connection)),
            staged_outbox: Arc::new(Mutex::new(Vec::new())),
            staged_history_secret: Arc::new(Mutex::new(None)),
            staged_outbox_delete: Arc::new(Mutex::new(Vec::new())),
            staged_invite_receipts: Arc::new(Mutex::new(Vec::new())),
            staged_join_receipts: Arc::new(Mutex::new(Vec::new())),
            staged_invite_receipt_delete: Arc::new(Mutex::new(Vec::new())),
            max_epoch_retention: 3,
            #[cfg(test)]
            room_deletion_failure: Arc::new(Mutex::new(None)),
        }
    }

    pub(crate) fn staged_write(&self) -> StagedWriteGuard {
        StagedWriteGuard {
            storage: self.clone(),
        }
    }

    fn clear_all_staged(&self) {
        self.clear_staged_outbox();
        self.clear_staged_history_secret();
        self.clear_staged_outbox_deletes();
        self.clear_staged_invite_receipts();
        self.clear_staged_join_receipts();
        self.clear_staged_invite_receipt_delete();
    }

    pub fn has_group_snapshot(&self, group_id: &[u8]) -> Result<bool, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        connection
            .query_row(
                "SELECT 1 FROM mls_group WHERE group_id = ? LIMIT 1",
                [group_id],
                |_| Ok(()),
            )
            .optional()
            .map(|value| value.is_some())
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    pub fn delete_corrupt_group_records(&self, room_id: &str) -> Result<(), StoreError> {
        self.delete_room_records_inner(room_id, RoomDeletionMode::LegacyCorrupt, |_| Ok(()))
    }

    pub(crate) fn delete_room_records(&self, room_id: &str) -> Result<(), StoreError> {
        #[cfg(test)]
        {
            let failure = self.room_deletion_failure.clone();
            self.delete_room_records_inner(room_id, RoomDeletionMode::Exact, move |stage| {
                if *failure.lock().map_err(|_| StoreError::CorruptValue)? == Some(stage) {
                    Err(StoreError::InvalidValue)
                } else {
                    Ok(())
                }
            })
        }
        #[cfg(not(test))]
        self.delete_room_records_inner(room_id, RoomDeletionMode::Exact, |_| Ok(()))
    }

    #[cfg(test)]
    pub(crate) fn fail_room_deletion_at_for_test(&self, stage: Option<RoomDeletionStage>) {
        *self.room_deletion_failure.lock().unwrap() = stage;
    }

    fn delete_room_records_inner(
        &self,
        room_id: &str,
        mode: RoomDeletionMode,
        mut checkpoint: impl FnMut(RoomDeletionStage) -> Result<(), StoreError>,
    ) -> Result<(), StoreError> {
        validate_component(room_id)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let transaction = connection
            .transaction()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let mut statement = transaction
            .prepare("SELECT key, value FROM kvs")
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let mut delete_keys = Vec::new();
        for row in rows {
            let (key, value) = row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            let direct = key == format!("history-retention:{room_id}")
                || key.starts_with(&format!("history-secret:{room_id}:"))
                || key.starts_with(&format!("blob-key:{room_id}:"))
                || (mode == RoomDeletionMode::Exact
                    && (key.starts_with(&format!("history:{room_id}:"))
                        || key == format!("room-config:{room_id}")));
            let related = if key.starts_with("outbox:") {
                serde_json::from_slice::<OutboxItem>(&value)
                    .map_err(|_| StoreError::CorruptValue)?
                    .room_id
                    == room_id
            } else if key.starts_with("join-receipt:") {
                serde_json::from_slice::<ConsumedJoinReceipt>(&value)
                    .map_err(|_| StoreError::CorruptValue)?
                    .room_id
                    == room_id
            } else if key.starts_with("invite-receipt:") {
                serde_json::from_slice::<ConsumedInviteReceipt>(&value)
                    .map_err(|_| StoreError::CorruptValue)?
                    .response_binding
                    .room_id
                    == room_id
            } else if key.starts_with("invite-denial-receipt:") {
                serde_json::from_slice::<DeniedInviteReceipt>(&value)
                    .map_err(|_| StoreError::CorruptValue)?
                    .response_binding
                    .room_id
                    == room_id
            } else if mode == RoomDeletionMode::Exact && key.starts_with("pending-invite:") {
                serde_json::from_slice::<PendingInviteRequest>(&value)
                    .map_err(|_| StoreError::CorruptValue)?
                    .original_binding
                    .room_id
                    == room_id
            } else {
                false
            };
            if direct || related {
                delete_keys.push(key);
            }
        }
        drop(statement);
        checkpoint(RoomDeletionStage::Scanned)?;
        for key in delete_keys {
            transaction
                .execute("DELETE FROM kvs WHERE key = ?", [key])
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        }
        checkpoint(RoomDeletionStage::ApplicationRecordsDeleted)?;
        transaction
            .execute("DELETE FROM epoch WHERE group_id = ?", [room_id.as_bytes()])
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        checkpoint(RoomDeletionStage::EpochsDeleted)?;
        let changed = transaction
            .execute(
                "DELETE FROM mls_group WHERE group_id = ?",
                [room_id.as_bytes()],
            )
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        if mode == RoomDeletionMode::LegacyCorrupt && changed != 1 {
            return Err(StoreError::InvalidValue);
        }
        checkpoint(RoomDeletionStage::GroupDeleted)?;
        checkpoint(RoomDeletionStage::BeforeCommit)?;
        transaction
            .commit()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    #[cfg(test)]
    pub(crate) fn corrupt_group_snapshot_for_test(&self, group_id: &[u8]) {
        self.connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE mls_group SET snapshot = ? WHERE group_id = ?",
                params![b"not-an-mls-group", group_id],
            )
            .unwrap();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RoomDeletionStage {
    Scanned,
    ApplicationRecordsDeleted,
    EpochsDeleted,
    GroupDeleted,
    BeforeCommit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RoomDeletionMode {
    LegacyCorrupt,
    Exact,
}

fn sqlite_error(error: impl std::error::Error + Send + Sync + 'static) -> SqLiteDataStorageError {
    SqLiteDataStorageError::SqlEngineError(Box::new(error))
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> SqLiteDataStorageError {
    sqlite_error(std::io::Error::other("MLS storage lock poisoned"))
}

#[cfg(test)]
mod room_deletion_tests {
    use super::*;

    const SCHEMA: &str =
        "CREATE TABLE mls_group (group_id BLOB PRIMARY KEY, snapshot BLOB NOT NULL) WITHOUT ROWID;
         CREATE TABLE epoch (group_id BLOB, epoch_id INTEGER, epoch_data BLOB NOT NULL, PRIMARY KEY(group_id, epoch_id)) WITHOUT ROWID;
         CREATE TABLE kvs (key TEXT PRIMARY KEY, value BLOB NOT NULL) WITHOUT ROWID;";

    #[derive(Debug, Eq, PartialEq)]
    struct DatabaseSnapshot {
        groups: Vec<(Vec<u8>, Vec<u8>)>,
        epochs: Vec<(Vec<u8>, i64, Vec<u8>)>,
        records: Vec<(String, Vec<u8>)>,
    }

    fn storage() -> AtomicGroupStateStorage {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        for room in ["room-delete", "room-sibling"] {
            connection
                .execute(
                    "INSERT INTO mls_group(group_id, snapshot) VALUES (?, ?)",
                    params![room.as_bytes(), format!("snapshot-{room}").as_bytes()],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO epoch(group_id, epoch_id, epoch_data) VALUES (?, 0, ?)",
                    params![room.as_bytes(), format!("epoch-{room}").as_bytes()],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO kvs(key, value) VALUES (?, ?)",
                    params![
                        format!("room-config:{room}"),
                        format!("config-{room}").as_bytes()
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO kvs(key, value) VALUES (?, ?)",
                    params![
                        format!("history:{room}:0"),
                        format!("ciphertext-{room}").as_bytes()
                    ],
                )
                .unwrap();
            let outbox = OutboxItem {
                id: format!("outbox-{room}"),
                room_id: room.into(),
                epoch: 0,
                kind: "application".into(),
                payload: vec![1, 2, 3],
                metadata: None,
            };
            connection
                .execute(
                    "INSERT INTO kvs(key, value) VALUES (?, ?)",
                    params![
                        format!("outbox:{}", outbox.id),
                        serde_json::to_vec(&outbox).unwrap()
                    ],
                )
                .unwrap();
            let binding = crate::CapabilityBinding {
                version: 3,
                phase: "request".into(),
                invite_id: format!("invite-{room}"),
                team_id: "team-core".into(),
                room_id: room.into(),
                key_epoch: 0,
                key_package_hash: format!("sha256:{}", "00".repeat(32)),
                request_id: format!("request-{room}"),
                request_nonce: "nonce".into(),
                requester_user_id: "github:guest".into(),
                requester_device_id: "device-guest".into(),
                host_user_id: "github:host".into(),
                host_device_id: "device-host".into(),
                expires_at: "2026-07-19T12:00:00.000Z".into(),
                status: None,
                decided_at: None,
            };
            let pending = PendingInviteRequest {
                capability_url_value: "A".repeat(43),
                original_binding: binding.clone(),
                key_package_id: format!("package-{room}"),
                sealed_request: "sealed".into(),
            };
            let invite_receipt = ConsumedInviteReceipt {
                capability_handle: format!("capability-{room}"),
                binding_hash: format!("sha256:{}", "11".repeat(32)),
                key_package_hash: binding.key_package_hash.clone(),
                epoch: 1,
                commit_outbox_id: format!("commit-{room}"),
                welcome_outbox_id: format!("welcome-{room}"),
                response_binding: binding.clone(),
                response_mac: "mac".into(),
            };
            let denied_receipt = DeniedInviteReceipt {
                capability_handle: format!("denied-{room}"),
                binding_hash: format!("sha256:{}", "22".repeat(32)),
                key_package_hash: binding.key_package_hash.clone(),
                response_outbox_id: format!("denial-{room}"),
                response_binding: binding.clone(),
                response_mac: "mac".into(),
            };
            let join_receipt = ConsumedJoinReceipt {
                invite_id: binding.invite_id.clone(),
                team_id: binding.team_id.clone(),
                room_id: room.into(),
                request_id: binding.request_id.clone(),
                requester_user_id: binding.requester_user_id.clone(),
                requester_device_id: binding.requester_device_id.clone(),
                response_hash: format!("sha256:{}", "33".repeat(32)),
                epoch: 1,
            };
            for (key, value) in [
                (
                    format!("pending-invite:{room}"),
                    serde_json::to_vec(&pending).unwrap(),
                ),
                (
                    format!("invite-receipt:{room}"),
                    serde_json::to_vec(&invite_receipt).unwrap(),
                ),
                (
                    format!("invite-denial-receipt:{room}"),
                    serde_json::to_vec(&denied_receipt).unwrap(),
                ),
                (
                    format!("join-receipt:{room}"),
                    serde_json::to_vec(&join_receipt).unwrap(),
                ),
            ] {
                connection
                    .execute(
                        "INSERT INTO kvs(key, value) VALUES (?, ?)",
                        params![key, value],
                    )
                    .unwrap();
            }
        }
        connection
            .execute(
                "INSERT INTO kvs(key, value) VALUES (?, ?)",
                params!["global-device-record", b"global-device-bytes"],
            )
            .unwrap();
        AtomicGroupStateStorage::new(connection)
    }

    fn counts(storage: &AtomicGroupStateStorage, room_id: &str) -> (u64, u64, u64) {
        let connection = storage.connection.lock().unwrap();
        let groups = connection
            .query_row(
                "SELECT COUNT(*) FROM mls_group WHERE group_id = ?",
                [room_id.as_bytes()],
                |row| row.get(0),
            )
            .unwrap();
        let epochs = connection
            .query_row(
                "SELECT COUNT(*) FROM epoch WHERE group_id = ?",
                [room_id.as_bytes()],
                |row| row.get(0),
            )
            .unwrap();
        let records = connection
            .query_row(
                "SELECT COUNT(*) FROM kvs WHERE key LIKE ? OR key = ?",
                params![format!("%{room_id}%"), format!("room-config:{room_id}")],
                |row| row.get(0),
            )
            .unwrap();
        (groups, epochs, records)
    }

    fn snapshot(storage: &AtomicGroupStateStorage, room: Option<&str>) -> DatabaseSnapshot {
        let connection = storage.connection.lock().unwrap();
        let groups = {
            let mut statement = connection
                .prepare("SELECT group_id, snapshot FROM mls_group ORDER BY group_id")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|(group_id, _): &(Vec<u8>, Vec<u8>)| {
                    room.is_none_or(|room| group_id == room.as_bytes())
                })
                .collect()
        };
        let epochs = {
            let mut statement = connection
                .prepare(
                    "SELECT group_id, epoch_id, epoch_data FROM epoch ORDER BY group_id, epoch_id",
                )
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|(group_id, _, _): &(Vec<u8>, i64, Vec<u8>)| {
                    room.is_none_or(|room| group_id == room.as_bytes())
                })
                .collect()
        };
        let records = {
            let mut statement = connection
                .prepare("SELECT key, value FROM kvs ORDER BY key")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|(key, _): &(String, Vec<u8>)| {
                    room.is_none_or(|room| key.contains(room) || key == "global-device-record")
                })
                .collect()
        };
        DatabaseSnapshot {
            groups,
            epochs,
            records,
        }
    }

    #[test]
    fn exact_room_deletion_is_idempotent_and_preserves_sibling_bytes() {
        let storage = storage();
        let sibling_and_global_before = snapshot(&storage, Some("room-sibling"));
        storage.delete_room_records("room-delete").unwrap();
        storage.delete_room_records("room-delete").unwrap();
        assert_eq!(counts(&storage, "room-delete"), (0, 0, 0));
        assert_eq!(counts(&storage, "room-sibling"), (1, 1, 7));
        let sibling_and_global_after = snapshot(&storage, Some("room-sibling"));
        assert_eq!(sibling_and_global_after, sibling_and_global_before);
    }

    #[test]
    fn legacy_corrupt_group_deletion_keeps_its_original_record_scope() {
        let storage = storage();
        let legacy_excluded_before = {
            let connection = storage.connection.lock().unwrap();
            [
                "room-config:room-delete",
                "history:room-delete:0",
                "pending-invite:room-delete",
            ]
            .into_iter()
            .map(|key| {
                (
                    key.to_owned(),
                    connection
                        .query_row("SELECT value FROM kvs WHERE key = ?", [key], |row| {
                            row.get(0)
                        })
                        .unwrap(),
                )
            })
            .collect::<Vec<(String, Vec<u8>)>>()
        };
        storage.delete_corrupt_group_records("room-delete").unwrap();
        assert_eq!(counts(&storage, "room-delete"), (0, 0, 3));
        let legacy_excluded_after = {
            let connection = storage.connection.lock().unwrap();
            legacy_excluded_before
                .iter()
                .map(|(key, _)| {
                    (
                        key.clone(),
                        connection
                            .query_row("SELECT value FROM kvs WHERE key = ?", [key], |row| {
                                row.get(0)
                            })
                            .unwrap(),
                    )
                })
                .collect::<Vec<(String, Vec<u8>)>>()
        };
        assert_eq!(legacy_excluded_after, legacy_excluded_before);
        assert_eq!(counts(&storage, "room-sibling"), (1, 1, 7));
    }

    #[test]
    fn every_room_deletion_checkpoint_rolls_back_without_partial_state() {
        for failed_stage in [
            RoomDeletionStage::Scanned,
            RoomDeletionStage::ApplicationRecordsDeleted,
            RoomDeletionStage::EpochsDeleted,
            RoomDeletionStage::GroupDeleted,
            RoomDeletionStage::BeforeCommit,
        ] {
            let storage = storage();
            let before = snapshot(&storage, None);
            let result = storage.delete_room_records_inner(
                "room-delete",
                RoomDeletionMode::Exact,
                |stage| {
                    if stage == failed_stage {
                        Err(StoreError::InvalidValue)
                    } else {
                        Ok(())
                    }
                },
            );
            assert!(matches!(result, Err(StoreError::InvalidValue)));
            assert_eq!(counts(&storage, "room-delete"), (1, 1, 7));
            assert_eq!(counts(&storage, "room-sibling"), (1, 1, 7));
            assert_eq!(snapshot(&storage, None), before);
        }
    }
}
