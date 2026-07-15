use super::*;

impl MlsEngine {
    pub fn transfer_host(
        &mut self,
        room_id: &str,
        next_leaf: u32,
        next_device_id: String,
        transfer_id: String,
    ) -> Result<OutboundCommit, EngineError> {
        self.ensure_host(room_id)?;
        self.ensure_application_outbox_drained(room_id)?;
        if next_device_id.is_empty()
            || next_device_id.len() > 128
            || transfer_id.is_empty()
            || transfer_id.len() > 128
            || !transfer_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
        {
            return Err(EngineError::InvalidInput);
        }
        let group_storage = self.group_storage.clone();
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let record = HostContext {
            version: 2,
            host_leaf: next_leaf,
            host_device_id: next_device_id,
            transfer_id: Some(transfer_id.clone()),
        };
        if roster_credential(group, next_leaf)?.device_id != record.host_device_id {
            return Err(EngineError::InvalidInput);
        }
        let aad = serde_json::to_vec(&record).map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_host_transfer",
        ))?;
        let output = group
            .commit_builder()
            .set_group_context_ext(host_extension(&record).map_err(engine_failure(
                EngineErrorCategory::Serialization,
                "encode_host_extension",
            ))?)
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "stage_host_transfer",
            ))?
            .authenticated_data(aad)
            .build()
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "sign_host_transfer",
            ))?;
        let bytes = output.commit_message.to_bytes().map_err(engine_failure(
            EngineErrorCategory::Protocol,
            "encode_host_transfer_message",
        ))?;
        let commit_message_id = format!("{:x}", Sha256::digest(&bytes));
        let next = roster_credential(group, next_leaf)?;
        let parent_epoch = group.current_epoch();
        let authorization = HostTransferAuthorizationPayload {
            version: 2,
            transfer_id,
            room_id: room_id.to_owned(),
            commit_message_id: commit_message_id.clone(),
            parent_epoch: group.current_epoch(),
            outgoing_host_user_id: self.self_user_id.clone(),
            outgoing_host_device_id: self.self_device_id.clone(),
            next_host_user_id: next.github_user_id,
            next_host_device_id: record.host_device_id.clone(),
            next_host_leaf: next_leaf,
        };
        let staged = group_storage.staged_write();
        staged
            .stage_outbox(OutboxItem {
                id: commit_message_id.clone(),
                room_id: room_id.to_owned(),
                epoch: group.current_epoch() + 1,
                kind: "handoff".to_owned(),
                payload: bytes.clone(),
                metadata: Some(
                    serde_json::to_vec(&OutboxMetadata::HostTransfer(authorization)).map_err(
                        engine_failure(
                            EngineErrorCategory::Serialization,
                            "encode_host_transfer_outbox",
                        ),
                    )?,
                ),
            })
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "stage_host_transfer_outbox",
            ))?;
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        self.pending_hosts.insert(room_id.into(), record);
        Ok(OutboundCommit {
            message: bytes,
            outbox_id: commit_message_id,
            parent_epoch,
        })
    }

    pub fn host_transfer_authorization(
        &self,
        room_id: &str,
        commit_message_id: &str,
    ) -> Result<HostTransferAuthorizationPayload, EngineError> {
        valid_room(room_id)?;
        let item = self
            .group_storage
            .outbox_item(commit_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_host_transfer_outbox",
            ))?
            .ok_or(EngineError::InvalidInput)?;
        if item.room_id != room_id || item.kind != "handoff" {
            return Err(EngineError::InvalidInput);
        }
        let metadata: OutboxMetadata =
            serde_json::from_slice(item.metadata.as_deref().ok_or(EngineError::InvalidInput)?)
                .map_err(engine_failure(
                    EngineErrorCategory::Serialization,
                    "decode_host_transfer_outbox",
                ))?;
        let OutboxMetadata::HostTransfer(authorization) = metadata else {
            return Err(EngineError::InvalidInput);
        };
        if authorization.room_id != room_id
            || authorization.commit_message_id != commit_message_id
            || authorization.parent_epoch + 1 != item.epoch
            || authorization.outgoing_host_user_id != self.self_user_id
            || authorization.outgoing_host_device_id != self.self_device_id
        {
            return Err(EngineError::InvalidInput);
        }
        Ok(authorization)
    }
}
