use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredHistoryCiphertext {
    pub(super) expires_at_unix_seconds: u64,
    pub(super) ciphertext: Vec<u8>,
}

impl EncryptedStore {
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
