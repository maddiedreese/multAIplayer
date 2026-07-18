use crate::{platform::CredentialStore, CliError};
use base64::{engine::general_purpose::STANDARD, Engine};
use mls_core::{
    generate_device_signing_secret, generate_hpke_key_pair, DeviceAuthSigner, HpkeKeyPair,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const SIGNING_IDENTITY_ACCOUNT: &str = "device-signing-identity:v1";
pub const HPKE_IDENTITY_ACCOUNT: &str = "device-hpke-identity:v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentityPublic {
    pub user_id: String,
    pub device_id: String,
    pub display_name: String,
    pub signature_public_key: String,
    pub signature_key_fingerprint: String,
    pub hpke_public_key: String,
    pub hpke_key_fingerprint: String,
}

pub struct DeviceIdentity {
    pub public: DeviceIdentityPublic,
    pub signer: DeviceAuthSigner,
    pub hpke: HpkeKeyPair,
}

#[derive(Serialize, Deserialize)]
struct StoredSigningIdentity {
    version: u8,
    github_user_id: String,
    device_id: String,
    signing_secret: String,
}

#[derive(Serialize, Deserialize)]
struct StoredHpkeIdentity {
    version: u8,
    github_user_id: String,
    device_id: String,
    private_key: String,
    public_key: String,
}

pub fn load_or_create_identity(
    store: &impl CredentialStore,
    github_user_id: &str,
    display_name: &str,
) -> Result<DeviceIdentity, CliError> {
    validate_identity_text(github_user_id, 256)?;
    validate_identity_text(display_name, 120)?;
    let (device_id, secret, signing_was_created) = load_or_create_signing(store, github_user_id)?;
    let hpke = load_or_create_hpke(store, github_user_id, &device_id, signing_was_created)?;
    let signer = DeviceAuthSigner::from_secret(
        secret.to_vec(),
        github_user_id.to_owned(),
        device_id.clone(),
    )
    .map_err(|_| CliError::IdentityUnavailable)?;
    let signature_der = signer
        .public_key_spki_der()
        .map_err(|_| CliError::IdentityUnavailable)?;
    let signature_public_key = STANDARD.encode(&signature_der);
    let hpke_public_key = STANDARD.encode(hpke.public_key_bytes());
    Ok(DeviceIdentity {
        public: DeviceIdentityPublic {
            user_id: github_user_id.to_owned(),
            device_id,
            display_name: display_name.to_owned(),
            signature_key_fingerprint: fingerprint(&signature_der),
            signature_public_key,
            hpke_key_fingerprint: fingerprint(hpke.public_key_bytes()),
            hpke_public_key,
        },
        signer,
        hpke,
    })
}

fn load_or_create_signing(
    store: &impl CredentialStore,
    github_user_id: &str,
) -> Result<(String, Zeroizing<Vec<u8>>, bool), CliError> {
    if let Some(value) = store.get(SIGNING_IDENTITY_ACCOUNT)? {
        let stored: StoredSigningIdentity =
            serde_json::from_str(&value).map_err(|_| CliError::InvalidStoredCredential)?;
        if stored.version != 1 || stored.github_user_id != github_user_id {
            return Err(CliError::IdentityScopeMismatch);
        }
        validate_device_id(&stored.device_id)?;
        let secret = STANDARD
            .decode(&stored.signing_secret)
            .map_err(|_| CliError::InvalidStoredCredential)?;
        if secret.len() != 32 {
            return Err(CliError::InvalidStoredCredential);
        }
        return Ok((stored.device_id, Zeroizing::new(secret), false));
    }

    let device_id = format!("device_{}", Uuid::new_v4());
    let secret = Zeroizing::new(
        generate_device_signing_secret().map_err(|_| CliError::IdentityUnavailable)?,
    );
    if secret.len() != 32 {
        return Err(CliError::IdentityUnavailable);
    }
    let stored = StoredSigningIdentity {
        version: 1,
        github_user_id: github_user_id.to_owned(),
        device_id: device_id.clone(),
        signing_secret: STANDARD.encode(secret.as_slice()),
    };
    store.set(
        SIGNING_IDENTITY_ACCOUNT,
        &serde_json::to_string(&stored).map_err(|_| CliError::IdentityUnavailable)?,
    )?;
    Ok((device_id, secret, true))
}

