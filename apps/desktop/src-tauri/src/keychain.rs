use serde::Deserialize;

use crate::validation::{ensure_device_identity_payload, keychain_account};

const KEYCHAIN_SERVICE: &str = "com.multaiplayer.desktop.room-secrets";
const DEVICE_IDENTITY_ACCOUNT: &str = "device-identity:v1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoomSecretRequest {
    room_id: String,
    secret: Option<String>,
}

#[tauri::command]
pub(crate) fn room_secret_get(room_id: String) -> Result<Option<String>, String> {
    let account = keychain_account(&room_id)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Failed to open room secret keychain entry: {error}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read room secret from keychain: {error}")),
    }
}

#[tauri::command]
pub(crate) fn room_secret_set(request: RoomSecretRequest) -> Result<(), String> {
    let account = keychain_account(&request.room_id)?;
    let secret = request
        .secret
        .ok_or_else(|| "room secret is required".to_string())?;
    if secret.trim().is_empty() || secret.len() > 4096 {
        return Err("room secret is invalid".to_string());
    }
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Failed to open room secret keychain entry: {error}"))?;
    entry
        .set_password(&secret)
        .map_err(|error| format!("Failed to save room secret to keychain: {error}"))
}

#[tauri::command]
pub(crate) fn room_secret_delete(room_id: String) -> Result<(), String> {
    let account = keychain_account(&room_id)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Failed to open room secret keychain entry: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete room secret from keychain: {error}"
        )),
    }
}

#[tauri::command]
pub(crate) fn device_identity_get() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, DEVICE_IDENTITY_ACCOUNT)
        .map_err(|error| format!("Failed to open device identity keychain entry: {error}"))?;
    match entry.get_password() {
        Ok(identity) => Ok(Some(identity)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Failed to read device identity from keychain: {error}"
        )),
    }
}

#[tauri::command]
pub(crate) fn device_identity_set(identity: String) -> Result<(), String> {
    ensure_device_identity_payload(&identity)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, DEVICE_IDENTITY_ACCOUNT)
        .map_err(|error| format!("Failed to open device identity keychain entry: {error}"))?;
    entry
        .set_password(&identity)
        .map_err(|error| format!("Failed to save device identity to keychain: {error}"))
}

#[tauri::command]
pub(crate) fn device_identity_delete() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, DEVICE_IDENTITY_ACCOUNT)
        .map_err(|error| format!("Failed to open device identity keychain entry: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete device identity from keychain: {error}"
        )),
    }
}
