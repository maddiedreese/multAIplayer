use super::*;

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
