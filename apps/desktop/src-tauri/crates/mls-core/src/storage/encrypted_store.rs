use super::*;

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

pub(super) fn validate_outbox(item: &OutboxItem) -> Result<(), StoreError> {
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

pub(super) fn outbox_key(id: &str) -> String {
    format!("outbox:{id}")
}

pub(super) fn blob_key_name(room_id: &str, blob_id: &[u8], epoch: u64) -> String {
    format!("blob-key:{room_id}:{epoch}:{:x}", Sha256::digest(blob_id))
}

pub(super) fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub(super) fn validate_component(value: &str) -> Result<(), StoreError> {
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

pub(super) fn validate_identity_component(value: &str) -> Result<(), StoreError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':'))
    {
        return Err(StoreError::InvalidValue);
    }
    Ok(())
}

pub(super) fn unix_seconds() -> Result<u64, StoreError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|_| StoreError::InvalidValue)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mls_rs_provider_sqlite::connection_strategy::ConnectionStrategy;

    fn assert_staging_is_empty(storage: &AtomicGroupStateStorage) {
        assert!(storage.staged_outbox.lock().unwrap().is_empty());
        assert!(storage.staged_history_secret.lock().unwrap().is_none());
        assert!(storage.staged_outbox_delete.lock().unwrap().is_empty());
        assert!(storage.staged_invite_receipts.lock().unwrap().is_empty());
        assert!(storage.staged_join_receipts.lock().unwrap().is_empty());
        assert!(storage
            .staged_invite_receipt_delete
            .lock()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn staging_guard_clears_history_when_a_later_outbox_delete_fails() {
        let storage = AtomicGroupStateStorage::new(Connection::open_in_memory().unwrap());
        let result = (|| -> Result<(), StoreError> {
            let staged = storage.staged_write();
            staged.stage_history_secret("room-1", 1, vec![7; 32])?;
            staged.stage_outbox_delete("invalid id")?;
            Ok(())
        })();

        assert!(matches!(result, Err(StoreError::InvalidValue)));
        assert_staging_is_empty(&storage);
    }

    #[test]
    fn staging_guard_clears_outbox_delete_when_a_later_receipt_delete_fails() {
        let storage = AtomicGroupStateStorage::new(Connection::open_in_memory().unwrap());
        let result = (|| -> Result<(), StoreError> {
            let staged = storage.staged_write();
            staged.stage_outbox_delete("message-1")?;
            staged.stage_invite_receipt_delete("invalid handle")?;
            Ok(())
        })();

        assert!(matches!(result, Err(StoreError::InvalidValue)));
        assert_staging_is_empty(&storage);
    }

    #[test]
    fn join_receipt_staging_accepts_protocol_identity_ids_but_rejects_unsafe_text() {
        let storage = AtomicGroupStateStorage::new(Connection::open_in_memory().unwrap());
        let receipt = ConsumedJoinReceipt {
            invite_id: "invite-1".into(),
            team_id: "team-1".into(),
            room_id: "room-1".into(),
            request_id: "request-1".into(),
            requester_user_id: "github:native-guest".into(),
            requester_device_id: "device_1".into(),
            response_hash: "a".repeat(64),
            epoch: 1,
        };
        storage.stage_join_receipt(receipt.clone()).unwrap();
        assert_eq!(
            storage.staged_join_receipts.lock().unwrap().as_slice(),
            std::slice::from_ref(&receipt)
        );
        storage.clear_staged_join_receipts();

        assert!(matches!(
            storage.stage_join_receipt(ConsumedJoinReceipt {
                requester_user_id: "github:unsafe user".into(),
                ..receipt
            }),
            Err(StoreError::InvalidValue)
        ));
    }

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
