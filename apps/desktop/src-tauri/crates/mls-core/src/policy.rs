use mls_rs::CipherSuite;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MLS_CIPHERSUITE: CipherSuite = CipherSuite::P256_AES128;
pub const MLS_CIPHERSUITE_ID: u16 = 2;
pub const HOST_CONTEXT_EXTENSION_TYPE: u16 = 0xff01;

const MAX_ID_LEN: usize = 128;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BasicAppCredential {
    pub github_user_id: String,
    pub device_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostContext {
    pub version: u8,
    pub host_leaf: u32,
    pub host_device_id: String,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum PolicyError {
    #[error("MLS ciphersuite is not pinned suite 2")]
    UnpinnedCiphersuite,
    #[error("MLS credential is malformed or out of bounds")]
    InvalidCredential,
    #[error("host context is malformed or out of bounds")]
    InvalidHostContext,
    #[error("commit sender is not the active host")]
    NonHostCommit,
}

pub fn validate_pinned_suite(suite: u16) -> Result<(), PolicyError> {
    (suite == MLS_CIPHERSUITE_ID)
        .then_some(())
        .ok_or(PolicyError::UnpinnedCiphersuite)
}

pub fn validate_credential(bytes: &[u8]) -> Result<BasicAppCredential, PolicyError> {
    if bytes.len() > 512 {
        return Err(PolicyError::InvalidCredential);
    }
    let value: BasicAppCredential =
        serde_json::from_slice(bytes).map_err(|_| PolicyError::InvalidCredential)?;
    if !valid_id(&value.github_user_id) || !valid_id(&value.device_id) {
        return Err(PolicyError::InvalidCredential);
    }
    Ok(value)
}

pub fn validate_host_commit(sender_leaf: u32, context: &HostContext) -> Result<(), PolicyError> {
    if context.version != 1 || !valid_id(&context.host_device_id) {
        return Err(PolicyError::InvalidHostContext);
    }
    (sender_leaf == context.host_leaf)
        .then_some(())
        .ok_or(PolicyError::NonHostCommit)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_LEN
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suite_is_pinned() {
        assert_eq!(validate_pinned_suite(2), Ok(()));
        assert_eq!(
            validate_pinned_suite(1),
            Err(PolicyError::UnpinnedCiphersuite)
        );
    }

    #[test]
    fn credentials_are_canonical_and_bounded() {
        let good = br#"{"github_user_id":"42","device_id":"mac_1"}"#;
        assert_eq!(validate_credential(good).unwrap().device_id, "mac_1");
        assert!(validate_credential(br#"{"github_user_id":"42","device_id":"mac 1"}"#).is_err());
        assert!(
            validate_credential(br#"{"github_user_id":"github:42","device_id":"mac_1"}"#).is_ok()
        );
        assert!(
            validate_credential(br#"{"github_user_id":"42","device_id":"mac","extra":1}"#).is_err()
        );
    }

    #[test]
    fn only_current_host_leaf_can_commit() {
        let context = HostContext {
            version: 1,
            host_leaf: 7,
            host_device_id: "mac-1".into(),
        };
        assert_eq!(validate_host_commit(7, &context), Ok(()));
        assert_eq!(
            validate_host_commit(8, &context),
            Err(PolicyError::NonHostCommit)
        );
    }
}
