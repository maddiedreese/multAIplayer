use crate::{crypto_provider, MLS_CIPHERSUITE};
use mls_rs::{crypto::SignatureSecretKey, CipherSuiteProvider, CryptoProvider};
use serde::Serialize;
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

const P256_SPKI_PREFIX: &[u8] = &[
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
];

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct DeviceAuthSigner {
    secret: Vec<u8>,
    github_user_id: String,
    device_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DeviceAuthSignature {
    pub signature_der: Vec<u8>,
    pub public_key_spki_der: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum DeviceAuthError {
    #[error("invalid device signing material or challenge")]
    Invalid,
    #[error("device signing failed")]
    Signing,
}

pub fn generate_device_signing_secret() -> Result<Vec<u8>, DeviceAuthError> {
    let provider = crypto_provider();
    let suite = provider
        .cipher_suite_provider(MLS_CIPHERSUITE)
        .ok_or(DeviceAuthError::Signing)?;
    let (secret, _public) = suite
        .signature_key_generate()
        .map_err(|_| DeviceAuthError::Signing)?;
    Ok(secret.as_ref().to_vec())
}

impl DeviceAuthSigner {
    pub fn from_secret(
        secret: Vec<u8>,
        github_user_id: String,
        device_id: String,
    ) -> Result<Self, DeviceAuthError> {
        if secret.is_empty()
            || secret.len() > 256
            || github_user_id.is_empty()
            || device_id.is_empty()
        {
            return Err(DeviceAuthError::Invalid);
        }
        Ok(Self {
            secret,
            github_user_id,
            device_id,
        })
    }
    pub fn public_key_spki_der(&self) -> Result<Vec<u8>, DeviceAuthError> {
        let provider = crypto_provider();
        let suite = provider
            .cipher_suite_provider(MLS_CIPHERSUITE)
            .ok_or(DeviceAuthError::Signing)?;
        let secret = SignatureSecretKey::from(self.secret.clone());
        let public = suite
            .signature_key_derive_public(&secret)
            .map_err(|_| DeviceAuthError::Signing)?;
        if public.len() != 65 {
            return Err(DeviceAuthError::Signing);
        }
        let mut spki = P256_SPKI_PREFIX.to_vec();
        spki.extend_from_slice(public.as_ref());
        Ok(spki)
    }
    pub fn sign(&self, challenge: &[u8]) -> Result<DeviceAuthSignature, DeviceAuthError> {
        if challenge.len() != 32 {
            return Err(DeviceAuthError::Invalid);
        }
        let provider = crypto_provider();
        let suite = provider
            .cipher_suite_provider(MLS_CIPHERSUITE)
            .ok_or(DeviceAuthError::Signing)?;
        let secret = SignatureSecretKey::from(self.secret.clone());
        let public_key_spki_der = self.public_key_spki_der()?;
        let mut signed = b"multaiplayer:relay-device-auth:v1\0".to_vec();
        signed.extend_from_slice(&(self.github_user_id.len() as u16).to_be_bytes());
        signed.extend_from_slice(self.github_user_id.as_bytes());
        signed.extend_from_slice(&(self.device_id.len() as u16).to_be_bytes());
        signed.extend_from_slice(self.device_id.as_bytes());
        signed.extend_from_slice(challenge);
        let signature_der = suite
            .sign(&secret, &signed)
            .map_err(|_| DeviceAuthError::Signing)?;
        Ok(DeviceAuthSignature {
            signature_der,
            public_key_spki_der,
        })
    }

    pub fn sign_host_transfer(
        &self,
        canonical_authorization: &[u8],
    ) -> Result<DeviceAuthSignature, DeviceAuthError> {
        if canonical_authorization.is_empty() || canonical_authorization.len() > 4096 {
            return Err(DeviceAuthError::Invalid);
        }
        let provider = crypto_provider();
        let suite = provider
            .cipher_suite_provider(MLS_CIPHERSUITE)
            .ok_or(DeviceAuthError::Signing)?;
        let secret = SignatureSecretKey::from(self.secret.clone());
        let public_key_spki_der = self.public_key_spki_der()?;
        let mut signed = b"multaiplayer:host-transfer-authorization:v2\0".to_vec();
        signed.extend_from_slice(canonical_authorization);
        let signature_der = suite
            .sign(&secret, &signed)
            .map_err(|_| DeviceAuthError::Signing)?;
        Ok(DeviceAuthSignature {
            signature_der,
            public_key_spki_der,
        })
    }
}
