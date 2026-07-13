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

    pub fn stage_invite_receipt(&self, receipt: ConsumedInviteReceipt) -> Result<(), StoreError> {
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

    pub fn stage_invite_receipt_delete(&self, capability_handle: &str) -> Result<(), StoreError> {
        validate_component(capability_handle)?;
        self.staged_invite_receipt_delete
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(capability_handle.to_owned());
        Ok(())
    }

    pub fn clear_staged_invite_receipt_delete(&self) {
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

    pub fn stage_outbox(&self, item: OutboxItem) -> Result<(), StoreError> {
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

    pub fn clear_staged_outbox(&self) {
        if let Ok(mut staged) = self.staged_outbox.lock() {
            staged.clear();
        }
    }

    pub fn clear_staged_invite_receipts(&self) {
        if let Ok(mut staged) = self.staged_invite_receipts.lock() {
            staged.clear();
        }
    }

    pub fn stage_join_receipt(&self, receipt: ConsumedJoinReceipt) -> Result<(), StoreError> {
        validate_component(&receipt.invite_id)?;
        validate_component(&receipt.team_id)?;
        validate_component(&receipt.room_id)?;
        validate_component(&receipt.request_id)?;
        validate_component(&receipt.requester_user_id)?;
        validate_component(&receipt.requester_device_id)?;
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

    pub fn clear_staged_join_receipts(&self) {
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

    pub fn stage_history_secret(
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

    pub fn clear_staged_history_secret(&self) {
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

    pub fn stage_outbox_delete(&self, id: &str) -> Result<(), StoreError> {
        validate_component(id)?;
        self.staged_outbox_delete
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(id.to_owned());
        Ok(())
    }

    pub fn clear_staged_outbox_deletes(&self) {
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

#[maybe_async::must_be_sync]
impl GroupStateStorage for AtomicGroupStateStorage {
    type Error = SqLiteDataStorageError;

    async fn state(&self, group_id: &[u8]) -> Result<Option<Zeroizing<Vec<u8>>>, Self::Error> {
        let connection = self.connection.lock().map_err(lock_error)?;
        connection
            .query_row(
                "SELECT snapshot FROM mls_group WHERE group_id = ?",
                [group_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map(|value| value.map(Into::into))
            .map_err(sqlite_error)
    }

    async fn epoch(
        &self,
        group_id: &[u8],
        epoch_id: u64,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, Self::Error> {
        let epoch_id = i64::try_from(epoch_id)
            .map_err(|_| SqLiteDataStorageError::EpochIdOverflow(epoch_id))?;
        let connection = self.connection.lock().map_err(lock_error)?;
        connection
            .query_row(
                "SELECT epoch_data FROM epoch WHERE group_id = ? AND epoch_id = ?",
                params![group_id, epoch_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map(|value| value.map(Into::into))
            .map_err(sqlite_error)
    }

    async fn write(
        &mut self,
        state: GroupState,
        inserts: Vec<EpochRecord>,
        updates: Vec<EpochRecord>,
    ) -> Result<(), Self::Error> {
        let staged = self.staged_outbox.lock().map_err(lock_error)?.clone();
        let staged_history = self
            .staged_history_secret
            .lock()
            .map_err(lock_error)?
            .clone();
        let staged_delete = self
            .staged_outbox_delete
            .lock()
            .map_err(lock_error)?
            .clone();
        let staged_receipts = self
            .staged_invite_receipts
            .lock()
            .map_err(lock_error)?
            .clone();
        let staged_join_receipts = self
            .staged_join_receipts
            .lock()
            .map_err(lock_error)?
            .clone();
        let staged_invite_receipt_delete = self
            .staged_invite_receipt_delete
            .lock()
            .map_err(lock_error)?
            .clone();
        let mut connection = self.connection.lock().map_err(lock_error)?;
        let transaction = connection.transaction().map_err(sqlite_error)?;
        transaction.execute(
            "INSERT INTO mls_group (group_id, snapshot) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET snapshot=excluded.snapshot",
            params![state.id, &*state.data],
        ).map_err(sqlite_error)?;
        let mut max_epoch = None;
        for epoch in inserts {
            max_epoch = Some(epoch.id);
            let id = i64::try_from(epoch.id)
                .map_err(|_| SqLiteDataStorageError::EpochIdOverflow(epoch.id))?;
            transaction
                .execute(
                    "INSERT INTO epoch (group_id, epoch_id, epoch_data) VALUES (?, ?, ?)",
                    params![state.id, id, &*epoch.data],
                )
                .map_err(sqlite_error)?;
        }
        for epoch in updates {
            let id = i64::try_from(epoch.id)
                .map_err(|_| SqLiteDataStorageError::EpochIdOverflow(epoch.id))?;
            transaction
                .execute(
                    "UPDATE epoch SET epoch_data = ? WHERE group_id = ? AND epoch_id = ?",
                    params![&*epoch.data, state.id, id],
                )
                .map_err(sqlite_error)?;
        }
        if let Some(max_epoch) = max_epoch.filter(|epoch| *epoch >= self.max_epoch_retention) {
            let delete_under = max_epoch - self.max_epoch_retention;
            let delete_under = i64::try_from(delete_under)
                .map_err(|_| SqLiteDataStorageError::EpochIdOverflow(delete_under))?;
            transaction
                .execute(
                    "DELETE FROM epoch WHERE group_id = ? AND epoch_id <= ?",
                    params![state.id, delete_under],
                )
                .map_err(sqlite_error)?;
        }
        for item in &staged {
            let encoded = serde_json::to_vec(item).map_err(sqlite_error)?;
            transaction.execute(
                "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![outbox_key(&item.id), encoded],
            ).map_err(sqlite_error)?;
        }
        for receipt in &staged_receipts {
            transaction
                .execute(
                    "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
                    params![
                        format!("invite-receipt:{}", receipt.capability_handle),
                        serde_json::to_vec(receipt).map_err(sqlite_error)?
                    ],
                )
                .map_err(sqlite_error)?;
        }
        for receipt in &staged_join_receipts {
            transaction
                .execute(
                    "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
                    params![
                        format!("join-receipt:{}", receipt.request_id),
                        serde_json::to_vec(receipt).map_err(sqlite_error)?
                    ],
                )
                .map_err(sqlite_error)?;
        }
        if let Some((room_id, epoch, secret)) = staged_history.as_ref() {
            let policy_key = format!("history-retention:{room_id}");
            let retention_days = transaction
                .query_row(
                    "SELECT value FROM kvs WHERE key = ?",
                    [&policy_key],
                    |row| row.get::<_, Vec<u8>>(0),
                )
                .optional()
                .map_err(sqlite_error)?
                .map(|value| serde_json::from_slice::<u16>(&value).map_err(sqlite_error))
                .transpose()?
                .unwrap_or(DEFAULT_HISTORY_RETENTION_DAYS);
            if !(1..=365).contains(&retention_days) {
                return Err(sqlite_error(std::io::Error::other(
                    "invalid history retention policy",
                )));
            }
            transaction
                .execute(
                    "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
                    params![
                        policy_key,
                        serde_json::to_vec(&retention_days).map_err(sqlite_error)?
                    ],
                )
                .map_err(sqlite_error)?;
            let retained = RetainedSecret {
                expires_at_unix_seconds: unix_seconds()
                    .map_err(|error| sqlite_error(std::io::Error::other(error.to_string())))?
                    .saturating_add(u64::from(retention_days) * 86_400),
                secret: secret.clone(),
            };
            transaction
                .execute(
                    "INSERT INTO kvs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![format!("history-secret:{room_id}:{epoch}"), serde_json::to_vec(&retained).map_err(sqlite_error)?],
                )
                .map_err(sqlite_error)?;
        }
        for id in &staged_delete {
            transaction
                .execute("DELETE FROM kvs WHERE key = ?", [outbox_key(id)])
                .map_err(sqlite_error)?;
        }
        for handle in &staged_invite_receipt_delete {
            transaction
                .execute(
                    "DELETE FROM kvs WHERE key = ?",
                    [format!("invite-receipt:{handle}")],
                )
                .map_err(sqlite_error)?;
        }
        transaction.commit().map_err(sqlite_error)?;
        if !staged.is_empty() {
            self.staged_outbox.lock().map_err(lock_error)?.clear();
        }
        if staged_history.is_some() {
            *self.staged_history_secret.lock().map_err(lock_error)? = None;
        }
        if !staged_delete.is_empty() {
            self.staged_outbox_delete
                .lock()
                .map_err(lock_error)?
                .clear();
        }
        if !staged_receipts.is_empty() {
            self.staged_invite_receipts
                .lock()
                .map_err(lock_error)?
                .clear();
        }
        if !staged_join_receipts.is_empty() {
            self.staged_join_receipts
                .lock()
                .map_err(lock_error)?
                .clear();
        }
        if !staged_invite_receipt_delete.is_empty() {
            self.staged_invite_receipt_delete
                .lock()
                .map_err(lock_error)?
                .clear();
        }
        Ok(())
    }

    async fn max_epoch_id(&self, group_id: &[u8]) -> Result<Option<u64>, Self::Error> {
        let connection = self.connection.lock().map_err(lock_error)?;
        let value: Option<i64> = connection
            .query_row(
                "SELECT MAX(epoch_id) FROM epoch WHERE group_id = ?",
                [group_id],
                |row| row.get(0),
            )
            .map_err(sqlite_error)?;
        value
            .map(|id| u64::try_from(id).map_err(sqlite_error))
            .transpose()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutboxItem {
    pub id: String,
    pub room_id: String,
    pub epoch: u64,
    pub kind: String,
    pub payload: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsumedInviteReceipt {
    pub capability_handle: String,
    pub binding_hash: String,
    pub key_package_hash: String,
    pub epoch: u64,
    pub commit_outbox_id: String,
    pub welcome_outbox_id: String,
    pub response_binding: crate::CapabilityBinding,
    pub response_mac: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsumedJoinReceipt {
    pub invite_id: String,
    pub team_id: String,
    pub room_id: String,
    pub request_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub response_hash: String,
    pub epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeniedInviteReceipt {
    pub capability_handle: String,
    pub binding_hash: String,
    pub key_package_hash: String,
    pub response_outbox_id: String,
    pub response_binding: crate::CapabilityBinding,
    pub response_mac: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredHistoryCiphertext {
    expires_at_unix_seconds: u64,
    ciphertext: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("encrypted MLS store failed: {0}")]
    Sqlite(#[from] SqLiteDataStorageError),
    #[error("invalid or oversized store value")]
    InvalidValue,
    #[error("stored value is corrupt")]
    CorruptValue,
}

impl EncryptedStore {
    pub fn open(path: &Path, wrapping_key: [u8; 32]) -> Result<Self, StoreError> {
        let strategy = CipheredConnectionStrategy::new(
            FileConnectionStrategy::new(path),
            SqlCipherConfig::new(SqlCipherKey::RawKey(wrapping_key)),
        );
        let engine =
            SqLiteDataStorageEngine::new(strategy)?.with_journal_mode(Some(JournalMode::Wal));
        let application = engine.application_data_storage()?;
        Ok(Self {
            engine,
            application,
        })
    }

    pub fn group_state_storage(&self) -> Result<SqLiteGroupStateStorage, StoreError> {
        Ok(self.engine.group_state_storage()?)
    }

    pub fn key_package_storage(&self) -> Result<SqLiteKeyPackageStorage, StoreError> {
        Ok(self.engine.key_package_storage()?)
    }

    /// Atomically publishes an opaque MLS message into the durable outbox. MLS state must be
    /// written through `group_state_storage` before this call; callers never send before this
    /// transaction succeeds.
    pub fn enqueue(&self, item: &OutboxItem) -> Result<(), StoreError> {
        validate_outbox(item)?;
        let encoded = serde_json::to_vec(item).map_err(|_| StoreError::InvalidValue)?;
        self.application
            .transact_insert(&[Item::new(outbox_key(&item.id), encoded)])?;
        Ok(())
    }

    pub fn pending_outbox(&self) -> Result<Vec<OutboxItem>, StoreError> {
        self.application
            .get_by_prefix("outbox:")?
            .into_iter()
            .map(|item| serde_json::from_slice(&item.value).map_err(|_| StoreError::CorruptValue))
            .collect()
    }

    pub fn acknowledge(&self, id: &str) -> Result<(), StoreError> {
        validate_component(id)?;
        self.application.delete(&outbox_key(id))?;
        Ok(())
    }

    pub fn put_history_ciphertext(
        &self,
        room_id: &str,
        epoch: u64,
        ciphertext: &[u8],
        retention_days: u16,
    ) -> Result<(), StoreError> {
        validate_component(room_id)?;
        if ciphertext.is_empty() || ciphertext.len() > MAX_OUTBOX_PAYLOAD {
            return Err(StoreError::InvalidValue);
        }
        if !(1..=365).contains(&retention_days) {
            return Err(StoreError::InvalidValue);
        }
        let now = unix_seconds()?;
        let stored = StoredHistoryCiphertext {
            expires_at_unix_seconds: now.saturating_add(u64::from(retention_days) * 86_400),
            ciphertext: ciphertext.to_vec(),
        };
        self.application.insert(
            &format!("history:{room_id}:{epoch}"),
            &serde_json::to_vec(&stored).map_err(|_| StoreError::InvalidValue)?,
        )?;
        Ok(())
    }

    pub fn history_ciphertext(
        &self,
        room_id: &str,
        epoch: u64,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        validate_component(room_id)?;
        let key = format!("history:{room_id}:{epoch}");
        let Some(encoded) = self.application.get(&key)? else {
            return Ok(None);
        };
        let stored: StoredHistoryCiphertext =
            serde_json::from_slice(&encoded).map_err(|_| StoreError::CorruptValue)?;
        if stored.expires_at_unix_seconds <= unix_seconds()? {
            self.application.delete(&key)?;
            return Ok(None);
        }
        Ok(Some(stored.ciphertext))
    }

    pub fn set_history_ciphertext_retention(
        &self,
        room_id: &str,
        retention_days: u16,
    ) -> Result<(), StoreError> {
        validate_component(room_id)?;
        if !(1..=365).contains(&retention_days) {
            return Err(StoreError::InvalidValue);
        }
        let prefix = format!("history:{room_id}:");
        let expires_at = unix_seconds()?.saturating_add(u64::from(retention_days) * 86_400);
        for item in self.application.get_by_prefix(&prefix)? {
            let mut stored: StoredHistoryCiphertext =
                serde_json::from_slice(&item.value).map_err(|_| StoreError::CorruptValue)?;
            stored.expires_at_unix_seconds = expires_at;
            self.application.insert(
                &item.key,
                &serde_json::to_vec(&stored).map_err(|_| StoreError::InvalidValue)?,
            )?;
        }
        Ok(())
    }

    pub fn delete_history_ciphertext(&self, room_id: &str, epoch: u64) -> Result<(), StoreError> {
        validate_component(room_id)?;
        self.application
            .delete(&format!("history:{room_id}:{epoch}"))?;
        Ok(())
    }

    pub fn latest_history_ciphertext(
        &self,
        room_id: &str,
    ) -> Result<Option<(u64, Vec<u8>)>, StoreError> {
        validate_component(room_id)?;
        let prefix = format!("history:{room_id}:");
        let mut latest = None;
        for item in self.application.get_by_prefix(&prefix)? {
            let Some(epoch) = item
                .key
                .strip_prefix(&prefix)
                .and_then(|v| v.parse::<u64>().ok())
            else {
                continue;
            };
            if let Some(ciphertext) = self.history_ciphertext(room_id, epoch)? {
                if latest.as_ref().is_none_or(|(current, _)| epoch > *current) {
                    latest = Some((epoch, ciphertext));
                }
            }
        }
        Ok(latest)
    }

    pub fn delete_all_history_ciphertexts(&self, room_id: &str) -> Result<(), StoreError> {
        validate_component(room_id)?;
        self.application
            .delete_by_prefix(&format!("history:{room_id}:"))?;
        Ok(())
    }
}

fn validate_outbox(item: &OutboxItem) -> Result<(), StoreError> {
    validate_component(&item.id)?;
    validate_component(&item.room_id)?;
    validate_component(&item.kind)?;
    if item.payload.is_empty() || item.payload.len() > MAX_OUTBOX_PAYLOAD {
        return Err(StoreError::InvalidValue);
    }
    if item
        .metadata
        .as_ref()
        .is_some_and(|value| value.len() > 16_384)
    {
        return Err(StoreError::InvalidValue);
    }
    Ok(())
}

fn outbox_key(id: &str) -> String {
    format!("outbox:{id}")
}

fn blob_key_name(room_id: &str, blob_id: &[u8], epoch: u64) -> String {
    format!("blob-key:{room_id}:{epoch}:{:x}", Sha256::digest(blob_id))
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn validate_component(value: &str) -> Result<(), StoreError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err(StoreError::InvalidValue);
    }
    Ok(())
}

fn unix_seconds() -> Result<u64, StoreError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|_| StoreError::InvalidValue)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mls_rs_provider_sqlite::connection_strategy::ConnectionStrategy;

    #[test]
    fn encrypted_store_reopens_and_outbox_is_durable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mls.db");
        let key = [7; 32];
        let item = OutboxItem {
            id: "msg-1".into(),
            room_id: "room-1".into(),
            epoch: 4,
            kind: "commit".into(),
            payload: b"opaque".to_vec(),
            metadata: None,
        };
        EncryptedStore::open(&path, key)
            .unwrap()
            .enqueue(&item)
            .unwrap();
        let reopened = EncryptedStore::open(&path, key).unwrap();
        assert_eq!(reopened.pending_outbox().unwrap(), vec![item]);
        reopened.acknowledge("msg-1").unwrap();
        assert!(reopened.pending_outbox().unwrap().is_empty());
        assert!(EncryptedStore::open(&path, [8; 32]).is_err());
    }

    #[test]
    fn history_ciphertext_is_epoch_scoped() {
        let dir = tempfile::tempdir().unwrap();
        let store = EncryptedStore::open(&dir.path().join("mls.db"), [3; 32]).unwrap();
        store
            .put_history_ciphertext("room-1", 8, b"ciphertext", 30)
            .unwrap();
        assert_eq!(
            store.history_ciphertext("room-1", 8).unwrap().unwrap(),
            b"ciphertext"
        );
        assert!(store.history_ciphertext("room-1", 9).unwrap().is_none());
        assert!(store
            .put_history_ciphertext("room-1", 9, b"ciphertext", 0)
            .is_err());
        let expired = StoredHistoryCiphertext {
            expires_at_unix_seconds: 1,
            ciphertext: b"expired".to_vec(),
        };
        store
            .application
            .insert("history:room-1:10", &serde_json::to_vec(&expired).unwrap())
            .unwrap();
        assert!(store.history_ciphertext("room-1", 10).unwrap().is_none());
        assert!(store
            .application
            .get("history:room-1:10")
            .unwrap()
            .is_none());

        store
            .put_history_ciphertext("room-1", 11, b"older", 30)
            .unwrap();
        store
            .put_history_ciphertext("room-1", 12, b"newer", 30)
            .unwrap();
        let before: StoredHistoryCiphertext =
            serde_json::from_slice(&store.application.get("history:room-1:11").unwrap().unwrap())
                .unwrap();
        store.set_history_ciphertext_retention("room-1", 1).unwrap();
        let after_11: StoredHistoryCiphertext =
            serde_json::from_slice(&store.application.get("history:room-1:11").unwrap().unwrap())
                .unwrap();
        let after_12: StoredHistoryCiphertext =
            serde_json::from_slice(&store.application.get("history:room-1:12").unwrap().unwrap())
                .unwrap();
        assert!(after_11.expires_at_unix_seconds < before.expires_at_unix_seconds);
        assert_eq!(
            after_11.expires_at_unix_seconds,
            after_12.expires_at_unix_seconds
        );
        drop(store);
        let reopened = EncryptedStore::open(&dir.path().join("mls.db"), [3; 32]).unwrap();
        assert_eq!(
            reopened.history_ciphertext("room-1", 11).unwrap().unwrap(),
            b"older"
        );
    }

    #[test]
    fn expiry_and_forget_remove_retained_history_and_blob_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mls.db");
        let key = [17; 32];
        let app = EncryptedStore::open(&path, key).unwrap();
        app.put_history_ciphertext("room-1", 2, b"opaque", 30)
            .unwrap();
        let strategy = CipheredConnectionStrategy::new(
            FileConnectionStrategy::new(&path),
            SqlCipherConfig::new(SqlCipherKey::RawKey(key)),
        );
        let connection = strategy.make_connection().unwrap();
        let storage = AtomicGroupStateStorage::new(connection);
        let expired = serde_json::to_vec(&RetainedSecret {
            expires_at_unix_seconds: 1,
            secret: vec![9; 32],
        })
        .unwrap();
        {
            let connection = storage.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO kvs (key, value) VALUES (?, ?), (?, ?)",
                    params![
                        "history-secret:room-1:2",
                        &expired,
                        "blob-key:room-1:2:deadbeef",
                        &expired
                    ],
                )
                .unwrap();
        }
        storage.prune_expired_material("room-1").unwrap();
        {
            let connection = storage.connection.lock().unwrap();
            let count: u64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM kvs WHERE key LIKE 'history-secret:room-1:%' OR key LIKE 'blob-key:room-1:%'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0);
        }
        {
            let connection = storage.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO kvs (key, value) VALUES (?, ?)",
                    params!["history-secret:room-1:3", expired],
                )
                .unwrap();
        }
        storage.delete_history_records("room-1").unwrap();
        assert!(app.history_ciphertext("room-1", 2).unwrap().is_none());
        assert!(storage.history_secret("room-1", 3).unwrap().is_none());
    }
}
