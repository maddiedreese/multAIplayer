use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha256 = Hmac<Sha256>;

const BINDING_PREFIX: &[u8] = b"multaiplayer:invite-capability-binding:v3\0";
const REQUEST_KEY_LABEL: &[u8] = b"multaiplayer:invite-capability-request-key:v3\0";
const RESPONSE_KEY_LABEL: &[u8] = b"multaiplayer:invite-capability-response-key:v3\0";
const REQUEST_MAC_LABEL: &[u8] = b"multaiplayer:invite-capability-request-mac:v3\0";
const RESPONSE_MAC_LABEL: &[u8] = b"multaiplayer:invite-capability-response-mac:v3\0";

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

#[derive(Clone, Copy, Eq, PartialEq)]
enum MacDomain {
    Request,
    Response,
}

impl MacDomain {
    fn key_label(self) -> &'static [u8] {
        match self {
            Self::Request => REQUEST_KEY_LABEL,
            Self::Response => RESPONSE_KEY_LABEL,
        }
    }

    fn mac_label(self) -> &'static [u8] {
        match self {
            Self::Request => REQUEST_MAC_LABEL,
            Self::Response => RESPONSE_MAC_LABEL,
        }
    }

    fn phase(self) -> &'static str {
        match self {
            Self::Request => "request",
            Self::Response => "response",
        }
    }
}

pub fn issue_capability() -> IssuedCapability {
    let mut raw = [0u8; 32];
    rand::rng().fill_bytes(&mut raw);
    let verifier = derive_capability_verifier(&raw);
    IssuedCapability { raw, verifier }
}

pub fn derive_capability_verifier(raw: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"multaiplayer:invite-capability-verifier:v3\0");
    hash.update(raw);
    hash.finalize().into()
}

/// Encodes a binding independently of Serde and Rust struct declaration order.
///
/// The format is the fixed v3 prefix, version byte, phase byte, big-endian epoch,
/// eleven length-prefixed UTF-8 fields, then tagged optional status and decision
/// timestamp fields. Lengths are unsigned 32-bit big-endian values.
pub fn encode_capability_binding(binding: &CapabilityBinding) -> Result<Vec<u8>, CapabilityError> {
    validate(binding)?;
    let mut encoded = Vec::with_capacity(512);
    encoded.extend_from_slice(BINDING_PREFIX);
    encoded.push(binding.version);
    encoded.push(if binding.phase == "request" { 0 } else { 1 });
    encoded.extend_from_slice(&binding.key_epoch.to_be_bytes());
    for field in [
        &binding.invite_id,
        &binding.team_id,
        &binding.room_id,
        &binding.key_package_hash,
        &binding.request_id,
        &binding.request_nonce,
        &binding.requester_user_id,
        &binding.requester_device_id,
        &binding.host_user_id,
        &binding.host_device_id,
        &binding.expires_at,
    ] {
        encode_field(&mut encoded, field)?;
    }
    encode_optional_field(&mut encoded, binding.status.as_deref())?;
    encode_optional_field(&mut encoded, binding.decided_at.as_deref())?;
    Ok(encoded)
}

pub fn mac_binding(
    raw: &[u8; 32],
    binding: &CapabilityBinding,
) -> Result<[u8; 32], CapabilityError> {
    authenticate(
        &derive_capability_verifier(raw),
        binding,
        MacDomain::Request,
    )
}

pub fn verify_request_binding(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
    expected: &[u8; 32],
) -> Result<(), CapabilityError> {
    verify(verifier, binding, expected, MacDomain::Request)
}

pub fn mac_response_binding(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
) -> Result<[u8; 32], CapabilityError> {
    authenticate(verifier, binding, MacDomain::Response)
}

pub fn verify_response_binding(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
    expected: &[u8; 32],
) -> Result<(), CapabilityError> {
    verify(verifier, binding, expected, MacDomain::Response)
}

fn authenticate(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
    domain: MacDomain,
) -> Result<[u8; 32], CapabilityError> {
    if binding.phase != domain.phase() {
        return Err(CapabilityError::InvalidBinding);
    }
    let encoded = encode_capability_binding(binding)?;
    let key = derive_mac_key(verifier, domain)?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| CapabilityError::InvalidBinding)?;
    mac.update(domain.mac_label());
    mac.update(&encoded);
    Ok(mac.finalize().into_bytes().into())
}

fn verify(
    verifier: &[u8; 32],
    binding: &CapabilityBinding,
    expected: &[u8; 32],
    domain: MacDomain,
) -> Result<(), CapabilityError> {
    if binding.phase != domain.phase() {
        return Err(CapabilityError::InvalidBinding);
    }
    let encoded = encode_capability_binding(binding)?;
    let key = derive_mac_key(verifier, domain)?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| CapabilityError::InvalidBinding)?;
    mac.update(domain.mac_label());
    mac.update(&encoded);
    mac.verify_slice(expected)
        .map_err(|_| CapabilityError::InvalidMac)
}

fn derive_mac_key(verifier: &[u8; 32], domain: MacDomain) -> Result<[u8; 32], CapabilityError> {
    let mut derivation =
        HmacSha256::new_from_slice(verifier).map_err(|_| CapabilityError::InvalidBinding)?;
    derivation.update(domain.key_label());
    Ok(derivation.finalize().into_bytes().into())
}

