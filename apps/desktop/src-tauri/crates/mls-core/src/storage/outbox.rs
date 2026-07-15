use super::*;

impl AtomicGroupStateStorage {
    pub(super) fn stage_outbox_delete(&self, id: &str) -> Result<(), StoreError> {
        validate_component(id)?;
        self.staged_outbox_delete
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(id.to_owned());
        Ok(())
    }

    pub(super) fn clear_staged_outbox_deletes(&self) {
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
