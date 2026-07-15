use super::*;

impl AtomicGroupStateStorage {
    pub(super) fn stage_invite_receipt(
        &self,
        receipt: ConsumedInviteReceipt,
    ) -> Result<(), StoreError> {
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

    pub(super) fn stage_invite_receipt_delete(
        &self,
        capability_handle: &str,
    ) -> Result<(), StoreError> {
        validate_component(capability_handle)?;
        self.staged_invite_receipt_delete
            .lock()
            .map_err(|_| StoreError::CorruptValue)?
            .push(capability_handle.to_owned());
        Ok(())
    }

    pub(super) fn clear_staged_invite_receipt_delete(&self) {
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
}