fn encode_field(encoded: &mut Vec<u8>, value: &str) -> Result<(), CapabilityError> {
    let length = u32::try_from(value.len()).map_err(|_| CapabilityError::InvalidBinding)?;
    encoded.extend_from_slice(&length.to_be_bytes());
    encoded.extend_from_slice(value.as_bytes());
    Ok(())
}

fn encode_optional_field(
    encoded: &mut Vec<u8>,
    value: Option<&str>,
) -> Result<(), CapabilityError> {
    match value {
        Some(value) => {
            encoded.push(1);
            encode_field(encoded, value)
        }
        None => {
            encoded.push(0);
            Ok(())
        }
    }
}

fn validate(value: &CapabilityBinding) -> Result<(), CapabilityError> {
    if value.version != 3 || !matches!(value.phase.as_str(), "request" | "response") {
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
            version: 3,
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
        assert!(verify_request_binding(issued.verifier(), &binding(), &mac).is_ok());
        let original = binding();
        let mut mutations = Vec::new();
        macro_rules! mutate {
            ($field:ident, $value:expr) => {{
                let mut changed = original.clone();
                changed.$field = $value;
                mutations.push(changed);
            }};
        }
        mutate!(invite_id, "other-invite".into());
        mutate!(team_id, "other-team".into());
        mutate!(room_id, "other-room".into());
        mutate!(key_epoch, 2);
        mutate!(key_package_hash, "other-package".into());
        mutate!(request_id, "other-request".into());
        mutate!(request_nonce, "other-nonce".into());
        mutate!(requester_user_id, "other-requester".into());
        mutate!(requester_device_id, "other-requester-device".into());
        mutate!(host_user_id, "other-host".into());
        mutate!(host_device_id, "other-host-device".into());
        mutate!(expires_at, "2031-01-01T00:00:00Z".into());
        for changed in mutations {
            assert!(verify_request_binding(issued.verifier(), &changed, &mac).is_err());
        }
        assert!(verify_request_binding(&[9; 32], &binding(), &mac).is_err());
    }

    #[test]
    fn request_and_response_domains_are_independent() {
        let mut issued = issue_capability();
        let raw = issued.take_url_value();
        let request_mac = mac_binding(&raw, &binding()).unwrap();
        let mut response = binding();
        response.phase = "response".into();
        response.status = Some("approved".into());
        response.decided_at = Some("2030-01-01T00:00:01Z".into());
        let response_mac = mac_response_binding(issued.verifier(), &response).unwrap();

        assert_ne!(request_mac, response_mac);
        assert!(verify_response_binding(issued.verifier(), &response, &response_mac).is_ok());
        assert_eq!(
            verify_request_binding(issued.verifier(), &response, &response_mac),
            Err(CapabilityError::InvalidBinding)
        );
        assert_eq!(
            verify_response_binding(issued.verifier(), &binding(), &request_mac),
            Err(CapabilityError::InvalidBinding)
        );
    }

    #[test]
    fn canonical_binding_encoding_has_a_stable_golden_digest() {
        let encoded = encode_capability_binding(&binding()).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(encoded)),
            "94367566d936e2c1e49387a2501a374e6a37430ed0452fe8d6dc13a179aa8262"
        );
    }

    #[test]
    fn rejects_unsupported_versions_and_phases() {
        let mut invalid = binding();
        invalid.version = 2;
        assert_eq!(
            encode_capability_binding(&invalid),
            Err(CapabilityError::InvalidBinding)
        );

        invalid = binding();
        invalid.phase = "approval".into();
        assert_eq!(
            encode_capability_binding(&invalid),
            Err(CapabilityError::InvalidBinding)
        );
    }

    #[test]
    fn enforces_authenticated_text_boundaries() {
        for invalid_text in [String::new(), "a".repeat(257), "line\nbreak".into()] {
            let mut invalid = binding();
            invalid.invite_id = invalid_text;
            assert_eq!(
                encode_capability_binding(&invalid),
                Err(CapabilityError::InvalidBinding)
            );
        }

        let mut maximum = binding();
        maximum.invite_id = "a".repeat(256);
        assert!(encode_capability_binding(&maximum).is_ok());
    }

    #[test]
    fn requires_phase_specific_decision_fields() {
        let mut request_with_status = binding();
        request_with_status.status = Some("approved".into());
        assert_eq!(
            encode_capability_binding(&request_with_status),
            Err(CapabilityError::InvalidBinding)
        );

        let mut request_with_decision_time = binding();
        request_with_decision_time.decided_at = Some("2030-01-01T00:00:01Z".into());
        assert_eq!(
            encode_capability_binding(&request_with_decision_time),
            Err(CapabilityError::InvalidBinding)
        );

        let mut response = binding();
        response.phase = "response".into();
        response.status = Some("approved".into());
        response.decided_at = Some("2030-01-01T00:00:01Z".into());
        assert!(encode_capability_binding(&response).is_ok());

        let mut response_without_status = response.clone();
        response_without_status.status = None;
        assert_eq!(
            encode_capability_binding(&response_without_status),
            Err(CapabilityError::InvalidBinding)
        );

        response.decided_at = None;
        assert_eq!(
            encode_capability_binding(&response),
            Err(CapabilityError::InvalidBinding)
        );
    }
}
