use super::*;

impl EncryptedStore {
    pub fn put_pending_invite_request(
        &self,
        request: &PendingInviteRequest,
    ) -> Result<(), StoreError> {
        validate_pending_invite_request(request)?;
        let key = format!("pending-invite:{}", request.original_binding.request_id);
        if let Some(existing) = self.application.get(&key)? {
            let existing: PendingInviteRequest =
                serde_json::from_slice(&existing).map_err(|_| StoreError::CorruptValue)?;
            return if &existing == request {
                Ok(())
            } else {
                Err(StoreError::InvalidValue)
            };
        }
        if self.application.get_by_prefix("pending-invite:")?.len() >= 16 {
            return Err(StoreError::InvalidValue);
        }
        self.application.insert(
            &key,
            &serde_json::to_vec(request).map_err(|_| StoreError::InvalidValue)?,
        )?;
        Ok(())
    }

    pub fn pending_invite_requests(&self) -> Result<Vec<PendingInviteRequest>, StoreError> {
        self.application
            .get_by_prefix("pending-invite:")?
            .into_iter()
            .map(|item| {
                let request: PendingInviteRequest =
                    serde_json::from_slice(&item.value).map_err(|_| StoreError::CorruptValue)?;
                validate_pending_invite_request(&request)?;
                if item.key != format!("pending-invite:{}", request.original_binding.request_id) {
                    return Err(StoreError::CorruptValue);
                }
                Ok(request)
            })
            .collect()
    }

    pub fn pending_invite_request(
        &self,
        request_id: &str,
    ) -> Result<Option<PendingInviteRequest>, StoreError> {
        validate_component(request_id)?;
        let Some(value) = self
            .application
            .get(&format!("pending-invite:{request_id}"))?
        else {
            return Ok(None);
        };
        let request = serde_json::from_slice(&value).map_err(|_| StoreError::CorruptValue)?;
        validate_pending_invite_request(&request)?;
        Ok(Some(request))
    }

    pub fn delete_pending_invite_request(&self, request_id: &str) -> Result<(), StoreError> {
        validate_component(request_id)?;
        self.application
            .delete(&format!("pending-invite:{request_id}"))?;
        Ok(())
    }
}

pub(super) fn validate_pending_invite_request(
    request: &PendingInviteRequest,
) -> Result<(), StoreError> {
    validate_component(&request.original_binding.request_id)?;
    validate_component(&request.key_package_id)?;
    if request.original_binding.phase != "request"
        || request.original_binding.status.is_some()
        || request.original_binding.decided_at.is_some()
        || crate::encode_capability_binding(&request.original_binding).is_err()
        || request.capability_url_value.len() != 43
        || !request
            .capability_url_value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || request.sealed_request.is_empty()
        || request.sealed_request.len() > MAX_OUTBOX_PAYLOAD
    {
        return Err(StoreError::InvalidValue);
    }
    Ok(())
}
