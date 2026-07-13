use crate::storage::StagedWriteGuard;
use crate::{
    crypto_provider,
    host_rules::{host_extension, validate_host, HostRules},
    validate_credential, AtomicGroupStateStorage, BasicAppCredential, ConsumedInviteReceipt,
    ConsumedJoinReceipt, DeniedInviteReceipt, HostContext, OutboxItem, HOST_CONTEXT_EXTENSION_TYPE,
    MLS_CIPHERSUITE,
};
use exporter::history_secret_for_group;
use mls_rs::{
    client_builder::{
        BaseSqlConfig, ClientBuilder, WithCryptoProvider, WithGroupStateStorage,
        WithIdentityProvider, WithMlsRules,
    },
    crypto::SignatureSecretKey,
    extension::ExtensionType,
    group::{Group, ReceivedMessage},
    identity::{
        basic::{BasicCredential, BasicIdentityProvider},
        SigningIdentity,
    },
    CipherSuiteProvider, Client, CryptoProvider, MlsMessage,
};
use mls_rs_crypto_awslc::AwsLcCryptoProvider;
use mls_rs_provider_sqlite::{
    connection_strategy::{
        CipheredConnectionStrategy, ConnectionStrategy, FileConnectionStrategy, MemoryStrategy,
        SqlCipherConfig, SqlCipherKey,
    },
    SqLiteDataStorageEngine,
};
use outbound::stage_outbox_with_metadata;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use validation::{
    bounded, initialize_group_schema, member_credential, roster_credential,
    valid_authenticated_text, valid_room,
};

mod error;
mod exporter;
mod host_transfer;
mod invite_admission;
mod outbound;
mod types;
mod validation;

use error::{engine_failure, engine_failure_without_source};
pub use error::{EngineError, EngineErrorCategory};
pub use types::*;

type StorageConfig = WithGroupStateStorage<AtomicGroupStateStorage, BaseSqlConfig>;
type BaseAppConfig = WithCryptoProvider<
    AwsLcCryptoProvider,
    WithIdentityProvider<BasicIdentityProvider, StorageConfig>,
>;
type AppConfig = WithMlsRules<HostRules, BaseAppConfig>;
type AppClient = Client<AppConfig>;
type AppGroup = Group<AppConfig>;

const MAX_MESSAGE: usize = 1024 * 1024;

pub struct MlsEngine {
    client: AppClient,
    groups: HashMap<String, AppGroup>,
    hosts: HashMap<String, HostContext>,
    pending_hosts: HashMap<String, HostContext>,
    self_device_id: String,
    self_user_id: String,
    group_storage: AtomicGroupStateStorage,
}

impl MlsEngine {
    pub fn new(credential: BasicAppCredential) -> Result<Self, EngineError> {
        let secret = crate::generate_device_signing_secret().map_err(engine_failure(
            EngineErrorCategory::Crypto,
            "generate_signing_secret",
        ))?;
        Self::from_signing_secret(credential, secret)
    }

