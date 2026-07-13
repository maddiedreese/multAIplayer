use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha256 = Hmac<Sha256>;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct IssuedCapability {
    raw: [u8; 32],
    verifier: [u8; 32],
}

impl IssuedCapability {
    pub fn take_url_value(&mut self) -> [u8; 32] {
        let value = self.raw;
        self.raw.zeroize();
        value
    }
    pub fn verifier(&self) -> &[u8; 32] {
        &self.verifier
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityBinding {
    pub version: u8,
    pub phase: String,
    pub invite_id: String,
    pub team_id: String,
    pub room_id: String,
    pub key_epoch: u64,
    pub key_package_hash: String,
    pub request_id: String,
    pub request_nonce: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub host_user_id: String,
    pub host_device_id: String,
    pub expires_at: String,
    pub status: Option<String>,
    pub decided_at: Option<String>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CapabilityError {
    #[error("capability binding is invalid")]
    InvalidBinding,
    #[error("capability MAC is invalid")]
    InvalidMac,
}

pub fn issue_capability() -> IssuedCapability {
    let mut raw = [0u8; 32];
    rand::rng().fill_bytes(&mut raw);
    let verifier = derive_verifier(&raw);
    IssuedCapability { raw, verifier }
}

fn derive_verifier(raw: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"multaiplayer:invite-capability-verifier:v2\0");
    hash.update(raw);
    hash.finalize().into()
}

pub fn mac_binding(
    raw: &[u8; 32],
    binding: &CapabilityBinding,
) -> Result<[u8; 32], CapabilityError> {
    validate(binding)?;
    let encoded = serde_json::to_vec(binding).map_err(|_| CapabilityError::InvalidBinding)?;
    let verifier = derive_verifier(raw);
    let mut mac =
        HmacSha256::new_from_slice(&verifier).map_err(|_| CapabilityError::InvalidBinding)?;
    mac.update(b"multaiplayer:invite-capability-mac:v2\0");
    mac.update(&encoded);
    Ok(mac.finalize().into_bytes().into())
}

pub fn verify_binding(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
    expected: &[u8; 32],
) -> Result<(), CapabilityError> {
    validate(binding)?;
    let encoded = serde_json::to_vec(binding).map_err(|_| CapabilityError::InvalidBinding)?;
    let mut binding_mac =
        HmacSha256::new_from_slice(verifier).map_err(|_| CapabilityError::InvalidBinding)?;
    binding_mac.update(b"multaiplayer:invite-capability-mac:v2\0");
    binding_mac.update(&encoded);
    binding_mac
        .verify_slice(expected)
        .map_err(|_| CapabilityError::InvalidMac)
}

/// Produces the public response authenticator from the host's verifier-only record.
/// This is deliberately response-specific so the verifier cannot be exposed as a generic MAC key.
pub fn mac_response_binding(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
) -> Result<[u8; 32], CapabilityError> {
    validate(binding)?;
    if binding.phase != "response" {
        return Err(CapabilityError::InvalidBinding);
    }
    let encoded = serde_json::to_vec(binding).map_err(|_| CapabilityError::InvalidBinding)?;
    let mut mac =
        HmacSha256::new_from_slice(verifier).map_err(|_| CapabilityError::InvalidBinding)?;
    mac.update(b"multaiplayer:invite-capability-mac:v2\0");
    mac.update(&encoded);
    Ok(mac.finalize().into_bytes().into())
}

fn validate(value: &CapabilityBinding) -> Result<(), CapabilityError> {
    if value.version != 2 || !matches!(value.phase.as_str(), "request" | "response") {
        return Err(CapabilityError::InvalidBinding);
    }
    let fields = [
        &value.invite_id,
        &value.team_id,
        &value.room_id,
        &value.key_package_hash,
        &value.request_id,
        &value.request_nonce,
        &value.requester_user_id,
        &value.requester_device_id,
        &value.host_user_id,
        &value.host_device_id,
        &value.expires_at,
    ];
    if fields
        .iter()
        .any(|field| field.is_empty() || field.len() > 256 || field.chars().any(char::is_control))
    {
        return Err(CapabilityError::InvalidBinding);
    }
    if value.phase == "request" && (value.status.is_some() || value.decided_at.is_some()) {
        return Err(CapabilityError::InvalidBinding);
    }
    if value.phase == "response" && (value.status.is_none() || value.decided_at.is_none()) {
        return Err(CapabilityError::InvalidBinding);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> CapabilityBinding {
        CapabilityBinding {
            version: 2,
            phase: "request".into(),
            invite_id: "i".into(),
            team_id: "t".into(),
            room_id: "r".into(),
            key_epoch: 1,
            key_package_hash: "h".into(),
            request_id: "q".into(),
            request_nonce: "n".into(),
            requester_user_id: "u".into(),
            requester_device_id: "d".into(),
            host_user_id: "hu".into(),
            host_device_id: "hd".into(),
            expires_at: "2030-01-01T00:00:00Z".into(),
            status: None,
            decided_at: None,
        }
    }
    #[test]
    fn binds_every_field_and_verifier() {
        let mut issued = issue_capability();
        let raw = issued.take_url_value();
        let mac = mac_binding(&raw, &binding()).unwrap();
        assert!(verify_binding(issued.verifier(), &binding(), &mac).is_ok());
        let mut changed = binding();
        changed.room_id = "other".into();
        assert!(verify_binding(issued.verifier(), &changed, &mac).is_err());
        assert!(verify_binding(&[9; 32], &binding(), &mac).is_err());
    }
}
