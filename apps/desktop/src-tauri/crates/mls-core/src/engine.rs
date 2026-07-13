use crate::{
    crypto_provider,
    host_rules::{host_extension, validate_host, HostRules},
    validate_credential, AtomicGroupStateStorage, BasicAppCredential, ConsumedInviteReceipt,
    ConsumedJoinReceipt, DeniedInviteReceipt, HostContext, OutboxItem, HOST_CONTEXT_EXTENSION_TYPE,
    MLS_CIPHERSUITE,
};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
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
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExporterCiphertext {
    pub version: u8,
    pub epoch: u64,
    #[serde(with = "canonical_base64")]
    pub nonce: Vec<u8>,
    #[serde(with = "canonical_base64")]
    pub ciphertext: Vec<u8>,
}

mod canonical_base64 {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD.encode(value))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        let decoded = STANDARD.decode(&encoded).map_err(D::Error::custom)?;
        if STANDARD.encode(&decoded) != encoded {
            return Err(D::Error::custom("base64 is not canonical padded encoding"));
        }
        Ok(decoded)
    }
}

type StorageConfig = WithGroupStateStorage<AtomicGroupStateStorage, BaseSqlConfig>;
type BaseAppConfig = WithCryptoProvider<
    AwsLcCryptoProvider,
    WithIdentityProvider<BasicIdentityProvider, StorageConfig>,
>;
type AppConfig = WithMlsRules<HostRules, BaseAppConfig>;
type AppClient = Client<AppConfig>;
type AppGroup = Group<AppConfig>;

