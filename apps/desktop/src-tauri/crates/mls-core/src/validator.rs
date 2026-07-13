use crate::{crypto_provider, validate_credential, MLS_CIPHERSUITE};
use base64::{engine::general_purpose::STANDARD, Engine};
use mls_rs::{external_client::ExternalClient, identity::basic::BasicIdentityProvider, MlsMessage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MAX_KEY_PACKAGE_B64: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyPackageUpload {
    pub key_package: String,
    pub uploader_github_user_id: String,
    pub uploader_device_id: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct ValidatedKeyPackage {
    pub github_user_id: String,
    pub device_id: String,
    pub ciphersuite: u16,
    pub signature_key_fingerprint: String,
    pub signature_public_key: String,
}

#[derive(Debug, Error)]
pub enum KeyPackageValidationError {
    #[error("key package upload is malformed or oversized")]
    InvalidInput,
    #[error("key package is not a valid pinned-suite MLS KeyPackage")]
    InvalidKeyPackage,
    #[error("KeyPackage credential does not match authenticated uploader")]
    CredentialMismatch,
}

pub fn validate_key_package_upload(
    input: &KeyPackageUpload,
) -> Result<ValidatedKeyPackage, KeyPackageValidationError> {
    if input.key_package.is_empty() || input.key_package.len() > MAX_KEY_PACKAGE_B64 {
        return Err(KeyPackageValidationError::InvalidInput);
    }
    let bytes = STANDARD
        .decode(&input.key_package)
        .map_err(|_| KeyPackageValidationError::InvalidInput)?;
    let message =
        MlsMessage::from_bytes(&bytes).map_err(|_| KeyPackageValidationError::InvalidKeyPackage)?;
    if message.cipher_suite() != Some(MLS_CIPHERSUITE) {
        return Err(KeyPackageValidationError::InvalidKeyPackage);
    }
    let validator = ExternalClient::builder()
        .crypto_provider(crypto_provider())
        .identity_provider(BasicIdentityProvider::new())
        .build();
    let package = validator
        .validate_key_package(message, None)
        .map_err(|_| KeyPackageValidationError::InvalidKeyPackage)?;
    let basic = package
        .signing_identity()
        .credential
        .as_basic()
        .ok_or(KeyPackageValidationError::InvalidKeyPackage)?;
    let credential = validate_credential(basic.identifier())
        .map_err(|_| KeyPackageValidationError::InvalidKeyPackage)?;
    if credential.github_user_id != input.uploader_github_user_id
        || credential.device_id != input.uploader_device_id
    {
        return Err(KeyPackageValidationError::CredentialMismatch);
    }
    let signature_key = package.signing_identity().signature_key.as_ref();
    const SPKI_PREFIX: &[u8] = &[
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    if signature_key.len() != 65 {
        return Err(KeyPackageValidationError::InvalidKeyPackage);
    }
    let mut spki = SPKI_PREFIX.to_vec();
    spki.extend_from_slice(signature_key);
    let fingerprint = Sha256::digest(&spki);
    Ok(ValidatedKeyPackage {
        github_user_id: credential.github_user_id,
        device_id: credential.device_id,
        ciphersuite: 2,
        signature_key_fingerprint: format!(
            "sha256:{}",
            fingerprint
                .chunks(2)
                .map(|chunk| chunk
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>())
                .collect::<Vec<_>>()
                .join(":")
        ),
        signature_public_key: STANDARD.encode(spki),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mls_rs::{
        identity::{
            basic::{BasicCredential, BasicIdentityProvider},
            SigningIdentity,
        },
        CipherSuiteProvider, Client, CryptoProvider,
    };

    fn upload() -> KeyPackageUpload {
        let provider = crypto_provider();
        let suite = provider.cipher_suite_provider(MLS_CIPHERSUITE).unwrap();
        let (secret, public) = suite.signature_key_generate().unwrap();
        let credential = serde_json::to_vec(&crate::BasicAppCredential {
            github_user_id: "42".into(),
            device_id: "mac-1".into(),
        })
        .unwrap();
        let identity =
            SigningIdentity::new(BasicCredential::new(credential).into_credential(), public);
        let client = Client::builder()
            .identity_provider(BasicIdentityProvider::new())
            .crypto_provider(provider)
            .signing_identity(identity, secret, MLS_CIPHERSUITE)
            .build();
        let message = client
            .generate_key_package_message(Default::default(), Default::default(), None)
            .unwrap();
        KeyPackageUpload {
            key_package: STANDARD.encode(message.to_bytes().unwrap()),
            uploader_github_user_id: "42".into(),
            uploader_device_id: "mac-1".into(),
        }
    }

    #[test]
    fn validates_signature_suite_and_uploader_binding() {
        let input = upload();
        let result = validate_key_package_upload(&input).unwrap();
        assert_eq!(result.device_id, "mac-1");
        assert_eq!(result.ciphersuite, 2);
        assert_eq!(result.signature_key_fingerprint.len(), 86);
        assert!(result.signature_key_fingerprint.starts_with("sha256:"));
    }

    #[test]
    fn rejects_authenticated_uploader_mismatch_and_tampering() {
        let mut mismatch = upload();
        mismatch.uploader_device_id = "mac-2".into();
        assert!(matches!(
            validate_key_package_upload(&mismatch),
            Err(KeyPackageValidationError::CredentialMismatch)
        ));
        let mut tampered = upload();
        let mut bytes = STANDARD.decode(&tampered.key_package).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        tampered.key_package = STANDARD.encode(bytes);
        assert!(validate_key_package_upload(&tampered).is_err());
    }

    #[test]
    fn fingerprint_is_bound_to_the_exact_key_package_signing_key() {
        let first = validate_key_package_upload(&upload()).unwrap();
        let second = validate_key_package_upload(&upload()).unwrap();
        assert_ne!(first.signature_public_key, second.signature_public_key);
        assert_ne!(
            first.signature_key_fingerprint,
            second.signature_key_fingerprint
        );
    }
}
