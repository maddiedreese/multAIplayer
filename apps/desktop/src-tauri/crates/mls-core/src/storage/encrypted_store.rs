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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingInviteRequest {
    pub capability_url_value: String,
    pub original_binding: crate::CapabilityBinding,
    pub key_package_id: String,
    pub sealed_request: String,
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

    /// Persists the latest validated member-only room configuration in the
    /// SQLCipher application store. Callers validate the payload before it
    /// reaches this boundary; the relay never receives this record.
    pub fn put_room_config(&self, room_id: &str, payload: &[u8]) -> Result<(), StoreError> {
        validate_component(room_id)?;
        if payload.is_empty() || payload.len() > MAX_OUTBOX_PAYLOAD {
            return Err(StoreError::InvalidValue);
        }
        self.application
            .insert(&format!("room-config:{room_id}"), payload)?;
        Ok(())
    }

    pub fn room_config(&self, room_id: &str) -> Result<Option<Vec<u8>>, StoreError> {
        validate_component(room_id)?;
        let Some(item) = self.application.get(&format!("room-config:{room_id}"))? else {
            return Ok(None);
        };
        if item.is_empty() || item.len() > MAX_OUTBOX_PAYLOAD {
            self.application.delete(&format!("room-config:{room_id}"))?;
            return Err(StoreError::CorruptValue);
        }
        Ok(Some(item))
    }

    pub fn delete_room_config(&self, room_id: &str) -> Result<(), StoreError> {
        validate_component(room_id)?;
        self.application.delete(&format!("room-config:{room_id}"))?;
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
    use super::super::{
        history_ciphertext::StoredHistoryCiphertext,
        pending_invites::validate_pending_invite_request,
    };
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

    fn pending_invite_fixture(request_id: &str) -> PendingInviteRequest {
        PendingInviteRequest {
            capability_url_value: "A".repeat(43),
            original_binding: crate::CapabilityBinding {
                version: 3,
                phase: "request".into(),
                invite_id: "invite-1".into(),
                team_id: "team-1".into(),
                room_id: "room-1".into(),
                key_epoch: 2,
                key_package_hash: "sha256:hash".into(),
                request_id: request_id.into(),
                request_nonce: "nonce-1".into(),
                requester_user_id: "github:guest".into(),
                requester_device_id: "device-1".into(),
                host_user_id: "github:host".into(),
                host_device_id: "device-host".into(),
                expires_at: "2030-01-01T00:00:00.000Z".into(),
                status: None,
                decided_at: None,
            },
            key_package_id: format!("package-{request_id}"),
            sealed_request: "{\"version\":3}".into(),
        }
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
    fn room_config_is_local_durable_and_deletable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mls.db");
        let key = [11; 32];
        let payload = br#"{"eventType":"room.config","projectPath":"/private/project"}"#;
        EncryptedStore::open(&path, key)
            .unwrap()
            .put_room_config("room-1", payload)
            .unwrap();
        let reopened = EncryptedStore::open(&path, key).unwrap();
        assert_eq!(
            reopened.room_config("room-1").unwrap().as_deref(),
            Some(payload.as_slice())
        );
        reopened.delete_room_config("room-1").unwrap();
        assert_eq!(reopened.room_config("room-1").unwrap(), None);
    }

    #[test]
    fn pending_invite_request_is_durable_exact_and_deletable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mls.db");
        let key = [9; 32];
        let request = pending_invite_fixture("request-1");
        EncryptedStore::open(&path, key)
            .unwrap()
            .put_pending_invite_request(&request)
            .unwrap();
        let reopened = EncryptedStore::open(&path, key).unwrap();
        reopened.put_pending_invite_request(&request).unwrap();
        let mut conflicting = request.clone();
        conflicting.sealed_request = "{\"version\":3,\"different\":true}".into();
        assert!(matches!(
            reopened.put_pending_invite_request(&conflicting),
            Err(StoreError::InvalidValue)
        ));
        assert_eq!(
            reopened.pending_invite_request("request-1").unwrap(),
            Some(request.clone())
        );
        assert_eq!(
            reopened.pending_invite_requests().unwrap(),
            vec![request.clone()]
        );
        reopened.delete_pending_invite_request("request-1").unwrap();
        assert!(reopened.pending_invite_requests().unwrap().is_empty());
        reopened
            .application
            .insert(
                "pending-invite:wrong-request",
                &serde_json::to_vec(&request).unwrap(),
            )
            .unwrap();
        assert!(matches!(
            reopened.pending_invite_requests(),
            Err(StoreError::CorruptValue)
        ));
    }

    #[test]
    fn pending_invite_request_count_and_payloads_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let store = EncryptedStore::open(&dir.path().join("mls.db"), [10; 32]).unwrap();
        for index in 0..16 {
            store
                .put_pending_invite_request(&pending_invite_fixture(&format!("request-{index}")))
                .unwrap();
        }
        assert!(matches!(
            store.put_pending_invite_request(&pending_invite_fixture("request-overflow")),
            Err(StoreError::InvalidValue)
        ));

        let mut invalid = pending_invite_fixture("request-invalid");
        invalid.sealed_request = "x".repeat(MAX_OUTBOX_PAYLOAD + 1);
        assert!(matches!(
            validate_pending_invite_request(&invalid),
            Err(StoreError::InvalidValue)
        ));
        store
            .application
            .insert("pending-invite:request-0", b"{")
            .unwrap();
        assert!(matches!(
            store.pending_invite_requests(),
            Err(StoreError::CorruptValue)
        ));
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
