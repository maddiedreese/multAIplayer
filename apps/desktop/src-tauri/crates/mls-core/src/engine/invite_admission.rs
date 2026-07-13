use super::*;

impl MlsEngine {
    pub fn invite_receipt(
        &self,
        capability_handle: &str,
    ) -> Result<Option<ConsumedInviteReceipt>, EngineError> {
        self.group_storage
            .invite_receipt(capability_handle)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_invite_receipt",
            ))
    }

    pub fn invite_receipt_for_commit(
        &self,
        commit_outbox_id: &str,
    ) -> Result<Option<ConsumedInviteReceipt>, EngineError> {
        self.group_storage
            .invite_receipt_for_commit(commit_outbox_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_commit_invite_receipt",
            ))
    }

    pub fn welcome_retry_metadata(
        &self,
        outbox_id: &str,
    ) -> Result<WelcomeRetryMetadata, EngineError> {
        let item = self
            .group_storage
            .outbox_item(outbox_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_welcome_outbox",
            ))?
            .ok_or(EngineError::InvalidInput)?;
        if item.kind != "welcome" {
            return Err(EngineError::InvalidInput);
        }
        match serde_json::from_slice::<OutboxMetadata>(
            item.metadata.as_deref().ok_or(EngineError::InvalidInput)?,
        )
        .map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "decode_welcome_metadata",
        ))? {
            OutboxMetadata::Welcome(metadata) => Ok(metadata),
            _ => Err(EngineError::InvalidInput),
        }
    }

    pub fn deny_invite(
        &self,
        capability_handle: String,
        binding_hash: String,
        key_package_hash: String,
        response_binding: crate::CapabilityBinding,
        response_mac: String,
    ) -> Result<String, EngineError> {
        if self
            .group_storage
            .invite_receipt(&capability_handle)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_invite_receipt",
            ))?
            .is_some()
            || self
                .group_storage
                .denied_invite_receipt(&capability_handle)
                .map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "load_denied_invite_receipt",
                ))?
                .is_some()
        {
            return Err(EngineError::InvalidInput);
        }
        let room_id = response_binding.room_id.clone();
        let payload = serde_json::to_vec(&OutboxMetadata::InviteResponse {
            binding: response_binding.clone(),
            mac: response_mac.clone(),
        })
        .map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_invite_denial",
        ))?;
        let id = format!("{:x}", Sha256::digest(&payload));
        let epoch = self.current_epoch(&room_id)?;
        let outbox = OutboxItem {
            id: id.clone(),
            room_id,
            epoch,
            kind: "invite-denial".into(),
            payload: payload.clone(),
            metadata: Some(payload),
        };
        self.group_storage
            .record_invite_denial(
                &DeniedInviteReceipt {
                    capability_handle,
                    binding_hash,
                    key_package_hash,
                    response_outbox_id: id.clone(),
                    response_binding: response_binding.clone(),
                    response_mac: response_mac.clone(),
                },
                &outbox,
            )
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "record_invite_denial",
            ))?;
        Ok(id)
    }

    pub fn denied_invite_response(
        &self,
        capability_handle: &str,
    ) -> Result<Option<(DeniedInviteReceipt, crate::CapabilityBinding, String)>, EngineError> {
        let Some(receipt) = self
            .group_storage
            .denied_invite_receipt(capability_handle)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_denied_invite_receipt",
            ))?
        else {
            return Ok(None);
        };
        let binding = receipt.response_binding.clone();
        let mac = receipt.response_mac.clone();
        Ok(Some((receipt, binding, mac)))
    }

    pub fn join_welcome(&mut self, room_id: &str, welcome: &[u8]) -> Result<u64, EngineError> {
        self.join_welcome_internal(room_id, welcome, None)
    }

    pub fn join_welcome_for_invite(
        &mut self,
        welcome: &[u8],
        admission: JoinAdmissionMetadata,
        response_hash: String,
    ) -> Result<u64, EngineError> {
        valid_room(&admission.room_id)?;
        if let Some(receipt) = self
            .group_storage
            .join_receipt(&admission.request_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_join_receipt",
            ))?
        {
            return if receipt.response_hash == response_hash
                && receipt.room_id == admission.room_id
                && receipt.invite_id == admission.invite_id
                && receipt.team_id == admission.team_id
                && receipt.requester_user_id == admission.requester_user_id
                && receipt.requester_device_id == admission.requester_device_id
            {
                Ok(receipt.epoch)
            } else {
                Err(EngineError::InvalidInput)
            };
        }
        let room_id = admission.room_id.clone();
        self.join_welcome_internal(&room_id, welcome, Some((admission, response_hash)))
    }

    fn join_welcome_internal(
        &mut self,
        room_id: &str,
        welcome: &[u8],
        receipt: Option<(JoinAdmissionMetadata, String)>,
    ) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        bounded(welcome)?;
        let message = MlsMessage::from_bytes(welcome).map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "decode_welcome_message",
        ))?;
        if message.cipher_suite() != Some(MLS_CIPHERSUITE) {
            return Err(EngineError::InvalidInput);
        }
        let (mut group, _) = self
            .client
            .join_group(None, &message, None)
            .map_err(engine_failure(EngineErrorCategory::Protocol, "join_group"))?;
        if group.group_id() != room_id.as_bytes() {
            return Err(EngineError::InvalidInput);
        }
        let epoch = group.current_epoch();
        let host = validate_host(&group.roster(), &group.context().extensions)
            .map_err(|_| EngineError::InvalidInput)?;
        let staged = self.group_storage.staged_write();
        Self::stage_current_history_secret(&staged, room_id, &group)?;
        if let Some((admission, response_hash)) = receipt {
            if let Err(cause) = staged.stage_join_receipt(ConsumedJoinReceipt {
                invite_id: admission.invite_id,
                team_id: admission.team_id,
                room_id: admission.room_id,
                request_id: admission.request_id,
                requester_user_id: admission.requester_user_id,
                requester_device_id: admission.requester_device_id,
                response_hash,
                epoch,
            }) {
                return Err(EngineError::operation_failed(
                    EngineErrorCategory::Storage,
                    "stage_join_receipt",
                    cause,
                ));
            }
        }
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        self.hosts.insert(room_id.into(), host);
        self.groups.insert(room_id.into(), group);
        Ok(epoch)
    }

    pub fn pending_join_admissions(&self) -> Result<Vec<ConsumedJoinReceipt>, EngineError> {
        self.group_storage
            .pending_join_receipts()
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_pending_join_receipts",
            ))
    }

    pub fn complete_join_admission(
        &self,
        room_id: &str,
        request_id: &str,
    ) -> Result<(), EngineError> {
        self.group_storage
            .complete_join_receipt(room_id, request_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "complete_join_receipt",
            ))
    }
}
