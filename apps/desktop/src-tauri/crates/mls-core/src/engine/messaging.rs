use super::*;

impl MlsEngine {
    pub fn encrypt_application(
        &mut self,
        room_id: &str,
        message_id: &str,
        payload: &[u8],
        authenticated_data: ApplicationAuthenticatedDataInput,
    ) -> Result<OutboundApplication, EngineError> {
        valid_room(message_id)?;
        bounded(payload)?;
        if authenticated_data.version != 1
            || authenticated_data.message_id != message_id
            || authenticated_data.room_id != room_id
            || !valid_authenticated_text(&authenticated_data.team_id, 128)
            || !valid_authenticated_text(&authenticated_data.kind, 128)
            || !valid_authenticated_text(&authenticated_data.sender_user_id, 128)
            || !valid_authenticated_text(&authenticated_data.sender_device_id, 128)
            || !valid_authenticated_text(&authenticated_data.created_at, 64)
        {
            return Err(EngineError::InvalidInput);
        }
        if self
            .group_storage
            .outbox_item(message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "check_application_outbox",
            ))?
            .is_some()
        {
            return Err(EngineError::InvalidInput);
        }
        let group_storage = self.group_storage.clone();
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let authenticated_data = serde_json::to_vec(&ApplicationAuthenticatedData {
            version: 1,
            epoch,
            message_id: authenticated_data.message_id,
            team_id: authenticated_data.team_id,
            room_id: authenticated_data.room_id,
            kind: authenticated_data.kind,
            sender_user_id: authenticated_data.sender_user_id,
            sender_device_id: authenticated_data.sender_device_id,
            created_at: authenticated_data.created_at,
        })
        .map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_application_aad",
        ))?;
        if authenticated_data.len() > 4096 {
            return Err(EngineError::InvalidInput);
        }
        let message = group
            .encrypt_application_message(payload, authenticated_data.clone())
            .and_then(|m| m.to_bytes())
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "encrypt_application",
            ))?;
        let outbox_id = Self::persist_outbound_with_id(
            &group_storage,
            group,
            room_id,
            group.current_epoch(),
            "application",
            message.clone(),
            Some(
                serde_json::to_vec(&OutboxMetadata::Application {
                    authenticated_data: authenticated_data.clone(),
                })
                .map_err(engine_failure(
                    EngineErrorCategory::Serialization,
                    "encode_application_outbox",
                ))?,
            ),
            message_id.to_owned(),
        )?;
        Ok(OutboundApplication {
            message,
            outbox_id,
            epoch,
            authenticated_data,
        })
    }

    pub fn process_incoming(
        &mut self,
        room_id: &str,
        message: &[u8],
    ) -> Result<Option<ApplicationOutput>, EngineError> {
        bounded(message)?;
        let encoded_message = message;
        let message_id = format!("{:x}", Sha256::digest(message));
        if self
            .group_storage
            .outbox_item(&message_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_incoming_outbox",
            ))?
            .is_some_and(|item| {
                item.room_id == room_id
                    && matches!(item.kind.as_str(), "add" | "remove" | "handoff")
                    && item.payload == message
            })
        {
            // The relay can replay our own accepted Commit from backlog before its
            // publish acknowledgement reaches us. Keep the pending Commit intact;
            // only publish_succeeded may apply it and retire the durable outbox item.
            return Ok(None);
        }
        let message = MlsMessage::from_bytes(message).map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "decode_incoming_message",
        ))?;
        let hinted_epoch = message.epoch();
        if let Some(epoch) = hinted_epoch {
            let is_application_echo = self
                .group_storage
                .outbox_for_room_epoch(room_id, epoch)
                .map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "load_epoch_outbox",
                ))?
                .into_iter()
                .any(|item| item.kind == "application" && item.payload == encoded_message);
            if is_application_echo {
                // As with Commits, an accepted application message can be replayed from
                // backlog before its publish acknowledgement arrives. The sender ratchet
                // was already persisted while encrypting it; do not receive it again.
                return Ok(None);
            }
        }
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let result = group
            .process_incoming_message(message)
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "process_incoming_message",
            ))?;
        match result {
            ReceivedMessage::ApplicationMessage(value) => {
                let payload = value.data().to_vec();
                group.write_to_storage().map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "write_group_state",
                ))?;
                Ok(Some(ApplicationOutput {
                    sender_leaf: value.sender_index,
                    epoch: hinted_epoch.unwrap_or(group.current_epoch()),
                    authenticated_data: value.authenticated_data,
                    payload,
                }))
            }
            ReceivedMessage::Commit(_) => {
                let next = validate_host(&group.roster(), &group.context().extensions).map_err(
                    engine_failure(
                        EngineErrorCategory::Protocol,
                        "validate_commit_host_context",
                    ),
                )?;
                let secret = history_secret_for_group(group)?;
                let staged = self.group_storage.staged_write();
                staged
                    .stage_history_secret(room_id, group.current_epoch(), secret)
                    .map_err(engine_failure(
                        EngineErrorCategory::Storage,
                        "stage_history_secret",
                    ))?;
                group.write_to_storage().map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "write_group_state",
                ))?;
                self.hosts.insert(room_id.into(), next);
                Ok(None)
            }
            _ => Err(EngineError::UnexpectedMessage),
        }
    }
}
