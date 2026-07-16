use super::*;

impl MlsEngine {
    pub fn generate_key_package(&self) -> Result<Vec<u8>, EngineError> {
        self.client
            .generate_key_package_message(Default::default(), Default::default(), None)
            .and_then(|message| message.to_bytes())
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "generate_key_package",
            ))
    }

    pub fn create_group(&mut self, room_id: &str) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        let host = HostContext {
            version: 2,
            host_leaf: 0,
            host_device_id: self.self_device_id.clone(),
            transfer_id: None,
        };
        let mut group = self
            .client
            .create_group_with_id(
                room_id.as_bytes().to_vec(),
                host_extension(&host).map_err(engine_failure(
                    EngineErrorCategory::Serialization,
                    "encode_host_extension",
                ))?,
                Default::default(),
                None,
            )
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "create_group",
            ))?;
        let epoch = group.current_epoch();
        let staged = self.group_storage.staged_write();
        Self::stage_current_history_secret(&staged, room_id, &group)?;
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        self.hosts.insert(room_id.into(), host);
        self.groups.insert(room_id.into(), group);
        Ok(epoch)
    }

    pub fn add_member(
        &mut self,
        room_id: &str,
        key_package: &[u8],
    ) -> Result<AddMemberOutput, EngineError> {
        self.add_member_with_welcome_metadata(room_id, key_package, None)
    }

    pub fn add_member_with_welcome_metadata(
        &mut self,
        room_id: &str,
        key_package: &[u8],
        welcome_metadata: Option<WelcomeRetryMetadata>,
    ) -> Result<AddMemberOutput, EngineError> {
        self.add_member_internal(room_id, key_package, welcome_metadata, None)
    }

    pub fn add_member_for_invite(
        &mut self,
        room_id: &str,
        key_package: &[u8],
        welcome_metadata: WelcomeRetryMetadata,
        capability_handle: String,
        binding_hash: String,
    ) -> Result<AddMemberOutput, EngineError> {
        if self
            .group_storage
            .invite_receipt(&capability_handle)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_invite_receipt",
            ))?
            .is_some()
        {
            return Err(EngineError::InvalidInput);
        }
        let key_package_hash = welcome_metadata.key_package_hash.clone();
        let response_binding = welcome_metadata.response_binding.clone();
        let response_mac = welcome_metadata.response_mac.clone();
        self.add_member_internal(
            room_id,
            key_package,
            Some(welcome_metadata),
            Some((
                capability_handle,
                binding_hash,
                key_package_hash,
                response_binding,
                response_mac,
            )),
        )
    }

    pub(super) fn add_member_internal(
        &mut self,
        room_id: &str,
        key_package: &[u8],
        welcome_metadata: Option<WelcomeRetryMetadata>,
        receipt: Option<(String, String, String, crate::CapabilityBinding, String)>,
    ) -> Result<AddMemberOutput, EngineError> {
        self.ensure_host(room_id)?;
        self.ensure_application_outbox_drained(room_id)?;
        bounded(key_package)?;
        if let Some((handle, _, _, _, _)) = receipt.as_ref() {
            if self
                .group_storage
                .denied_invite_receipt(handle)
                .map_err(engine_failure(
                    EngineErrorCategory::Storage,
                    "load_denied_invite_receipt",
                ))?
                .is_some()
            {
                return Err(EngineError::InvalidInput);
            }
        }
        let welcome_metadata = welcome_metadata
            .map(OutboxMetadata::Welcome)
            .map(|value| serde_json::to_vec(&value))
            .transpose()
            .map_err(engine_failure(
                EngineErrorCategory::Serialization,
                "encode_welcome_metadata",
            ))?;
        let package = MlsMessage::from_bytes(key_package).map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "decode_key_package",
        ))?;
        if package.cipher_suite() != Some(MLS_CIPHERSUITE) {
            return Err(EngineError::InvalidInput);
        }
        let group_storage = self.group_storage.clone();
        let staged = group_storage.staged_write();
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let output = group
            .commit_builder()
            .add_member(package)
            .map_err(engine_failure(EngineErrorCategory::Protocol, "add_member"))?
            .build()
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "build_add_commit",
            ))?;
        let commit = output.commit_message.to_bytes().map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_add_commit",
        ))?;
        let welcome = output
            .welcome_messages
            .first()
            .ok_or_else(|| {
                engine_failure_without_source(
                    EngineErrorCategory::Internal,
                    "select_welcome_message",
                    "MLS add-member output omitted welcome",
                )
            })?
            .to_bytes()
            .map_err(engine_failure(
                EngineErrorCategory::Serialization,
                "encode_welcome_message",
            ))?;
        let epoch = group.current_epoch() + 1;
        let commit_outbox_id = stage_outbox_with_metadata(
            &staged,
            room_id,
            epoch,
            "add",
            commit.clone(),
            Some(
                serde_json::to_vec(&OutboxMetadata::Commit {
                    parent_epoch: group.current_epoch(),
                })
                .map_err(engine_failure(
                    EngineErrorCategory::Serialization,
                    "encode_commit_metadata",
                ))?,
            ),
        )?;
        let welcome_outbox_id = stage_outbox_with_metadata(
            &staged,
            room_id,
            epoch,
            "welcome",
            welcome.clone(),
            welcome_metadata,
        )?;
        if let Some((
            capability_handle,
            binding_hash,
            key_package_hash,
            response_binding,
            response_mac,
        )) = receipt
        {
            if let Err(cause) = staged.stage_invite_receipt(ConsumedInviteReceipt {
                capability_handle,
                binding_hash,
                key_package_hash,
                epoch,
                commit_outbox_id: commit_outbox_id.clone(),
                welcome_outbox_id: welcome_outbox_id.clone(),
                response_binding,
                response_mac,
            }) {
                return Err(EngineError::operation_failed(
                    EngineErrorCategory::Storage,
                    "stage_invite_receipt",
                    cause,
                ));
            }
        }
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        Ok(AddMemberOutput {
            commit,
            welcome,
            epoch,
            commit_outbox_id,
            welcome_outbox_id,
        })
    }
}
