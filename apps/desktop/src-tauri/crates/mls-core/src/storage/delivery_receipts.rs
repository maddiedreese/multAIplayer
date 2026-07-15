use super::*;

impl AtomicGroupStateStorage {
    pub(super) fn stage_outbox(&self, item: OutboxItem) -> Result<(), StoreError> {
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

    pub(super) fn clear_staged_outbox(&self) {
        if let Ok(mut staged) = self.staged_outbox.lock() {
            staged.clear();
        }
    }

    pub(super) fn clear_staged_invite_receipts(&self) {
        if let Ok(mut staged) = self.staged_invite_receipts.lock() {
            staged.clear();
        }
    }

    pub(super) fn stage_join_receipt(
        &self,
        receipt: ConsumedJoinReceipt,
    ) -> Result<(), StoreError> {
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

    pub(super) fn clear_staged_join_receipts(&self) {
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
}
