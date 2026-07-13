use hpke::{
    aead::AesGcm128, kdf::HkdfSha256, kem::DhP256HkdfSha256, Deserializable, Kem as KemTrait,
    OpModeR, OpModeS, Serializable,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

type Kem = DhP256HkdfSha256;

const MAX_PLAINTEXT: usize = 256 * 1024;
const MAX_CONTEXT: usize = 2048;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct HpkeKeyPair {
    private_key: Vec<u8>,
    #[zeroize(skip)]
    public_key: Vec<u8>,
}

impl HpkeKeyPair {
    pub fn from_bytes(private_key: Vec<u8>, public_key: Vec<u8>) -> Result<Self, HpkeError> {
        <Kem as KemTrait>::PrivateKey::from_bytes(&private_key)
            .map_err(|_| HpkeError::InvalidKey)?;
        <Kem as KemTrait>::PublicKey::from_bytes(&public_key).map_err(|_| HpkeError::InvalidKey)?;
        Ok(Self {
            private_key,
            public_key,
        })
    }

    pub fn private_key_bytes(&self) -> &[u8] {
        &self.private_key
    }
    pub fn public_key_bytes(&self) -> &[u8] {
        &self.public_key
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedPayload {
    pub version: u8,
    pub kem_id: u16,
    pub kdf_id: u16,
    pub aead_id: u16,
    pub encapsulated_key: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum HpkeError {
    #[error("invalid HPKE key")]
    InvalidKey,
    #[error("invalid or oversized HPKE input")]
    InvalidInput,
    #[error("unsupported HPKE parameters")]
    UnsupportedParameters,
    #[error("HPKE authentication failed")]
    AuthenticationFailed,
}

pub fn generate_hpke_key_pair() -> HpkeKeyPair {
    let (private_key, public_key) = Kem::gen_keypair();
    HpkeKeyPair {
        private_key: private_key.to_bytes().to_vec(),
        public_key: public_key.to_bytes().to_vec(),
    }
}

pub fn seal(
    public_key: &[u8],
    info: &[u8],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<SealedPayload, HpkeError> {
    validate_lengths(info, aad, plaintext.len())?;
    let public_key =
        <Kem as KemTrait>::PublicKey::from_bytes(public_key).map_err(|_| HpkeError::InvalidKey)?;
    let (encapsulated_key, mut context) =
        hpke::setup_sender::<AesGcm128, HkdfSha256, Kem>(&OpModeS::Base, &public_key, info)
            .map_err(|_| HpkeError::InvalidKey)?;
    let ciphertext = context
        .seal(plaintext, aad)
        .map_err(|_| HpkeError::InvalidInput)?;
    Ok(SealedPayload {
        version: 1,
        kem_id: 0x0010,
        kdf_id: 0x0001,
        aead_id: 0x0001,
        encapsulated_key: encapsulated_key.to_bytes().to_vec(),
        ciphertext,
    })
}

pub fn open(
    key_pair: &HpkeKeyPair,
    info: &[u8],
    aad: &[u8],
    payload: &SealedPayload,
) -> Result<Vec<u8>, HpkeError> {
    validate_lengths(info, aad, payload.ciphertext.len())?;
    if payload.version != 1
        || payload.kem_id != 0x0010
        || payload.kdf_id != 1
        || payload.aead_id != 1
    {
        return Err(HpkeError::UnsupportedParameters);
    }
    let private_key = <Kem as KemTrait>::PrivateKey::from_bytes(&key_pair.private_key)
        .map_err(|_| HpkeError::InvalidKey)?;
    let enc = <Kem as KemTrait>::EncappedKey::from_bytes(&payload.encapsulated_key)
        .map_err(|_| HpkeError::InvalidInput)?;
    let mut context = hpke::setup_receiver::<AesGcm128, HkdfSha256, Kem>(
        &OpModeR::Base,
        &private_key,
        &enc,
        info,
    )
    .map_err(|_| HpkeError::AuthenticationFailed)?;
    context
        .open(&payload.ciphertext, aad)
        .map_err(|_| HpkeError::AuthenticationFailed)
}

fn validate_lengths(info: &[u8], aad: &[u8], payload_len: usize) -> Result<(), HpkeError> {
    if info.is_empty()
        || info.len() > MAX_CONTEXT
        || aad.is_empty()
        || aad.len() > MAX_CONTEXT
        || payload_len > MAX_PLAINTEXT
    {
        return Err(HpkeError::InvalidInput);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_context_binding() {
        let keys = generate_hpke_key_pair();
        let sealed = seal(
            keys.public_key_bytes(),
            b"invite:room-a:epoch-1",
            b"alice->bob",
            b"secret",
        )
        .unwrap();
        assert_eq!(
            open(&keys, b"invite:room-a:epoch-1", b"alice->bob", &sealed).unwrap(),
            b"secret"
        );
        assert_eq!(
            open(&keys, b"invite:room-b:epoch-1", b"alice->bob", &sealed),
            Err(HpkeError::AuthenticationFailed)
        );
        assert_eq!(
            open(&keys, b"invite:room-a:epoch-1", b"mallory->bob", &sealed),
            Err(HpkeError::AuthenticationFailed)
        );
    }

    #[test]
    fn wrong_recipient_and_parameter_downgrade_fail() {
        let alice = generate_hpke_key_pair();
        let bob = generate_hpke_key_pair();
        let mut sealed = seal(
            alice.public_key_bytes(),
            b"operation",
            b"routing",
            b"secret",
        )
        .unwrap();
        assert!(open(&bob, b"operation", b"routing", &sealed).is_err());
        sealed.aead_id = 2;
        assert_eq!(
            open(&alice, b"operation", b"routing", &sealed),
            Err(HpkeError::UnsupportedParameters)
        );
    }
}
