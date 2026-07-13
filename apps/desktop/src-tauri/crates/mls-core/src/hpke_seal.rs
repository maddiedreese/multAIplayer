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
    fn rfc_9180_p256_invite_sealing_known_answer() {
        use core::convert::Infallible;
        use hpke::setup_sender_with_rng;
        use rand_core::{TryCryptoRng, TryRng};

        struct FixedRng(Vec<u8>);

        impl TryRng for FixedRng {
            type Error = Infallible;

            fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
                panic!("HPKE KAT unexpectedly requested a word")
            }

            fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
                panic!("HPKE KAT unexpectedly requested a word")
            }

            fn try_fill_bytes(&mut self, destination: &mut [u8]) -> Result<(), Self::Error> {
                assert_eq!(destination.len(), self.0.len());
                destination.copy_from_slice(&self.0);
                Ok(())
            }
        }

        impl TryCryptoRng for FixedRng {}

        fn hex(value: &str) -> Vec<u8> {
            assert_eq!(value.len() % 2, 0);
            value
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| {
                    let text = std::str::from_utf8(pair).unwrap();
                    u8::from_str_radix(text, 16).unwrap()
                })
                .collect()
        }

        // RFC 9180 A.3, mode 0, first encryption. These bytes are copied from
        // the published vector rather than produced by this implementation.
        let private_key = hex("f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2");
        let public_key = hex(concat!(
            "04fe8c19ce0905191ebc298a9245792531f26f0cece2460639e8bc39cb7f706a82",
            "6a779b4cf969b8a0e539c7f62fb3d30ad6aa8f80e30f1d128aafd68a2ce72ea0"
        ));
        let expected_enc = hex(concat!(
            "04a92719c6195d5085104f469a8b9814d5838ff72b60501e2c4466e5e67b325ac9",
            "8536d7b61a1af4b78e5b7f951c0900be863c403ce65c9bfcb9382657222d18c4"
        ));
        let expected_ciphertext = hex(concat!(
            "5ad590bb8baa577f8619db35a36311226a896e7342a6d836d8b7bcd2f20b6c7f",
            "9076ac232e3ab2523f39513434"
        ));
        let info = hex("4f6465206f6e2061204772656369616e2055726e");
        let aad = hex("436f756e742d30");
        let plaintext = hex("4265617574792069732074727574682c20747275746820626561757479");
        let recipient = <Kem as KemTrait>::PublicKey::from_bytes(&public_key).unwrap();
        let mut rng = FixedRng(hex(
            "4270e54ffd08d79d5928020af4686d8f6b7d35dbe470265f1f5aa22816ce860e",
        ));
        let (enc, mut sender) = setup_sender_with_rng::<AesGcm128, HkdfSha256, Kem>(
            &OpModeS::Base,
            &recipient,
            &info,
            &mut rng,
        )
        .unwrap();
        let ciphertext = sender.seal(&plaintext, &aad).unwrap();

        assert_eq!(enc.to_bytes().as_slice(), expected_enc);
        assert_eq!(ciphertext, expected_ciphertext);

        let keys = HpkeKeyPair::from_bytes(private_key, public_key).unwrap();
        let payload = SealedPayload {
            version: 1,
            kem_id: 0x0010,
            kdf_id: 0x0001,
            aead_id: 0x0001,
            encapsulated_key: expected_enc,
            ciphertext: expected_ciphertext,
        };
        assert_eq!(open(&keys, &info, &aad, &payload).unwrap(), plaintext);
    }

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
