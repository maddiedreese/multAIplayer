use super::*;

impl AtomicGroupStateStorage {
    pub(super) fn stage_history_secret(
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

    pub(super) fn clear_staged_history_secret(&self) {
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
}
