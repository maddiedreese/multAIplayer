#[cfg(all(not(test), target_os = "macos"))]
use keyring_core::{api::CredentialStoreApi, Entry};
#[cfg(all(not(test), not(debug_assertions), target_os = "macos"))]
use std::collections::HashMap;

#[cfg(test)]
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

#[cfg(all(not(debug_assertions), target_os = "macos"))]
const DESKTOP_KEYCHAIN_ACCESS_GROUP: &str = "AXP55K75AX.com.multaiplayer.desktop";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CredentialStoreError {
    #[cfg_attr(all(not(test), not(target_os = "macos")), allow(dead_code))]
    NoEntry,
    Unavailable,
}

pub(crate) struct CredentialEntry {
    #[cfg(all(not(test), target_os = "macos"))]
    inner: Entry,
    #[cfg(any(test, target_os = "macos"))]
    service: String,
    #[cfg(any(test, target_os = "macos"))]
    account: String,
}

impl CredentialEntry {
    pub(crate) fn get_password(&self) -> Result<String, CredentialStoreError> {
        #[cfg(all(not(test), target_os = "macos"))]
        {
            match self.inner.get_password().map_err(map_error) {
                Err(CredentialStoreError::NoEntry) => self.migrate_legacy_without_ui(),
                result => result,
            }
        }
        #[cfg(all(not(test), not(target_os = "macos")))]
        {
            Err(CredentialStoreError::Unavailable)
        }
        #[cfg(test)]
        {
            test_credentials()
                .lock()
                .map_err(|_| CredentialStoreError::Unavailable)?
                .get(&(self.service.clone(), self.account.clone()))
                .cloned()
                .ok_or(CredentialStoreError::NoEntry)
        }
    }

    #[cfg(all(not(test), target_os = "macos"))]
    fn migrate_legacy_without_ui(&self) -> Result<String, CredentialStoreError> {
        static MIGRATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

        let _migration = MIGRATION_LOCK
            .lock()
            .map_err(|_| CredentialStoreError::Unavailable)?;
        // Another caller may have completed the migration while this caller waited.
        match self.inner.get_password() {
            Ok(value) => return Ok(value),
            Err(keyring_core::Error::NoEntry) => {}
            Err(_) => return Err(CredentialStoreError::Unavailable),
        }

        // The legacy Keychain API can display an ACL prompt. Disable UI process-wide
        // for the bounded migration attempt so a denied old item becomes a clean miss.
        let _interaction =
            security_framework::os::macos::keychain::SecKeychain::disable_user_interaction()
                .map_err(|_| CredentialStoreError::Unavailable)?;
        let legacy = apple_native_keyring_store::keychain::Store::new()
            .and_then(|store| store.build(&self.service, &self.account, None))
            .map_err(|_| CredentialStoreError::Unavailable)?;
        let value =
            classify_legacy_read(legacy.get_password())?.ok_or(CredentialStoreError::NoEntry)?;
        self.inner.set_password(&value).map_err(map_error)?;
        let _ = legacy.delete_credential();
        Ok(value)
    }

    pub(crate) fn set_password(&self, value: &str) -> Result<(), CredentialStoreError> {
        #[cfg(all(not(test), target_os = "macos"))]
        {
            self.inner.set_password(value).map_err(map_error)
        }
        #[cfg(all(not(test), not(target_os = "macos")))]
        {
            let _ = value;
            Err(CredentialStoreError::Unavailable)
        }
        #[cfg(test)]
        {
            test_credentials()
                .lock()
                .map_err(|_| CredentialStoreError::Unavailable)?
                .insert(
                    (self.service.clone(), self.account.clone()),
                    value.to_owned(),
                );
            Ok(())
        }
    }

    pub(crate) fn delete_credential(&self) -> Result<(), CredentialStoreError> {
        #[cfg(all(not(test), target_os = "macos"))]
        {
            self.inner.delete_credential().map_err(map_error)
        }
        #[cfg(all(not(test), not(target_os = "macos")))]
        {
            Err(CredentialStoreError::Unavailable)
        }
        #[cfg(test)]
        {
            let removed = test_credentials()
                .lock()
                .map_err(|_| CredentialStoreError::Unavailable)?
                .remove(&(self.service.clone(), self.account.clone()));
            removed.map(|_| ()).ok_or(CredentialStoreError::NoEntry)
        }
    }
}

pub(crate) fn credential_entry(
    service: &str,
    account: &str,
) -> Result<CredentialEntry, CredentialStoreError> {
    if service.is_empty() || account.is_empty() {
        return Err(CredentialStoreError::Unavailable);
    }

    #[cfg(all(not(test), target_os = "macos"))]
    {
        let store = protected_store()?;
        let inner = store.build(service, account, None).map_err(map_error)?;
        Ok(CredentialEntry {
            inner,
            service: service.to_owned(),
            account: account.to_owned(),
        })
    }
    #[cfg(all(not(test), not(target_os = "macos")))]
    {
        Err(CredentialStoreError::Unavailable)
    }
    #[cfg(test)]
    {
        Ok(CredentialEntry {
            service: service.to_owned(),
            account: account.to_owned(),
        })
    }
}

#[cfg(all(not(test), target_os = "macos"))]
fn protected_store(
) -> Result<std::sync::Arc<apple_native_keyring_store::protected::Store>, CredentialStoreError> {
    #[cfg(debug_assertions)]
    let store = apple_native_keyring_store::protected::Store::new();

    // Official builds use an app-private access group authorized by the embedded
    // Developer ID provisioning profile. The default WhenUnlocked policy never
    // requests interactive Keychain authorization.
    #[cfg(not(debug_assertions))]
    let store = {
        let configuration = HashMap::from([("access-group", DESKTOP_KEYCHAIN_ACCESS_GROUP)]);
        apple_native_keyring_store::protected::Store::new_with_configuration(&configuration)
    };

    store.map_err(map_error)
}

#[cfg(all(not(test), target_os = "macos"))]
fn map_error(error: keyring_core::Error) -> CredentialStoreError {
    match error {
        keyring_core::Error::NoEntry => CredentialStoreError::NoEntry,
        _ => CredentialStoreError::Unavailable,
    }
}

#[cfg(target_os = "macos")]
fn classify_legacy_read(
    result: Result<String, keyring_core::Error>,
) -> Result<Option<String>, CredentialStoreError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(_) => Err(CredentialStoreError::Unavailable),
    }
}

#[cfg(test)]
fn test_credentials() -> &'static Mutex<HashMap<(String, String), String>> {
    static CREDENTIALS: OnceLock<Mutex<HashMap<(String, String), String>>> = OnceLock::new();
    CREDENTIALS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adapter_does_not_access_the_real_keychain() {
        let entry = credential_entry("test.service", "account").unwrap();
        assert_eq!(entry.get_password(), Err(CredentialStoreError::NoEntry));
        entry.set_password("secret").unwrap();
        assert_eq!(entry.get_password().as_deref(), Ok("secret"));
        entry.delete_credential().unwrap();
        assert_eq!(entry.get_password(), Err(CredentialStoreError::NoEntry));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_access_denial_is_not_misclassified_as_a_missing_identity() {
        assert_eq!(
            classify_legacy_read(Err(keyring_core::Error::NoEntry)),
            Ok(None)
        );
        let denied =
            keyring_core::Error::NoStorageAccess(Box::new(std::io::Error::other("locked")));
        assert_eq!(
            classify_legacy_read(Err(denied)),
            Err(CredentialStoreError::Unavailable)
        );
    }
}
