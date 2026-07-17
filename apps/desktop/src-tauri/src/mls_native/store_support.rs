use super::*;

pub(super) fn with_engine<T>(
    state: &tauri::State<'_, MlsNativeState>,
    operation: impl FnOnce(&mut MlsEngine) -> Result<T, mls_core::EngineError>,
) -> Result<T, String> {
    let mut lock = state
        .engine
        .lock()
        .map_err(|_| "MLS state is unavailable".to_string())?;
    operation(
        lock.as_mut()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
    )
    .map_err(engine_error)
}

pub(super) fn engine_error(error: mls_core::EngineError) -> String {
    match error {
        mls_core::EngineError::RequiresRejoin { .. } => "MLS_REQUIRES_REJOIN".into(),
        other => safe_error(other),
    }
}

pub(super) fn with_store<T>(
    state: &tauri::State<'_, MlsNativeState>,
    operation: impl FnOnce(&EncryptedStore) -> Result<T, mls_core::StoreError>,
) -> Result<T, String> {
    let lock = state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())?;
    operation(
        lock.as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
    )
    .map_err(safe_error)
}

pub(super) fn decode(value: &str) -> Result<Vec<u8>, String> {
    if value.is_empty() || value.len() > MAX_B64_MESSAGE {
        return Err("MLS message is invalid".into());
    }
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| "MLS message is invalid".to_string())?;
    if STANDARD.encode(&decoded) != value {
        return Err("MLS message is invalid".into());
    }
    Ok(decoded)
}

pub(super) fn safe_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(super) fn quarantine_store(path: &std::path::Path) -> Result<(), String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Failed to quarantine corrupt MLS store".to_string())?
        .as_secs();
    let base = path.with_extension(format!("db.corrupt-{timestamp}"));
    for (source, target) in [
        (path.to_path_buf(), base.clone()),
        (
            std::path::PathBuf::from(format!("{}-wal", path.display())),
            std::path::PathBuf::from(format!("{}-wal", base.display())),
        ),
        (
            std::path::PathBuf::from(format!("{}-shm", path.display())),
            std::path::PathBuf::from(format!("{}-shm", base.display())),
        ),
    ] {
        if source.exists() {
            std::fs::rename(source, target)
                .map_err(|_| "Failed to quarantine corrupt MLS store".to_string())?;
        }
    }
    Ok(())
}

pub(super) fn should_quarantine_store(path: &std::path::Path, wrapping_key: [u8; 32]) -> bool {
    let Err(error) = EncryptedStore::open(path, wrapping_key) else {
        return false;
    };
    is_corruption_error_message(&error.to_string())
}

pub(super) fn is_corruption_error_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("file is not a database")
        || message.contains("database disk image is malformed")
        || message.contains("database malformed")
        || message.contains("not a database")
}

pub(super) fn secure_store_permissions(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "Failed to secure MLS store permissions".to_string())?;
    }
    Ok(())
}

pub(super) fn load_or_create_signing_secret(
    github_user_id: &str,
    device_id: &str,
) -> Result<Vec<u8>, SigningSecretLoadError> {
    let entry = keyring::Entry::new(MLS_KEYCHAIN_SERVICE, MLS_IDENTITY_ACCOUNT)
        .map_err(|_| SigningSecretLoadError::Internal)?;
    match entry.get_password() {
        Ok(value) => decode_stored_signing_secret(&value, github_user_id, device_id),
        Err(keyring::Error::NoEntry) => {
            let secret =
                generate_device_signing_secret().map_err(|_| SigningSecretLoadError::Internal)?;
            let stored = StoredMlsIdentity {
                version: 1,
                github_user_id: github_user_id.to_owned(),
                device_id: device_id.to_owned(),
                signing_secret: STANDARD.encode(&secret),
            };
            entry
                .set_password(
                    &serde_json::to_string(&stored)
                        .map_err(|_| SigningSecretLoadError::Internal)?,
                )
                .map_err(|_| SigningSecretLoadError::Internal)?;
            Ok(secret)
        }
        Err(_) => Err(SigningSecretLoadError::Internal),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SigningSecretLoadError {
    ScopeMismatch,
    Internal,
}

pub(super) fn decode_stored_signing_secret(
    value: &str,
    github_user_id: &str,
    device_id: &str,
) -> Result<Vec<u8>, SigningSecretLoadError> {
    let stored: StoredMlsIdentity =
        serde_json::from_str(value).map_err(|_| SigningSecretLoadError::Internal)?;
    if stored.version != 1
        || stored.github_user_id != github_user_id
        || stored.device_id != device_id
    {
        return Err(SigningSecretLoadError::ScopeMismatch);
    }
    fixed32(&stored.signing_secret)
        .map(Vec::from)
        .map_err(|_| SigningSecretLoadError::Internal)
}
pub(super) fn load_or_create_store_wrapping_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(MLS_KEYCHAIN_SERVICE, "mls-store-wrap:v1")
        .map_err(|_| "Failed to open MLS store key".to_string())?;
    match entry.get_password() {
        Ok(value) => fixed32(&value),
        Err(keyring::Error::NoEntry) => {
            let bytes = generate_device_signing_secret().map_err(safe_error)?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "Failed to generate MLS store key".to_string())?;
            entry
                .set_password(&STANDARD.encode(key))
                .map_err(|_| "Failed to save MLS store key".to_string())?;
            Ok(key)
        }
        Err(_) => Err("Failed to read MLS store key".into()),
    }
}

pub(super) fn load_or_create_hpke_key_pair() -> Result<HpkeKeyPair, String> {
    let entry = keyring::Entry::new(MLS_KEYCHAIN_SERVICE, MLS_HPKE_ACCOUNT)
        .map_err(|_| "Failed to open HPKE identity".to_string())?;
    match entry.get_password() {
        Ok(value) => {
            let parts: Vec<&str> = value.split('.').collect();
            if parts.len() != 2 {
                return Err("Stored HPKE identity is corrupt".into());
            }
            HpkeKeyPair::from_bytes(
                STANDARD
                    .decode(parts[0])
                    .map_err(|_| "Stored HPKE identity is corrupt".to_string())?,
                STANDARD
                    .decode(parts[1])
                    .map_err(|_| "Stored HPKE identity is corrupt".to_string())?,
            )
            .map_err(safe_error)
        }
        Err(keyring::Error::NoEntry) => {
            let pair = generate_hpke_key_pair();
            entry
                .set_password(&format!(
                    "{}.{}",
                    STANDARD.encode(pair.private_key_bytes()),
                    STANDARD.encode(pair.public_key_bytes())
                ))
                .map_err(|_| "Failed to save HPKE identity".to_string())?;
            Ok(pair)
        }
        Err(_) => Err("Failed to read HPKE identity".into()),
    }
}
pub(super) fn fingerprint(bytes: &[u8]) -> String {
    let hex = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    format!(
        "sha256:{}",
        hex.as_bytes()
            .chunks(4)
            .map(|c| std::str::from_utf8(c).unwrap_or(""))
            .collect::<Vec<_>>()
            .join(":")
    )
}
