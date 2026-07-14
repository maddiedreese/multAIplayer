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
mod encrypted_store;

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

    fn stage_invite_receipt(&self, receipt: ConsumedInviteReceipt) -> Result<(), StoreError> {
        validate_component(&receipt.capability_handle)?;
        validate_component(&receipt.commit_outbox_id)?;
        validate_component(&receipt.welcome_outbox_id)?;
        if receipt.binding_hash.len() != 64 || receipt.key_package_hash.len() > 128 {
            return Err(StoreError::InvalidValue);
        }
        self.staged_invite_receipts
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(receipt);
        Ok(())
    }

    pub fn invite_receipt(
        &self,
        capability_handle: &str,
    ) -> Result<Option<ConsumedInviteReceipt>, StoreError> {
        validate_component(capability_handle)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [format!("invite-receipt:{capability_handle}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        value
            .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| StoreError::CorruptValue))
            .transpose()
    }

    pub fn invite_receipt_for_commit(
        &self,
        commit_outbox_id: &str,
    ) -> Result<Option<ConsumedInviteReceipt>, StoreError> {
        validate_component(commit_outbox_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let mut statement = connection
            .prepare("SELECT value FROM kvs WHERE key LIKE 'invite-receipt:%'")
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let rows = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        for row in rows {
            let receipt: ConsumedInviteReceipt = serde_json::from_slice(
                &row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?,
            )
            .map_err(|_| StoreError::CorruptValue)?;
            if receipt.commit_outbox_id == commit_outbox_id {
                return Ok(Some(receipt));
            }
        }
        Ok(None)
    }

    fn stage_invite_receipt_delete(&self, capability_handle: &str) -> Result<(), StoreError> {
        validate_component(capability_handle)?;
        self.staged_invite_receipt_delete
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(capability_handle.to_owned());
        Ok(())
    }

    fn clear_staged_invite_receipt_delete(&self) {
        if let Ok(mut staged) = self.staged_invite_receipt_delete.lock() {
            staged.clear();
        }
    }

    pub fn record_invite_denial(
        &self,
        receipt: &DeniedInviteReceipt,
        outbox: &OutboxItem,
    ) -> Result<(), StoreError> {
        validate_component(&receipt.capability_handle)?;
        validate_outbox(outbox)?;
        if receipt.binding_hash.len() != 64
            || receipt.key_package_hash.len() > 128
            || receipt.response_outbox_id != outbox.id
        {
            return Err(StoreError::InvalidValue);
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let transaction = connection
            .transaction()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        transaction
            .execute(
                "INSERT INTO kvs (key, value) VALUES (?, ?)",
                params![
                    format!("invite-denial-receipt:{}", receipt.capability_handle),
                    serde_json::to_vec(receipt).map_err(|_| StoreError::InvalidValue)?
                ],
            )
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        transaction
            .execute(
                "INSERT INTO kvs (key, value) VALUES (?, ?)",
                params![
                    outbox_key(&outbox.id),
                    serde_json::to_vec(outbox).map_err(|_| StoreError::InvalidValue)?
                ],
            )
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        transaction
            .commit()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    pub fn denied_invite_receipt(
        &self,
        capability_handle: &str,
    ) -> Result<Option<DeniedInviteReceipt>, StoreError> {
        validate_component(capability_handle)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [format!("invite-denial-receipt:{capability_handle}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        value
            .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| StoreError::CorruptValue))
            .transpose()
    }

    fn stage_outbox(&self, item: OutboxItem) -> Result<(), StoreError> {
        validate_outbox(&item)?;
        if self.outbox_item(&item.id)?.is_some() {
            return Err(StoreError::InvalidValue);
        }
        let mut staged = self
            .staged_outbox
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        if staged.iter().any(|existing| existing.id == item.id) {
            return Err(StoreError::InvalidValue);
        }
        staged.push(item);
        Ok(())
    }

    fn clear_staged_outbox(&self) {
        if let Ok(mut staged) = self.staged_outbox.lock() {
            staged.clear();
        }
    }

    fn clear_staged_invite_receipts(&self) {
        if let Ok(mut staged) = self.staged_invite_receipts.lock() {
            staged.clear();
        }
    }

    fn stage_join_receipt(&self, receipt: ConsumedJoinReceipt) -> Result<(), StoreError> {
        validate_component(&receipt.invite_id)?;
        validate_component(&receipt.team_id)?;
        validate_component(&receipt.room_id)?;
        validate_component(&receipt.request_id)?;
        validate_identity_component(&receipt.requester_user_id)?;
        validate_identity_component(&receipt.requester_device_id)?;
        if receipt.response_hash.len() != 64
            || !receipt
                .response_hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(StoreError::InvalidValue);
        }
        self.staged_join_receipts
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(receipt);
        Ok(())
    }

    fn clear_staged_join_receipts(&self) {
        if let Ok(mut staged) = self.staged_join_receipts.lock() {
            staged.clear();
        }
    }

    pub fn join_receipt(
        &self,
        request_id: &str,
    ) -> Result<Option<ConsumedJoinReceipt>, StoreError> {
        validate_component(request_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [format!("join-receipt:{request_id}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        value
            .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| StoreError::CorruptValue))
            .transpose()
    }

    pub fn pending_join_receipts(&self) -> Result<Vec<ConsumedJoinReceipt>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let mut statement = connection
            .prepare("SELECT value FROM kvs WHERE key LIKE 'join-receipt:%' ORDER BY key")
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let rows = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        rows.map(|row| {
            serde_json::from_slice(&row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?)
                .map_err(|_| StoreError::CorruptValue)
        })
        .collect()
    }

    pub fn complete_join_receipt(&self, room_id: &str, request_id: &str) -> Result<(), StoreError> {
        validate_component(room_id)?;
        let receipt = self
            .join_receipt(request_id)?
            .ok_or(StoreError::InvalidValue)?;
        if receipt.room_id != room_id {
            return Err(StoreError::InvalidValue);
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        connection
            .execute(
                "DELETE FROM kvs WHERE key = ?",
                [format!("join-receipt:{request_id}")],
            )
            .map(|_| ())
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    fn stage_history_secret(
        &self,
        room_id: &str,
        epoch: u64,
        secret: Vec<u8>,
    ) -> Result<(), StoreError> {
        validate_component(room_id)?;
        if secret.len() != 32 {
            return Err(StoreError::InvalidValue);
        }
        let mut staged = self
            .staged_history_secret
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        *staged = Some((room_id.to_owned(), epoch, secret));
        Ok(())
    }

    fn clear_staged_history_secret(&self) {
        if let Ok(mut staged) = self.staged_history_secret.lock() {
            *staged = None;
        }
    }

    pub fn history_secret(&self, room_id: &str, epoch: u64) -> Result<Option<Vec<u8>>, StoreError> {
        validate_component(room_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let storage_key = format!("history-secret:{room_id}:{epoch}");
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [&storage_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let Some(value) = value else { return Ok(None) };
        let retained: RetainedSecret =
            serde_json::from_slice(&value).map_err(|_| StoreError::CorruptValue)?;
        if retained.expires_at_unix_seconds <= unix_seconds()? {
            connection
                .execute("DELETE FROM kvs WHERE key = ?", [&storage_key])
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            return Ok(None);
        }
        Ok(Some(retained.secret))
    }

    pub fn set_history_retention(
        &self,
        room_id: &str,
        retention_days: u16,
    ) -> Result<(), StoreError> {
        validate_component(room_id)?;
        if !(1..=365).contains(&retention_days) {
            return Err(StoreError::InvalidValue);
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let transaction = connection
            .transaction()
            .map_err(|e| StoreError::Sqlite(sqlite_error(e)))?;
        transaction
            .execute(
                "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![
                    format!("history-retention:{room_id}"),
                    serde_json::to_vec(&retention_days).map_err(|_| StoreError::InvalidValue)?
                ],
            )
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let expires_at = unix_seconds()?.saturating_add(u64::from(retention_days) * 86_400);
        let prefix = format!("history-secret:{room_id}:");
        let mut statement = transaction
            .prepare("SELECT key, value FROM kvs WHERE key LIKE ? ESCAPE '\\'")
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let rows = statement
            .query_map([format!("{}%", escape_like(&prefix))], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let mut updates = Vec::new();
        for row in rows {
            let (key, value) = row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            let mut retained: RetainedSecret =
                serde_json::from_slice(&value).map_err(|_| StoreError::CorruptValue)?;
            retained.expires_at_unix_seconds = expires_at;
            updates.push((key, retained));
        }
        drop(statement);
        for (storage_key, retained) in updates {
            transaction
                .execute(
                    "UPDATE kvs SET value = ? WHERE key = ?",
                    params![
                        serde_json::to_vec(&retained).map_err(|_| StoreError::InvalidValue)?,
                        storage_key
                    ],
                )
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        }
        transaction
            .commit()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    pub fn history_retention_days(&self, room_id: &str) -> Result<u16, StoreError> {
        validate_component(room_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [format!("history-retention:{room_id}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let days = value
            .map(|encoded| serde_json::from_slice(&encoded).map_err(|_| StoreError::CorruptValue))
            .transpose()?
            .unwrap_or(DEFAULT_HISTORY_RETENTION_DAYS);
        if !(1..=365).contains(&days) {
            return Err(StoreError::CorruptValue);
        }
        Ok(days)
    }

    pub fn delete_history_epoch(&self, room_id: &str, epoch: u64) -> Result<(), StoreError> {
        validate_component(room_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        connection
            .execute(
                "DELETE FROM kvs WHERE key = ?",
                [format!("history-secret:{room_id}:{epoch}")],
            )
            .map(|_| ())
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    pub fn outbox_item(&self, id: &str) -> Result<Option<OutboxItem>, StoreError> {
        validate_component(id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [outbox_key(id)],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        value
            .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| StoreError::CorruptValue))
            .transpose()
    }

    pub fn put_blob_key(
        &self,
        room_id: &str,
        blob_id: &[u8],
        epoch: u64,
        key: &[u8],
    ) -> Result<(), StoreError> {
        validate_component(room_id)?;
        if blob_id.is_empty() || blob_id.len() > 128 || key.len() != 32 {
            return Err(StoreError::InvalidValue);
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let retained = RetainedSecret {
            expires_at_unix_seconds: unix_seconds()?.saturating_add(DEFAULT_BLOB_KEY_DAYS * 86_400),
            secret: key.to_vec(),
        };
        connection
            .execute(
                "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![blob_key_name(room_id, blob_id, epoch), serde_json::to_vec(&retained).map_err(|_| StoreError::InvalidValue)?],
            )
            .map(|_| ())
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    pub fn blob_key(
        &self,
        room_id: &str,
        blob_id: &[u8],
        epoch: u64,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        validate_component(room_id)?;
        if blob_id.is_empty() || blob_id.len() > 128 {
            return Err(StoreError::InvalidValue);
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let storage_key = blob_key_name(room_id, blob_id, epoch);
        let value: Option<Vec<u8>> = connection
            .query_row(
                "SELECT value FROM kvs WHERE key = ?",
                [&storage_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let Some(value) = value else { return Ok(None) };
        let retained: RetainedSecret =
            serde_json::from_slice(&value).map_err(|_| StoreError::CorruptValue)?;
        if retained.expires_at_unix_seconds <= unix_seconds()? {
            connection
                .execute("DELETE FROM kvs WHERE key = ?", [&storage_key])
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            return Ok(None);
        }
        Ok(Some(retained.secret))
    }

    pub fn delete_history_records(&self, room_id: &str) -> Result<(), StoreError> {
        validate_component(room_id)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let transaction = connection
            .transaction()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        for prefix in ["history-secret", "history"] {
            transaction
                .execute(
                    "DELETE FROM kvs WHERE key LIKE ? ESCAPE '\\'",
                    [format!("{prefix}:{}:%", escape_like(room_id))],
                )
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        }
        transaction
            .commit()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    pub fn prune_expired_material(&self, room_id: &str) -> Result<(), StoreError> {
        validate_component(room_id)?;
        let now = unix_seconds()?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let mut expired = Vec::new();
        for prefix in ["history-secret", "blob-key"] {
            let pattern = format!("{prefix}:{}:%", escape_like(room_id));
            let mut statement = connection
                .prepare("SELECT key, value FROM kvs WHERE key LIKE ? ESCAPE '\\'")
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            let rows = statement
                .query_map([pattern], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                })
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            for row in rows {
                let (key, value) = row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
                let retained: RetainedSecret =
                    serde_json::from_slice(&value).map_err(|_| StoreError::CorruptValue)?;
                if retained.expires_at_unix_seconds <= now {
                    expired.push(key);
                }
            }
        }
        let transaction = connection
            .transaction()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        for key in expired {
            transaction
                .execute("DELETE FROM kvs WHERE key = ?", [key])
                .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        }
        transaction
            .commit()
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))
    }

    fn stage_outbox_delete(&self, id: &str) -> Result<(), StoreError> {
        validate_component(id)?;
        self.staged_outbox_delete
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(id.to_owned());
        Ok(())
    }

    fn clear_staged_outbox_deletes(&self) {
        if let Ok(mut staged) = self.staged_outbox_delete.lock() {
            staged.clear();
        }
    }

    pub fn delete_outbox(&self, id: &str) -> Result<(), StoreError> {
        validate_component(id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let changed = connection
            .execute("DELETE FROM kvs WHERE key = ?", [outbox_key(id)])
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        if changed != 1 {
            return Err(StoreError::InvalidValue);
        }
        Ok(())
    }

    pub fn outbox_for_room_epoch(
        &self,
        room_id: &str,
        epoch: u64,
    ) -> Result<Vec<OutboxItem>, StoreError> {
        validate_component(room_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let mut statement = connection
            .prepare("SELECT value FROM kvs WHERE key LIKE 'outbox:%'")
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let rows = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let mut items = Vec::new();
        for row in rows {
            let bytes = row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
            let item: OutboxItem =
                serde_json::from_slice(&bytes).map_err(|_| StoreError::CorruptValue)?;
            if item.room_id == room_id && item.epoch == epoch {
                items.push(item);
            }
        }
        Ok(items)
    }

    pub fn has_room_outbox_kind(&self, room_id: &str, kind: &str) -> Result<bool, StoreError> {
        validate_component(room_id)?;
        validate_component(kind)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::CorruptValue)?;
        let mut statement = connection
            .prepare("SELECT value FROM kvs WHERE key LIKE 'outbox:%'")
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        let rows = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .map_err(|error| StoreError::Sqlite(sqlite_error(error)))?;
        for row in rows {
            let item: OutboxItem = serde_json::from_slice(
                &row.map_err(|error| StoreError::Sqlite(sqlite_error(error)))?,
            )
            .map_err(|_| StoreError::CorruptValue)?;
            if item.room_id == room_id && item.kind == kind {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn sqlite_error(error: impl std::error::Error + Send + Sync + 'static) -> SqLiteDataStorageError {
    SqLiteDataStorageError::SqlEngineError(Box::new(error))
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> SqLiteDataStorageError {
    sqlite_error(std::io::Error::other("MLS storage lock poisoned"))
}
