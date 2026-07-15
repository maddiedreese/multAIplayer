use super::*;

impl MlsEngine {
    pub fn remove_member(
        &mut self,
        room_id: &str,
        leaf: u32,
    ) -> Result<OutboundCommit, EngineError> {
        self.ensure_host(room_id)?;
        self.ensure_application_outbox_drained(room_id)?;
        if self
            .hosts
            .get(room_id)
            .is_some_and(|host| host.host_leaf == leaf)
        {
            return Err(EngineError::InvalidInput);
        }
        let group_storage = self.group_storage.clone();
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let output = group
            .commit_builder()
            .remove_member(leaf)
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "remove_member",
            ))?
            .build()
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "build_remove_commit",
            ))?;
        let bytes = output.commit_message.to_bytes().map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_remove_commit",
        ))?;
        let parent_epoch = group.current_epoch();
        let outbox_id = Self::persist_outbound_with_metadata(
            &group_storage,
            group,
            room_id,
            group.current_epoch() + 1,
            "remove",
            bytes.clone(),
            Some(
                serde_json::to_vec(&OutboxMetadata::Commit { parent_epoch }).map_err(
                    engine_failure(EngineErrorCategory::Serialization, "encode_commit_metadata"),
                )?,
            ),
        )?;
        Ok(OutboundCommit {
            message: bytes,
            outbox_id,
            parent_epoch,
        })
    }

    /// Apply or retire an outbound message only after the relay confirms this exact id.
    pub fn publish_succeeded(
        &mut self,
        room_id: &str,
        expected_message_id: &str,
    ) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        let item = self
            .group_storage
            .outbox_item(expected_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_publish_outbox",
            ))?
            .ok_or(EngineError::InvalidInput)?;
        if item.room_id != room_id {
            return Err(EngineError::InvalidInput);
        }
        if matches!(
            item.kind.as_str(),
            "application" | "welcome" | "invite-denial"
        ) {
            self.group_storage
                .delete_outbox(expected_message_id)
                .map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "delete_published_outbox",
                ))?;
            return self.current_epoch(room_id);
        }
        if !matches!(item.kind.as_str(), "add" | "remove" | "handoff") {
            return Err(EngineError::InvalidInput);
        }
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        if !group.has_pending_commit() || item.epoch != group.current_epoch() + 1 {
            return Err(EngineError::InvalidInput);
        }
        group.apply_pending_commit().map_err(engine_failure(
            EngineErrorCategory::Protocol,
            "apply_pending_commit",
        ))?;
        let secret = history_secret_for_group(group)?;
        let staged = self.group_storage.staged_write();
        staged
            .stage_history_secret(room_id, group.current_epoch(), secret)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "stage_history_secret",
            ))?;
        staged
            .stage_outbox_delete(expected_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "stage_outbox_delete",
            ))?;
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        self.pending_hosts.remove(room_id);
        let host =
            validate_host(&group.roster(), &group.context().extensions).map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "validate_published_host_context",
            ))?;
        self.hosts.insert(room_id.into(), host);
        Ok(group.current_epoch())
    }

    pub fn clear_pending_commit(
        &mut self,
        room_id: &str,
        expected_message_id: &str,
    ) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        let item = self
            .group_storage
            .outbox_item(expected_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_pending_commit_outbox",
            ))?
            .ok_or(EngineError::InvalidInput)?;
        if item.room_id != room_id || !matches!(item.kind.as_str(), "add" | "remove" | "handoff") {
            return Err(EngineError::InvalidInput);
        }
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        if !group.has_pending_commit() {
            return Err(EngineError::InvalidInput);
        }
        group.clear_pending_commit();
        self.pending_hosts.remove(room_id);
        let staged = self.group_storage.staged_write();
        staged
            .stage_outbox_delete(expected_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "stage_outbox_delete",
            ))?;
        if item.kind == "add" {
            if let Some(receipt) = self
                .group_storage
                .invite_receipt_for_commit(expected_message_id)
                .map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "load_commit_invite_receipt",
                ))?
            {
                staged
                    .stage_invite_receipt_delete(&receipt.capability_handle)
                    .map_err(engine_failure(
                        EngineErrorCategory::Storage,
                        "stage_invite_receipt_delete",
                    ))?;
            }
            for related in self
                .group_storage
                .outbox_for_room_epoch(room_id, item.epoch)
                .map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "load_epoch_outbox",
                ))?
            {
                if related.kind == "welcome" {
                    staged
                        .stage_outbox_delete(&related.id)
                        .map_err(engine_failure(
                            EngineErrorCategory::Storage,
                            "stage_outbox_delete",
                        ))?;
                }
            }
        }
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        Ok(group.current_epoch())
    }

    /// Retire one application ciphertext that the relay has terminally rejected as stale.
    /// This cannot delete handshake, Welcome, or invite-response recovery records.
    pub fn retire_stale_application(
        &self,
        room_id: &str,
        expected_message_id: &str,
    ) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        valid_room(expected_message_id)?;
        let item = self
            .group_storage
            .outbox_item(expected_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_stale_outbox",
            ))?
            .ok_or(EngineError::InvalidInput)?;
        if item.room_id != room_id || item.kind != "application" {
            return Err(EngineError::InvalidInput);
        }
        self.group_storage
            .delete_outbox(expected_message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "delete_stale_outbox",
            ))?;
        self.current_epoch(room_id)
    }
}
