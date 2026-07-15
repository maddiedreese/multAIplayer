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
mod group_lifecycle;
mod group_queries;
mod host_transfer;
mod invite_admission;
mod membership;
mod messaging;
mod outbound;
mod outbox_lifecycle;
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
}

#[cfg(test)]
mod tests;
