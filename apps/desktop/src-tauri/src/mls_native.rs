use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use mls_core::{
    derive_capability_verifier, encode_capability_binding, generate_device_signing_secret,
    generate_hpke_key_pair, issue_capability, mac_binding, mac_response_binding, open, seal,
    validate_credential, validate_key_package_upload, verify_request_binding,
    verify_response_binding, BasicAppCredential, CapabilityBinding, DeviceAuthSigner,
    EncryptedStore, ExporterCiphertext, HpkeKeyPair, JoinAdmissionMetadata, KeyPackageUpload,
    MlsEngine, PendingInviteRequest, SealedPayload, WelcomeRetryMetadata,
};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Mutex};
use tauri::Manager;

const MAX_B64_MESSAGE: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct MlsNativeState {
    engine: Mutex<Option<MlsEngine>>,
    signer: Mutex<Option<DeviceAuthSigner>>,
    hpke: Mutex<Option<HpkeKeyPair>>,
    store: Mutex<Option<EncryptedStore>>,
    identity: Mutex<Option<(String, String, IdentityPublic)>>,
    invite_approval: Mutex<()>,
    requires_rejoin_rooms: Mutex<HashSet<String>>,
}

#[cfg(not(feature = "native-e2e"))]
const MLS_KEYCHAIN_SERVICE: &str = "com.multaiplayer.desktop.room-secrets";
#[cfg(feature = "native-e2e")]
const MLS_KEYCHAIN_SERVICE: &str = "com.multaiplayer.desktop.native-e2e.room-secrets";
const MLS_IDENTITY_ACCOUNT: &str = "mls-identity:v1";
const MLS_HPKE_ACCOUNT: &str = "mls-hpke:v1";

fn delete_invite_verifier(capability_handle: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(
        MLS_KEYCHAIN_SERVICE,
        &format!("mls-invite-capability:{capability_handle}"),
    )
    .map_err(|_| "Failed to open invite verifier for cleanup".to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Failed to remove consumed invite verifier".to_string()),
    }
}

mod types;

pub(crate) use types::*;

mod invites;

pub(crate) use invites::*;

mod crypto_commands;
mod group_commands;
mod history_commands;
mod identity_commands;
mod store_support;

pub(crate) use crypto_commands::*;
pub(crate) use group_commands::*;
pub(crate) use history_commands::*;
pub(crate) use identity_commands::*;
use store_support::*;

#[cfg(test)]
mod tests;