    pub fn from_signing_secret(
        credential: BasicAppCredential,
        secret: Vec<u8>,
    ) -> Result<Self, EngineError> {
        let storage = SqLiteDataStorageEngine::new(MemoryStrategy).map_err(engine_failure(
            EngineErrorCategory::Storage,
            "open_memory_store",
        ))?;
        let connection = MemoryStrategy.make_connection().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "open_memory_connection",
        ))?;
        initialize_group_schema(&connection)?;
        Self::from_storage(credential, secret, storage, connection)
    }

    pub fn open_persistent(
        credential: BasicAppCredential,
        secret: Vec<u8>,
        path: &Path,
        wrapping_key: [u8; 32],
    ) -> Result<Self, EngineError> {
        let strategy = CipheredConnectionStrategy::new(
            FileConnectionStrategy::new(path),
            SqlCipherConfig::new(SqlCipherKey::RawKey(wrapping_key)),
        );
        let connection = strategy.make_connection().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "open_persistent_connection",
        ))?;
        let storage_strategy = CipheredConnectionStrategy::new(
            FileConnectionStrategy::new(path),
            SqlCipherConfig::new(SqlCipherKey::RawKey(wrapping_key)),
        );
        let storage = SqLiteDataStorageEngine::new(storage_strategy).map_err(engine_failure(
            EngineErrorCategory::Storage,
            "open_persistent_store",
        ))?;
        storage.group_state_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "initialize_group_storage",
        ))?;
        Self::from_storage(credential, secret, storage, connection)
    }

    fn from_storage<CS: ConnectionStrategy>(
        credential: BasicAppCredential,
        secret: Vec<u8>,
        storage: SqLiteDataStorageEngine<CS>,
        connection: rusqlite::Connection,
    ) -> Result<Self, EngineError> {
        if secret.is_empty() || secret.len() > 256 {
            return Err(EngineError::InvalidInput);
        }
        let credential_bytes = serde_json::to_vec(&credential).map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_local_credential",
        ))?;
        validate_credential(&credential_bytes).map_err(engine_failure(
            EngineErrorCategory::Protocol,
            "validate_local_credential",
        ))?;
        let provider = crypto_provider();
        let suite = provider
            .cipher_suite_provider(MLS_CIPHERSUITE)
            .ok_or_else(|| {
                engine_failure_without_source(
                    EngineErrorCategory::Internal,
                    "select_cipher_suite",
                    "configured cipher suite unavailable",
                )
            })?;
        let secret = SignatureSecretKey::from(secret);
        let public = suite
            .signature_key_derive_public(&secret)
            .map_err(engine_failure(
                EngineErrorCategory::Crypto,
                "derive_signature_public_key",
            ))?;
        let identity = SigningIdentity::new(
            BasicCredential::new(credential_bytes).into_credential(),
            public,
        );
        let group_storage = AtomicGroupStateStorage::new(connection);
        let client = ClientBuilder::new_sqlite(storage)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "build_mls_client",
            ))?
            .group_state_storage(group_storage.clone())
            .identity_provider(BasicIdentityProvider::new())
            .crypto_provider(provider)
            .extension_type(ExtensionType::new(HOST_CONTEXT_EXTENSION_TYPE))
            .mls_rules(HostRules)
            .signing_identity(identity, secret, MLS_CIPHERSUITE)
            .build();
        Ok(Self {
            client,
            groups: HashMap::new(),
            hosts: HashMap::new(),
            pending_hosts: HashMap::new(),
            self_device_id: credential.device_id,
            self_user_id: credential.github_user_id,
            group_storage,
        })
    }

    pub fn open_group(&mut self, room_id: &str) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        let stored = self
            .group_storage
            .has_group_snapshot(room_id.as_bytes())
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "check_group_snapshot",
            ))?;
        let group = self
            .client
            .load_group(room_id.as_bytes())
            .map_err(|cause| {
                if stored {
                    EngineError::requires_rejoin("load_group", cause)
                } else {
                    EngineError::GroupNotFound
                }
            })?;
        let host =
            validate_host(&group.roster(), &group.context().extensions).map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "validate_stored_host_context",
            ))?;
        let epoch = group.current_epoch();
        self.hosts.insert(room_id.into(), host);
        self.groups.insert(room_id.into(), group);
        Ok(epoch)
    }

    pub fn forget_corrupt_group(&mut self, room_id: &str) -> Result<(), EngineError> {
        if !matches!(self.open_group(room_id), Err(error) if error.is_requires_rejoin()) {
            return Err(EngineError::InvalidInput);
        }
        self.group_storage
            .delete_corrupt_group_records(room_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "delete_corrupt_group",
            ))?;
        self.groups.remove(room_id);
        self.hosts.remove(room_id);
        self.pending_hosts.remove(room_id);
        Ok(())
    }

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
            version: 1,
            host_leaf: 0,
            host_device_id: self.self_device_id.clone(),
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

    fn add_member_internal(
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

    pub fn roster(&self, room_id: &str) -> Result<Vec<RosterMember>, EngineError> {
        self.groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .roster()
            .members_iter()
            .map(|member| {
                Ok(RosterMember {
                    leaf: member.index,
                    credential: member_credential(&member)?,
                })
            })
            .collect()
    }

    pub fn self_leaf(&self, room_id: &str) -> Result<u32, EngineError> {
        Ok(self
            .groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .current_member_index())
    }

    pub fn current_epoch(&self, room_id: &str) -> Result<u64, EngineError> {
        Ok(self
            .groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .current_epoch())
    }

    fn ensure_host(&self, room_id: &str) -> Result<(), EngineError> {
        let host = self.hosts.get(room_id).ok_or(EngineError::NotHost)?;
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        if host.host_device_id != self.self_device_id
            || group.current_member_index() != host.host_leaf
        {
            return Err(EngineError::NotHost);
        }
        Ok(())
    }

    fn ensure_application_outbox_drained(&self, room_id: &str) -> Result<(), EngineError> {
        if self
            .group_storage
            .has_room_outbox_kind(room_id, "application")
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "check_application_outbox",
            ))?
        {
            Err(EngineError::InvalidInput)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests;