fn load_or_create_hpke(
    store: &impl CredentialStore,
    github_user_id: &str,
    device_id: &str,
    signing_was_created: bool,
) -> Result<HpkeKeyPair, CliError> {
    if let Some(value) = store.get(HPKE_IDENTITY_ACCOUNT)? {
        let stored: StoredHpkeIdentity =
            serde_json::from_str(&value).map_err(|_| CliError::InvalidStoredCredential)?;
        if stored.version != 1
            || stored.github_user_id != github_user_id
            || stored.device_id != device_id
        {
            return Err(CliError::IdentityScopeMismatch);
        }
        let private = Zeroizing::new(
            STANDARD
                .decode(stored.private_key)
                .map_err(|_| CliError::InvalidStoredCredential)?,
        );
        let public = STANDARD
            .decode(stored.public_key)
            .map_err(|_| CliError::InvalidStoredCredential)?;
        return HpkeKeyPair::from_bytes(private.to_vec(), public)
            .map_err(|_| CliError::InvalidStoredCredential);
    }

    let pair = generate_hpke_key_pair();
    let stored = StoredHpkeIdentity {
        version: 1,
        github_user_id: github_user_id.to_owned(),
        device_id: device_id.to_owned(),
        private_key: STANDARD.encode(pair.private_key_bytes()),
        public_key: STANDARD.encode(pair.public_key_bytes()),
    };
    if let Err(error) = store.set(
        HPKE_IDENTITY_ACCOUNT,
        &serde_json::to_string(&stored).map_err(|_| CliError::IdentityUnavailable)?,
    ) {
        if signing_was_created {
            let _ = store.delete(SIGNING_IDENTITY_ACCOUNT);
        }
        return Err(error);
    }
    Ok(pair)
}

fn validate_identity_text(value: &str, max: usize) -> Result<(), CliError> {
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        Err(CliError::IdentityUnavailable)
    } else {
        Ok(())
    }
}

fn validate_device_id(value: &str) -> Result<(), CliError> {
    if value.starts_with("device_")
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        Ok(())
    } else {
        Err(CliError::InvalidStoredCredential)
    }
}

pub fn fingerprint(bytes: &[u8]) -> String {
    let hex = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "sha256:{}",
        hex.as_bytes()
            .chunks(4)
            .filter_map(|chunk| std::str::from_utf8(chunk).ok())
            .collect::<Vec<_>>()
            .join(":")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::tests::MemoryCredentialStore;

    #[test]
    fn identity_persists_and_matches_desktop_registration_contract() {
        let store = MemoryCredentialStore::default();
        let first = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let second = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        assert_eq!(first.public, second.public);

        let signature = STANDARD.decode(&first.public.signature_public_key).unwrap();
        let hpke = STANDARD.decode(&first.public.hpke_public_key).unwrap();
        assert_eq!(signature.len(), 91);
        assert_eq!(
            &signature[..26],
            &[
                0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
                0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
            ]
        );
        assert_eq!(hpke.len(), 65);
        assert_eq!(hpke[0], 4);
        assert_eq!(
            first.public.signature_key_fingerprint,
            fingerprint(&signature)
        );
        assert_eq!(first.public.hpke_key_fingerprint, fingerprint(&hpke));

        let json = serde_json::to_value(&first.public).unwrap();
        let object = json.as_object().unwrap();
        assert_eq!(object.len(), 7);
        for field in [
            "userId",
            "deviceId",
            "displayName",
            "signaturePublicKey",
            "signatureKeyFingerprint",
            "hpkePublicKey",
            "hpkeKeyFingerprint",
        ] {
            assert!(json.get(field).is_some(), "missing desktop field {field}");
        }
    }

    #[test]
    fn identity_is_account_bound_and_keychain_errors_are_redacted() {
        let store = MemoryCredentialStore::default();
        load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let durable_identity = store.values.borrow().clone();
        assert!(matches!(
            load_or_create_identity(&store, "github:99", "Other"),
            Err(CliError::IdentityScopeMismatch)
        ));
        assert_eq!(*store.values.borrow(), durable_identity);
        *store.fail_reads.borrow_mut() = true;
        let error = match load_or_create_identity(&store, "github:42", "Maddie") {
            Ok(_) => panic!("Keychain read failure unexpectedly succeeded"),
            Err(error) => error,
        };
        assert_eq!(
            error.to_string(),
            "The secure credential store is unavailable."
        );
        assert!(!error.to_string().contains("signing_secret"));
    }

    #[test]
    fn partial_hpke_store_failure_rolls_back_new_signing_identity() {
        let store = MemoryCredentialStore::default();
        *store.fail_set_account.borrow_mut() = Some(HPKE_IDENTITY_ACCOUNT.to_owned());
        assert!(load_or_create_identity(&store, "github:42", "Maddie").is_err());
        assert!(store.values.borrow().is_empty());
    }

    #[test]
    fn hpke_write_failure_never_deletes_an_existing_signing_identity() {
        let store = MemoryCredentialStore::default();
        load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let original_signing = store
            .values
            .borrow()
            .get(SIGNING_IDENTITY_ACCOUNT)
            .unwrap()
            .clone();
        store.values.borrow_mut().remove(HPKE_IDENTITY_ACCOUNT);
        *store.fail_set_account.borrow_mut() = Some(HPKE_IDENTITY_ACCOUNT.to_owned());

        assert!(load_or_create_identity(&store, "github:42", "Maddie").is_err());
        assert_eq!(
            store.values.borrow().get(SIGNING_IDENTITY_ACCOUNT).unwrap(),
            &original_signing
        );
    }
}