const MAX_MESSAGE: usize = 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AddMemberOutput {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
    pub epoch: u64,
    pub commit_outbox_id: String,
    pub welcome_outbox_id: String,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WelcomeRetryMetadata {
    pub invite_id: String,
    pub request_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub key_package_id: String,
    pub key_package_hash: String,
    pub response_binding: crate::CapabilityBinding,
    pub response_mac: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JoinAdmissionMetadata {
    pub invite_id: String,
    pub team_id: String,
    pub room_id: String,
    pub request_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OutboxMetadata {
    Application {
        authenticated_data: Vec<u8>,
    },
    Commit {
        parent_epoch: u64,
    },
    Welcome(WelcomeRetryMetadata),
    HostTransfer(HostTransferAuthorizationPayload),
    InviteResponse {
        binding: crate::CapabilityBinding,
        mac: String,
    },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApplicationOutput {
    pub sender_leaf: u32,
    pub epoch: u64,
    pub authenticated_data: Vec<u8>,
    pub payload: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboundApplication {
    pub message: Vec<u8>,
    pub outbox_id: String,
    pub epoch: u64,
    pub authenticated_data: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationAuthenticatedDataInput {
    pub version: u8,
    pub message_id: String,
    pub team_id: String,
    pub room_id: String,
    pub kind: String,
    pub sender_user_id: String,
    pub sender_device_id: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationAuthenticatedData {
    pub version: u8,
    pub epoch: u64,
    pub message_id: String,
    pub team_id: String,
    pub room_id: String,
    pub kind: String,
    pub sender_user_id: String,
    pub sender_device_id: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboundCommit {
    pub message: Vec<u8>,
    pub outbox_id: String,
    pub parent_epoch: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RosterMember {
    pub leaf: u32,
    pub credential: BasicAppCredential,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostTransferAuthorizationPayload {
    pub version: u8,
    pub room_id: String,
    pub commit_message_id: String,
    pub parent_epoch: u64,
    pub outgoing_host_user_id: String,
    pub outgoing_host_device_id: String,
    pub next_host_user_id: String,
    pub next_host_device_id: String,
    pub next_host_leaf: u32,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum EngineError {
    #[error("invalid MLS input")]
    InvalidInput,
    #[error("MLS operation failed")]
    Mls,
    #[error("group is not open")]
    GroupNotFound,
    #[error("operation requires active host")]
    NotHost,
    #[error("message is not an application message")]
    UnexpectedMessage,
    #[error("MLS_REQUIRES_REJOIN")]
    RequiresRejoin,
}

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
        let secret = crate::generate_device_signing_secret().map_err(|_| EngineError::Mls)?;
        Self::from_signing_secret(credential, secret)
    }

    pub fn from_signing_secret(
        credential: BasicAppCredential,
        secret: Vec<u8>,
    ) -> Result<Self, EngineError> {
        let storage = SqLiteDataStorageEngine::new(MemoryStrategy).map_err(|_| EngineError::Mls)?;
        let connection = MemoryStrategy
            .make_connection()
            .map_err(|_| EngineError::Mls)?;
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
        let connection = strategy.make_connection().map_err(|_| EngineError::Mls)?;
        let storage_strategy = CipheredConnectionStrategy::new(
            FileConnectionStrategy::new(path),
            SqlCipherConfig::new(SqlCipherKey::RawKey(wrapping_key)),
        );
        let storage =
            SqLiteDataStorageEngine::new(storage_strategy).map_err(|_| EngineError::Mls)?;
        storage
            .group_state_storage()
            .map_err(|_| EngineError::Mls)?;
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
        let credential_bytes =
            serde_json::to_vec(&credential).map_err(|_| EngineError::InvalidInput)?;
        validate_credential(&credential_bytes).map_err(|_| EngineError::InvalidInput)?;
        let provider = crypto_provider();
        let suite = provider
            .cipher_suite_provider(MLS_CIPHERSUITE)
            .ok_or(EngineError::Mls)?;
        let secret = SignatureSecretKey::from(secret);
        let public = suite
            .signature_key_derive_public(&secret)
            .map_err(|_| EngineError::Mls)?;
        let identity = SigningIdentity::new(
            BasicCredential::new(credential_bytes).into_credential(),
            public,
        );
        let group_storage = AtomicGroupStateStorage::new(connection);
        let client = ClientBuilder::new_sqlite(storage)
            .map_err(|_| EngineError::Mls)?
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
            .map_err(|_| EngineError::Mls)?;
        let group = self.client.load_group(room_id.as_bytes()).map_err(|_| {
            if stored {
                EngineError::RequiresRejoin
            } else {
                EngineError::GroupNotFound
            }
        })?;
        let host = validate_host(&group.roster(), &group.context().extensions)
            .map_err(|_| EngineError::InvalidInput)?;
        let epoch = group.current_epoch();
        self.hosts.insert(room_id.into(), host);
        self.groups.insert(room_id.into(), group);
        Ok(epoch)
    }

    pub fn forget_corrupt_group(&mut self, room_id: &str) -> Result<(), EngineError> {
        if self.open_group(room_id) != Err(EngineError::RequiresRejoin) {
            return Err(EngineError::InvalidInput);
        }
        self.group_storage
            .delete_corrupt_group_records(room_id)
            .map_err(|_| EngineError::Mls)?;
        self.groups.remove(room_id);
        self.hosts.remove(room_id);
        self.pending_hosts.remove(room_id);
        Ok(())
    }

    pub fn generate_key_package(&self) -> Result<Vec<u8>, EngineError> {
        self.client
            .generate_key_package_message(Default::default(), Default::default(), None)
            .and_then(|message| message.to_bytes())
            .map_err(|_| EngineError::Mls)
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
                host_extension(&host).map_err(|_| EngineError::InvalidInput)?,
                Default::default(),
                None,
            )
            .map_err(|_| EngineError::Mls)?;
        let epoch = group.current_epoch();
        self.stage_current_history_secret(room_id, &group)?;
        if group.write_to_storage().is_err() {
            self.group_storage.clear_staged_history_secret();
            return Err(EngineError::Mls);
        }
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
            .map_err(|_| EngineError::Mls)?
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
                .map_err(|_| EngineError::Mls)?
                .is_some()
            {
                return Err(EngineError::InvalidInput);
            }
        }
        let welcome_metadata = welcome_metadata
            .map(OutboxMetadata::Welcome)
            .map(|value| serde_json::to_vec(&value))
            .transpose()
            .map_err(|_| EngineError::Mls)?;
        let package = MlsMessage::from_bytes(key_package).map_err(|_| EngineError::InvalidInput)?;
        if package.cipher_suite() != Some(MLS_CIPHERSUITE) {
            return Err(EngineError::InvalidInput);
        }
        let group_storage = self.group_storage.clone();
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let output = group
            .commit_builder()
            .add_member(package)
            .map_err(|_| EngineError::Mls)?
            .build()
            .map_err(|_| EngineError::Mls)?;
        let commit = output
            .commit_message
            .to_bytes()
            .map_err(|_| EngineError::Mls)?;
        let welcome = output
            .welcome_messages
            .first()
            .ok_or(EngineError::Mls)?
            .to_bytes()
            .map_err(|_| EngineError::Mls)?;
        let epoch = group.current_epoch() + 1;
        let commit_outbox_id = stage_outbox_with_metadata(
            &group_storage,
            room_id,
            epoch,
            "add",
            commit.clone(),
            Some(
                serde_json::to_vec(&OutboxMetadata::Commit {
                    parent_epoch: group.current_epoch(),
                })
                .map_err(|_| EngineError::Mls)?,
            ),
        )?;
        let welcome_outbox_id = match stage_outbox_with_metadata(
            &group_storage,
            room_id,
            epoch,
            "welcome",
            welcome.clone(),
            welcome_metadata,
        ) {
            Ok(id) => id,
            Err(error) => {
                group_storage.clear_staged_outbox();
                return Err(error);
            }
        };
        if let Some((
            capability_handle,
            binding_hash,
            key_package_hash,
            response_binding,
            response_mac,
        )) = receipt
        {
            if group_storage
                .stage_invite_receipt(ConsumedInviteReceipt {
                    capability_handle,
                    binding_hash,
                    key_package_hash,
                    epoch,
                    commit_outbox_id: commit_outbox_id.clone(),
                    welcome_outbox_id: welcome_outbox_id.clone(),
                    response_binding,
                    response_mac,
                })
                .is_err()
            {
                group_storage.clear_staged_outbox();
                group_storage.clear_staged_invite_receipts();
                return Err(EngineError::Mls);
            }
        }
        if group.write_to_storage().is_err() {
            group_storage.clear_staged_outbox();
            group_storage.clear_staged_invite_receipts();
            return Err(EngineError::Mls);
        }
        Ok(AddMemberOutput {
            commit,
            welcome,
            epoch,
            commit_outbox_id,
            welcome_outbox_id,
        })
    }

    pub fn invite_receipt(
        &self,
        capability_handle: &str,
    ) -> Result<Option<ConsumedInviteReceipt>, EngineError> {
        self.group_storage
            .invite_receipt(capability_handle)
            .map_err(|_| EngineError::Mls)
    }

    pub fn invite_receipt_for_commit(
        &self,
        commit_outbox_id: &str,
    ) -> Result<Option<ConsumedInviteReceipt>, EngineError> {
        self.group_storage
            .invite_receipt_for_commit(commit_outbox_id)
            .map_err(|_| EngineError::Mls)
    }

    pub fn welcome_retry_metadata(
        &self,
        outbox_id: &str,
    ) -> Result<WelcomeRetryMetadata, EngineError> {
        let item = self
            .group_storage
            .outbox_item(outbox_id)
            .map_err(|_| EngineError::Mls)?
            .ok_or(EngineError::InvalidInput)?;
        if item.kind != "welcome" {
            return Err(EngineError::InvalidInput);
        }
        match serde_json::from_slice::<OutboxMetadata>(
            item.metadata.as_deref().ok_or(EngineError::InvalidInput)?,
        )
        .map_err(|_| EngineError::InvalidInput)?
        {
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
            .map_err(|_| EngineError::Mls)?
            .is_some()
            || self
                .group_storage
                .denied_invite_receipt(&capability_handle)
                .map_err(|_| EngineError::Mls)?
                .is_some()
        {
            return Err(EngineError::InvalidInput);
        }
        let room_id = response_binding.room_id.clone();
        let payload = serde_json::to_vec(&OutboxMetadata::InviteResponse {
            binding: response_binding.clone(),
            mac: response_mac.clone(),
        })
        .map_err(|_| EngineError::Mls)?;
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
            .map_err(|_| EngineError::Mls)?;
        Ok(id)
    }

    pub fn denied_invite_response(
        &self,
        capability_handle: &str,
    ) -> Result<Option<(DeniedInviteReceipt, crate::CapabilityBinding, String)>, EngineError> {
        let Some(receipt) = self
            .group_storage
            .denied_invite_receipt(capability_handle)
            .map_err(|_| EngineError::Mls)?
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
            .map_err(|_| EngineError::Mls)?
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
        let message = MlsMessage::from_bytes(welcome).map_err(|_| EngineError::InvalidInput)?;
        if message.cipher_suite() != Some(MLS_CIPHERSUITE) {
            return Err(EngineError::InvalidInput);
        }
        let (mut group, _) = self
            .client
            .join_group(None, &message, None)
            .map_err(|_| EngineError::Mls)?;
        if group.group_id() != room_id.as_bytes() {
            return Err(EngineError::InvalidInput);
        }
        let epoch = group.current_epoch();
        let host = validate_host(&group.roster(), &group.context().extensions)
            .map_err(|_| EngineError::InvalidInput)?;
        self.stage_current_history_secret(room_id, &group)?;
        if let Some((admission, response_hash)) = receipt {
            if self
                .group_storage
                .stage_join_receipt(ConsumedJoinReceipt {
                    invite_id: admission.invite_id,
                    team_id: admission.team_id,
                    room_id: admission.room_id,
                    request_id: admission.request_id,
                    requester_user_id: admission.requester_user_id,
                    requester_device_id: admission.requester_device_id,
                    response_hash,
                    epoch,
                })
                .is_err()
            {
                self.group_storage.clear_staged_join_receipts();
                self.group_storage.clear_staged_history_secret();
                return Err(EngineError::Mls);
            }
        }
        if group.write_to_storage().is_err() {
            self.group_storage.clear_staged_join_receipts();
            self.group_storage.clear_staged_history_secret();
            return Err(EngineError::Mls);
        }
        self.hosts.insert(room_id.into(), host);
        self.groups.insert(room_id.into(), group);
        Ok(epoch)
    }

    pub fn pending_join_admissions(&self) -> Result<Vec<ConsumedJoinReceipt>, EngineError> {
        self.group_storage
            .pending_join_receipts()
            .map_err(|_| EngineError::Mls)
    }

    pub fn complete_join_admission(
        &self,
        room_id: &str,
        request_id: &str,
    ) -> Result<(), EngineError> {
        self.group_storage
            .complete_join_receipt(room_id, request_id)
            .map_err(|_| EngineError::InvalidInput)
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
            .map_err(|_| EngineError::Mls)?
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
        .map_err(|_| EngineError::Mls)?;
        if authenticated_data.len() > 4096 {
            return Err(EngineError::InvalidInput);
        }
        let message = group
            .encrypt_application_message(payload, authenticated_data.clone())
            .and_then(|m| m.to_bytes())
            .map_err(|_| EngineError::Mls)?;
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
                .map_err(|_| EngineError::Mls)?,
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
            .map_err(|_| EngineError::Mls)?
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
        let message = MlsMessage::from_bytes(message).map_err(|_| EngineError::InvalidInput)?;
        let hinted_epoch = message.epoch();
        if let Some(epoch) = hinted_epoch {
            let is_application_echo = self
                .group_storage
                .outbox_for_room_epoch(room_id, epoch)
                .map_err(|_| EngineError::Mls)?
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
            .map_err(|_| EngineError::Mls)?;
        match result {
            ReceivedMessage::ApplicationMessage(value) => {
                let payload = value.data().to_vec();
                group.write_to_storage().map_err(|_| EngineError::Mls)?;
                Ok(Some(ApplicationOutput {
                    sender_leaf: value.sender_index,
                    epoch: hinted_epoch.unwrap_or(group.current_epoch()),
                    authenticated_data: value.authenticated_data,
                    payload,
                }))
            }
            ReceivedMessage::Commit(_) => {
                let next = validate_host(&group.roster(), &group.context().extensions)
                    .map_err(|_| EngineError::InvalidInput)?;
                let secret = history_secret_for_group(group)?;
                self.group_storage
                    .stage_history_secret(room_id, group.current_epoch(), secret)
                    .map_err(|_| EngineError::Mls)?;
                if group.write_to_storage().is_err() {
                    self.group_storage.clear_staged_history_secret();
                    return Err(EngineError::Mls);
                }
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
            .map_err(|_| EngineError::Mls)?
            .build()
            .map_err(|_| EngineError::Mls)?;
        let bytes = output
            .commit_message
            .to_bytes()
            .map_err(|_| EngineError::Mls)?;
        let parent_epoch = group.current_epoch();
        let outbox_id = Self::persist_outbound_with_metadata(
            &group_storage,
            group,
            room_id,
            group.current_epoch() + 1,
            "remove",
            bytes.clone(),
            Some(
                serde_json::to_vec(&OutboxMetadata::Commit { parent_epoch })
                    .map_err(|_| EngineError::Mls)?,
            ),
        )?;
        Ok(OutboundCommit {
            message: bytes,
            outbox_id,
            parent_epoch,
        })
    }

    pub fn transfer_host(
        &mut self,
        room_id: &str,
        next_leaf: u32,
        next_device_id: String,
    ) -> Result<OutboundCommit, EngineError> {
        self.ensure_host(room_id)?;
        self.ensure_application_outbox_drained(room_id)?;
        if next_device_id.is_empty() || next_device_id.len() > 128 {
            return Err(EngineError::InvalidInput);
        }
        let group_storage = self.group_storage.clone();
        let group = self
            .groups
            .get_mut(room_id)
            .ok_or(EngineError::GroupNotFound)?;
        let record = HostContext {
            version: 1,
            host_leaf: next_leaf,
            host_device_id: next_device_id,
        };
        if roster_credential(group, next_leaf)?.device_id != record.host_device_id {
            return Err(EngineError::InvalidInput);
        }
        let aad = serde_json::to_vec(&record).map_err(|_| EngineError::InvalidInput)?;
        let output = group
            .commit_builder()
            .set_group_context_ext(host_extension(&record).map_err(|_| EngineError::InvalidInput)?)
            .map_err(|_| EngineError::Mls)?
            .authenticated_data(aad)
            .build()
            .map_err(|_| EngineError::Mls)?;
        let bytes = output
            .commit_message
            .to_bytes()
            .map_err(|_| EngineError::Mls)?;
        let commit_message_id = format!("{:x}", Sha256::digest(&bytes));
        let next = roster_credential(group, next_leaf)?;
        let parent_epoch = group.current_epoch();
        let authorization = HostTransferAuthorizationPayload {
            version: 1,
            room_id: room_id.to_owned(),
            commit_message_id: commit_message_id.clone(),
            parent_epoch: group.current_epoch(),
            outgoing_host_user_id: self.self_user_id.clone(),
            outgoing_host_device_id: self.self_device_id.clone(),
            next_host_user_id: next.github_user_id,
            next_host_device_id: record.host_device_id.clone(),
            next_host_leaf: next_leaf,
        };
        group_storage
            .stage_outbox(OutboxItem {
                id: commit_message_id.clone(),
                room_id: room_id.to_owned(),
                epoch: group.current_epoch() + 1,
                kind: "handoff".to_owned(),
                payload: bytes.clone(),
                metadata: Some(
                    serde_json::to_vec(&OutboxMetadata::HostTransfer(authorization))
                        .map_err(|_| EngineError::Mls)?,
                ),
            })
            .map_err(|_| EngineError::Mls)?;
        if group.write_to_storage().is_err() {
            group_storage.clear_staged_outbox();
            return Err(EngineError::Mls);
        }
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
            .map_err(|_| EngineError::Mls)?
            .ok_or(EngineError::InvalidInput)?;
        if item.room_id != room_id || item.kind != "handoff" {
            return Err(EngineError::InvalidInput);
        }
        let metadata: OutboxMetadata =
            serde_json::from_slice(item.metadata.as_deref().ok_or(EngineError::InvalidInput)?)
                .map_err(|_| EngineError::InvalidInput)?;
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
            .map_err(|_| EngineError::Mls)?
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
                .map_err(|_| EngineError::Mls)?;
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
        group.apply_pending_commit().map_err(|_| EngineError::Mls)?;
        let secret = history_secret_for_group(group)?;
        self.group_storage
            .stage_history_secret(room_id, group.current_epoch(), secret)
            .map_err(|_| EngineError::Mls)?;
        self.group_storage
            .stage_outbox_delete(expected_message_id)
            .map_err(|_| EngineError::Mls)?;
        if group.write_to_storage().is_err() {
            self.group_storage.clear_staged_history_secret();
            self.group_storage.clear_staged_outbox_deletes();
            return Err(EngineError::Mls);
        }
        self.pending_hosts.remove(room_id);
        let host = validate_host(&group.roster(), &group.context().extensions)
            .map_err(|_| EngineError::InvalidInput)?;
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
            .map_err(|_| EngineError::Mls)?
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
        self.group_storage
            .stage_outbox_delete(expected_message_id)
            .map_err(|_| EngineError::Mls)?;
        if item.kind == "add" {
            if let Some(receipt) = self
                .group_storage
                .invite_receipt_for_commit(expected_message_id)
                .map_err(|_| EngineError::Mls)?
            {
                self.group_storage
                    .stage_invite_receipt_delete(&receipt.capability_handle)
                    .map_err(|_| EngineError::Mls)?;
            }
            for related in self
                .group_storage
                .outbox_for_room_epoch(room_id, item.epoch)
                .map_err(|_| EngineError::Mls)?
            {
                if related.kind == "welcome" {
                    self.group_storage
                        .stage_outbox_delete(&related.id)
                        .map_err(|_| EngineError::Mls)?;
                }
            }
        }
        if group.write_to_storage().is_err() {
            self.group_storage.clear_staged_outbox_deletes();
            self.group_storage.clear_staged_invite_receipt_delete();
            return Err(EngineError::Mls);
        }
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
            .map_err(|_| EngineError::Mls)?
            .ok_or(EngineError::InvalidInput)?;
        if item.room_id != room_id || item.kind != "application" {
            return Err(EngineError::InvalidInput);
        }
        self.group_storage
            .delete_outbox(expected_message_id)
            .map_err(|_| EngineError::Mls)?;
        self.current_epoch(room_id)
    }

    pub fn export_blob_key(&self, room_id: &str, blob_id: &[u8]) -> Result<Vec<u8>, EngineError> {
        if blob_id.is_empty() || blob_id.len() > 128 {
            return Err(EngineError::InvalidInput);
        }
        self.groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .export_secret(b"multaiplayer blob v1", blob_id, 32)
            .map(|secret| secret.as_bytes().to_vec())
            .map_err(|_| EngineError::Mls)
    }

    pub fn encrypt_blob(
        &self,
        room_id: &str,
        blob_id: &[u8],
        plaintext: &[u8],
    ) -> Result<ExporterCiphertext, EngineError> {
        bounded(plaintext)?;
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let key = self.export_blob_key(room_id, blob_id)?;
        self.group_storage
            .put_blob_key(room_id, blob_id, epoch, &key)
            .map_err(|_| EngineError::Mls)?;
        seal_exporter(&key, epoch, blob_aad(room_id, blob_id, epoch), plaintext)
    }
    pub fn prepare_blob(&self, room_id: &str, blob_id: &[u8]) -> Result<u64, EngineError> {
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let key = self.export_blob_key(room_id, blob_id)?;
        self.group_storage
            .put_blob_key(room_id, blob_id, epoch, &key)
            .map_err(|_| EngineError::Mls)?;
        Ok(epoch)
    }
    pub fn encrypt_history(
        &self,
        room_id: &str,
        plaintext: &[u8],
    ) -> Result<ExporterCiphertext, EngineError> {
        bounded(plaintext)?;
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let key = self
            .group_storage
            .history_secret(room_id, epoch)
            .map_err(|_| EngineError::Mls)?
            .ok_or(EngineError::GroupNotFound)?;
        seal_exporter(&key, epoch, history_aad(room_id, epoch), plaintext)
    }
    pub fn decrypt_history(
        &self,
        room_id: &str,
        value: &ExporterCiphertext,
    ) -> Result<Vec<u8>, EngineError> {
        if value.version != 1 || !self.groups.contains_key(room_id) {
            return Err(EngineError::InvalidInput);
        }
        let key = self
            .group_storage
            .history_secret(room_id, value.epoch)
            .map_err(|_| EngineError::Mls)?
            .ok_or(EngineError::GroupNotFound)?;
        open_exporter(&key, history_aad(room_id, value.epoch), value)
    }
    pub fn set_history_retention(
        &self,
        room_id: &str,
        retention_days: u16,
    ) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .set_history_retention(room_id, retention_days)
            .map_err(|_| EngineError::Mls)
    }

    pub fn history_retention_days(&self, room_id: &str) -> Result<u16, EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .history_retention_days(room_id)
            .map_err(|_| EngineError::Mls)
    }

    pub fn forget_history_epoch(&self, room_id: &str, epoch: u64) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .delete_history_epoch(room_id, epoch)
            .map_err(|_| EngineError::Mls)
    }
    pub fn forget_history(&self, room_id: &str) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .delete_history_records(room_id)
            .map_err(|_| EngineError::Mls)
    }

    pub fn prune_expired_material(&self, room_id: &str) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .prune_expired_material(room_id)
            .map_err(|_| EngineError::Mls)
    }
    pub fn decrypt_blob(
        &self,
        room_id: &str,
        blob_id: &[u8],
        value: &ExporterCiphertext,
    ) -> Result<Vec<u8>, EngineError> {
        if value.version != 1 || !self.groups.contains_key(room_id) {
            return Err(EngineError::InvalidInput);
        }
        let key = self
            .group_storage
            .blob_key(room_id, blob_id, value.epoch)
            .map_err(|_| EngineError::Mls)?
            .ok_or(EngineError::GroupNotFound)?;
        open_exporter(&key, blob_aad(room_id, blob_id, value.epoch), value)
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
            .map_err(|_| EngineError::Mls)?
        {
            Err(EngineError::InvalidInput)
        } else {
            Ok(())
        }
    }

    fn stage_current_history_secret(
        &self,
        room_id: &str,
        group: &AppGroup,
    ) -> Result<(), EngineError> {
        self.group_storage
            .stage_history_secret(
                room_id,
                group.current_epoch(),
                history_secret_for_group(group)?,
            )
            .map_err(|_| EngineError::Mls)
    }

    fn persist_outbound_with_metadata(
        storage: &AtomicGroupStateStorage,
        group: &mut AppGroup,
        room_id: &str,
        epoch: u64,
        kind: &str,
        payload: Vec<u8>,
        metadata: Option<Vec<u8>>,
    ) -> Result<String, EngineError> {
        let id = format!("{:x}", Sha256::digest(&payload));
        Self::persist_outbound_with_id(storage, group, room_id, epoch, kind, payload, metadata, id)
    }

    #[allow(clippy::too_many_arguments)]
    fn persist_outbound_with_id(
        storage: &AtomicGroupStateStorage,
        group: &mut AppGroup,
        room_id: &str,
        epoch: u64,
        kind: &str,
        payload: Vec<u8>,
        metadata: Option<Vec<u8>>,
        id: String,
    ) -> Result<String, EngineError> {
        storage
            .stage_outbox(OutboxItem {
                id: id.clone(),
                room_id: room_id.to_owned(),
                epoch,
                kind: kind.to_owned(),
                payload,
                metadata,
            })
            .map_err(|_| EngineError::Mls)?;
        if group.write_to_storage().is_err() {
            storage.clear_staged_outbox();
            return Err(EngineError::Mls);
        }
        Ok(id)
    }
}

fn stage_outbox_with_metadata(
    storage: &AtomicGroupStateStorage,
    room_id: &str,
    epoch: u64,
    kind: &str,
    payload: Vec<u8>,
    metadata: Option<Vec<u8>>,
) -> Result<String, EngineError> {
    let id = format!("{:x}", Sha256::digest(&payload));
    storage
        .stage_outbox(OutboxItem {
            id: id.clone(),
            room_id: room_id.to_owned(),
            epoch,
            kind: kind.to_owned(),
            payload,
            metadata,
        })
        .map_err(|_| EngineError::Mls)?;
    Ok(id)
}

fn history_secret_for_group(group: &AppGroup) -> Result<Vec<u8>, EngineError> {
    group
        .export_secret(b"multaiplayer history v1", b"", 32)
        .map(|secret| secret.as_bytes().to_vec())
        .map_err(|_| EngineError::Mls)
}

fn initialize_group_schema(connection: &rusqlite::Connection) -> Result<(), EngineError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS mls_group (group_id BLOB PRIMARY KEY, snapshot BLOB NOT NULL) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS epoch (group_id BLOB, epoch_id INTEGER, epoch_data BLOB NOT NULL, PRIMARY KEY(group_id, epoch_id)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS kvs (key TEXT PRIMARY KEY, value BLOB NOT NULL) WITHOUT ROWID;",
        )
        .map_err(|_| EngineError::Mls)
}

fn member_credential(member: &mls_rs::group::Member) -> Result<BasicAppCredential, EngineError> {
    let basic = member
        .signing_identity()
        .credential
        .as_basic()
        .ok_or(EngineError::InvalidInput)?;
    validate_credential(basic.identifier()).map_err(|_| EngineError::InvalidInput)?;
    serde_json::from_slice(basic.identifier()).map_err(|_| EngineError::InvalidInput)
}

fn roster_credential(group: &AppGroup, leaf: u32) -> Result<BasicAppCredential, EngineError> {
    let member = group
        .roster()
        .member_with_index(leaf)
        .map_err(|_| EngineError::InvalidInput)?;
    member_credential(&member)
}

fn bounded(bytes: &[u8]) -> Result<(), EngineError> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE {
        Err(EngineError::InvalidInput)
    } else {
        Ok(())
    }
}
fn valid_room(value: &str) -> Result<(), EngineError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        Err(EngineError::InvalidInput)
    } else {
        Ok(())
    }
}

fn blob_aad(room: &str, blob: &[u8], epoch: u64) -> Vec<u8> {
    let mut out = b"multaiplayer:blob:v1\0".to_vec();
    out.extend_from_slice(&(room.len() as u16).to_be_bytes());
    out.extend_from_slice(room.as_bytes());
    out.extend_from_slice(&(blob.len() as u16).to_be_bytes());
    out.extend_from_slice(blob);
    out.extend_from_slice(&epoch.to_be_bytes());
    out
}
fn history_aad(room: &str, epoch: u64) -> Vec<u8> {
    let mut out = b"multaiplayer:history:v1\0".to_vec();
    out.extend_from_slice(&(room.len() as u16).to_be_bytes());
    out.extend_from_slice(room.as_bytes());
    out.extend_from_slice(&epoch.to_be_bytes());
    out
}
fn seal_exporter(
    key: &[u8],
    epoch: u64,
    aad: Vec<u8>,
    plaintext: &[u8],
) -> Result<ExporterCiphertext, EngineError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| EngineError::Mls)?;
    let mut nonce = vec![0u8; 12];
    rand::fill(&mut nonce[..]);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| EngineError::Mls)?;
    Ok(ExporterCiphertext {
        version: 1,
        epoch,
        nonce,
        ciphertext,
    })
}
fn open_exporter(
    key: &[u8],
    aad: Vec<u8>,
    value: &ExporterCiphertext,
) -> Result<Vec<u8>, EngineError> {
    if value.nonce.len() != 12 {
        return Err(EngineError::InvalidInput);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| EngineError::Mls)?;
    cipher
        .decrypt(
            Nonce::from_slice(&value.nonce),
            Payload {
                msg: &value.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| EngineError::Mls)
}

fn valid_authenticated_text(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.bytes().all(|byte| !byte.is_ascii_control())
}

#[cfg(test)]
mod serde_tests {
    use super::{EngineError, ExporterCiphertext, MlsEngine};
    use crate::BasicAppCredential;

    #[test]
    fn exporter_ciphertext_uses_canonical_padded_base64() {
        let value = ExporterCiphertext {
            version: 1,
            epoch: 4,
            nonce: vec![0; 12],
            ciphertext: vec![1, 2],
        };
        let encoded = serde_json::to_value(&value).unwrap();
        assert_eq!(encoded["nonce"], "AAAAAAAAAAAAAAAA");
        assert_eq!(encoded["ciphertext"], "AQI=");
        assert_eq!(
            serde_json::from_value::<ExporterCiphertext>(encoded).unwrap(),
            value
        );
        assert!(serde_json::from_str::<ExporterCiphertext>(
            r#"{"version":1,"epoch":4,"nonce":"AAAAAAAAAAAAAAAA","ciphertext":"AQI"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ExporterCiphertext>(
            r#"{"version":1,"epoch":4,"nonce":[],"ciphertext":[]}"#
        )
        .is_err());
    }

    #[test]
    fn corrupt_serialized_group_requires_rejoin_but_missing_group_does_not() {
        let mut engine = MlsEngine::new(BasicAppCredential {
            github_user_id: "1".into(),
            device_id: "device".into(),
        })
        .unwrap();
        engine.create_group("corrupt-room").unwrap();
        engine.groups.remove("corrupt-room");
        engine.hosts.remove("corrupt-room");
        engine
            .group_storage
            .corrupt_group_snapshot_for_test(b"corrupt-room");
        assert_eq!(
            engine.open_group("corrupt-room"),
            Err(EngineError::RequiresRejoin)
        );
        assert_eq!(
            engine.open_group("missing-room"),
            Err(EngineError::GroupNotFound)
        );
        engine.forget_corrupt_group("corrupt-room").unwrap();
        assert_eq!(
            engine.open_group("corrupt-room"),
            Err(EngineError::GroupNotFound)
        );
        assert!(engine.forget_corrupt_group("missing-room").is_err());

        let package = engine.generate_key_package().unwrap();
        let mut fresh_host = MlsEngine::new(BasicAppCredential {
            github_user_id: "2".into(),
            device_id: "fresh-host".into(),
        })
        .unwrap();
        fresh_host.create_group("corrupt-room").unwrap();
        let add = fresh_host.add_member("corrupt-room", &package).unwrap();
        fresh_host
            .publish_succeeded("corrupt-room", &add.commit_outbox_id)
            .unwrap();
        assert_eq!(engine.join_welcome("corrupt-room", &add.welcome), Ok(1));
    }
}
