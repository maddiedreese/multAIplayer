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
mod invite_receipts;
mod outbox;
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
                || key.starts_with(&format!("blob-key:{room_id}:"));
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
            } else {
                false
            };
            if direct || related {
                delete_keys.push(key);
            }
        }
        drop(statement);
        for key in delete_keys {
            transaction
                .execute("DELETE FROM kvs WHERE key = ?", [key])
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        }
        transaction
            .execute("DELETE FROM epoch WHERE group_id = ?", [room_id.as_bytes()])
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let changed = transaction
            .execute(
                "DELETE FROM mls_group WHERE group_id = ?",
                [room_id.as_bytes()],
            )
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        if changed != 1 {
            return Err(StoreError::InvalidValue);
        }
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

fn sqlite_error(error: impl std::error::Error + Send + Sync + 'static) -> SqLiteDataStorageError {
    SqLiteDataStorageError::SqlEngineError(Box::new(error))
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> SqLiteDataStorageError {
    sqlite_error(std::io::Error::other("MLS storage lock poisoned"))
}
