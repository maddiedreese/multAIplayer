#![deny(unsafe_code)]
#![cfg_attr(not(test), deny(clippy::expect_used, clippy::unwrap_used))]

mod device_auth;
mod engine;
mod host_rules;
mod hpke_seal;
mod invite_capability;
mod policy;
mod storage;
mod validator;

pub use device_auth::{generate_device_signing_secret, DeviceAuthSignature, DeviceAuthSigner};
pub use engine::{
    AddMemberOutput, ApplicationAuthenticatedData, ApplicationAuthenticatedDataInput,
    ApplicationOutput, EngineError, EngineErrorCategory, ExporterCiphertext,
    HostTransferAuthorizationPayload, JoinAdmissionMetadata, MlsEngine, OutboundApplication,
    OutboundCommit, OutboxMetadata, RosterMember, WelcomeRetryMetadata,
};
pub use hpke_seal::{generate_hpke_key_pair, open, seal, HpkeKeyPair, SealedPayload};
pub use invite_capability::{
    derive_capability_verifier, encode_capability_binding, issue_capability, mac_binding,
    mac_response_binding, verify_request_binding, verify_response_binding, CapabilityBinding,
    IssuedCapability,
};
pub use policy::{
    validate_credential, validate_host_commit, validate_pinned_suite, BasicAppCredential,
    HostContext, HOST_CONTEXT_EXTENSION_TYPE, MLS_CIPHERSUITE, MLS_CIPHERSUITE_ID,
};
pub use storage::{
    AtomicGroupStateStorage, ConsumedInviteReceipt, ConsumedJoinReceipt, DeniedInviteReceipt,
    EncryptedStore, OutboxItem, StoreError,
};
pub use validator::{validate_key_package_upload, KeyPackageUpload, ValidatedKeyPackage};

use mls_rs_crypto_awslc::AwsLcCryptoProvider;

/// The only crypto provider construction allowed by the application. Restricting the
/// provider itself prevents accidental ciphersuite negotiation in higher layers.
pub fn crypto_provider() -> AwsLcCryptoProvider {
    AwsLcCryptoProvider::with_enabled_cipher_suites(vec![MLS_CIPHERSUITE])
}
