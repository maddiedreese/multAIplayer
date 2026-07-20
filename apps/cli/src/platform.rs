use crate::CliError;
#[cfg(target_os = "macos")]
use keyring_core::{api::CredentialStoreApi, Entry};
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde_json::Value;
#[cfg(all(target_os = "macos", not(debug_assertions)))]
use std::collections::HashMap;
use std::{collections::BTreeMap, io::Read, process::Command, time::Duration};

#[cfg(any(test, debug_assertions))]
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const KEYCHAIN_SERVICE: &str = "com.multaiplayer.cli";
#[cfg(not(debug_assertions))]
const KEYCHAIN_ACCESS_GROUP: &str = "AXP55K75AX.com.multaiplayer.cli";
#[cfg(debug_assertions)]
pub const KEYCHAIN_BACKEND: &str = "data-protection-keychain-default-group";
#[cfg(not(debug_assertions))]
pub const KEYCHAIN_BACKEND: &str = "data-protection-keychain";

pub trait CredentialStore {
    fn get(&self, account: &str) -> Result<Option<String>, CliError>;
    fn set(&self, account: &str, value: &str) -> Result<(), CliError>;
    fn delete(&self, account: &str) -> Result<(), CliError>;
}

#[derive(Default)]
pub struct KeychainStore;

impl KeychainStore {
    #[cfg(target_os = "macos")]
    fn entry(account: &str) -> Result<Entry, CliError> {
        #[cfg(debug_assertions)]
        let store = apple_native_keyring_store::protected::Store::new();
        #[cfg(not(debug_assertions))]
        let store = {
            let configuration = HashMap::from([("access-group", KEYCHAIN_ACCESS_GROUP)]);
            apple_native_keyring_store::protected::Store::new_with_configuration(&configuration)
        };

        store
            .and_then(|store| store.build(KEYCHAIN_SERVICE, account, None))
            .map_err(|_| CliError::CredentialStoreUnavailable)
    }

    #[cfg(not(target_os = "macos"))]
    fn entry(_account: &str) -> Result<(), CliError> {
        Err(CliError::CredentialStoreUnavailable)
    }

    #[cfg(target_os = "macos")]
    fn migrate_legacy_without_ui(
        account: &str,
        protected: &Entry,
    ) -> Result<Option<String>, CliError> {
        static MIGRATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

        let _migration = MIGRATION_LOCK
            .lock()
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        match protected.get_password() {
            Ok(value) => return Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => {}
            Err(_) => return Err(CliError::CredentialStoreUnavailable),
        }

        let _interaction =
            security_framework::os::macos::keychain::SecKeychain::disable_user_interaction()
                .map_err(|_| CliError::CredentialStoreUnavailable)?;
        let legacy = apple_native_keyring_store::keychain::Store::new()
            .and_then(|store| store.build(KEYCHAIN_SERVICE, account, None))
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        let Some(value) = classify_legacy_read(legacy.get_password())? else {
            return Ok(None);
        };
        protected
            .set_password(&value)
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        let _ = legacy.delete_credential();
        Ok(Some(value))
    }
}

#[cfg(target_os = "macos")]
fn classify_legacy_read(
    result: Result<String, keyring_core::Error>,
) -> Result<Option<String>, CliError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(_) => Err(CliError::CredentialStoreUnavailable),
    }
}

impl CredentialStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, CliError> {
        let entry = Self::entry(account)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Self::migrate_legacy_without_ui(account, &entry),
            Err(_) => Err(CliError::CredentialStoreUnavailable),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CliError> {
        Self::entry(account)?
            .set_password(value)
            .map_err(|_| CliError::CredentialStoreUnavailable)
    }

    fn delete(&self, account: &str) -> Result<(), CliError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(CliError::CredentialStoreUnavailable),
        }
    }
}

/// File-backed credential adapter used only by debug journey binaries. Release
/// builds cannot select it, and the normal CLI always uses macOS Keychain.
#[cfg(any(test, debug_assertions))]
pub struct JourneyFileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

#[cfg(any(test, debug_assertions))]
impl JourneyFileStore {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, CliError> {
        let path = path.as_ref().to_path_buf();
        if !path.is_absolute() {
            return Err(CliError::CredentialStoreUnavailable);
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|_| CliError::CredentialStoreUnavailable)?;
        }
        Ok(Self {
            path,
            lock: Mutex::new(()),
        })
    }

    fn load(&self) -> Result<BTreeMap<String, String>, CliError> {
        match fs::read(&self.path) {
            Ok(bytes) if bytes.len() <= 1_048_576 => {
                serde_json::from_slice(&bytes).map_err(|_| CliError::CredentialStoreUnavailable)
            }
            Ok(_) => Err(CliError::CredentialStoreUnavailable),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(_) => Err(CliError::CredentialStoreUnavailable),
        }
    }

    fn save(&self, values: &BTreeMap<String, String>) -> Result<(), CliError> {
        let bytes = serde_json::to_vec(values).map_err(|_| CliError::CredentialStoreUnavailable)?;
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, bytes).map_err(|_| CliError::CredentialStoreUnavailable)?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        fs::rename(temporary, &self.path).map_err(|_| CliError::CredentialStoreUnavailable)
    }
}

#[cfg(any(test, debug_assertions))]
impl CredentialStore for JourneyFileStore {
    fn get(&self, account: &str) -> Result<Option<String>, CliError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        Ok(self.load()?.remove(account))
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CliError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        let mut values = self.load()?;
        values.insert(account.to_owned(), value.to_owned());
        self.save(&values)
    }

    fn delete(&self, account: &str) -> Result<(), CliError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        let mut values = self.load()?;
        values.remove(account);
        self.save(&values)
    }
}

pub struct HttpResponse {
    pub status: u16,
    pub final_url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

pub trait HttpClient {
    fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError>;
    fn post_json(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        body: &Value,
    ) -> Result<HttpResponse, CliError>;
    fn patch_json(
        &self,
        _url: &str,
        _headers: &[(&str, &str)],
        _body: &Value,
    ) -> Result<HttpResponse, CliError> {
        Err(CliError::RelayUnavailable)
    }
    fn post_json_bytes(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Result<HttpResponse, CliError> {
        let value = serde_json::from_slice(body).map_err(|_| CliError::RelayUnavailable)?;
        self.post_json(url, headers, &value)
    }
    fn delete(&self, _url: &str, _headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
        Err(CliError::RelayUnavailable)
    }
}

pub struct ReqwestHttpClient {
    client: Client,
}

impl ReqwestHttpClient {
    pub fn new() -> Result<Self, CliError> {
        let client = Client::builder()
            .user_agent("multAIplayer-alpha")
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| CliError::GitHubUnavailable)?;
        Ok(Self { client })
    }

    fn collect(response: reqwest::blocking::Response) -> Result<HttpResponse, CliError> {
        const MAX_RESPONSE_BYTES: u64 = 1_048_576;
        let status = response.status().as_u16();
        let final_url = response.url().as_str().to_owned();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_owned(), value.to_owned()))
            })
            .collect();
        let mut body = Vec::new();
        response
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|_| CliError::RelayUnavailable)?;
        if body.len() as u64 > MAX_RESPONSE_BYTES {
            return Err(CliError::RelayUnavailable);
        }
        Ok(HttpResponse {
            status,
            final_url,
            headers,
            body,
        })
    }

    fn headers(values: &[(&str, &str)]) -> Result<HeaderMap, CliError> {
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            headers.insert(
                name.parse::<HeaderName>()
                    .map_err(|_| CliError::RelayUnavailable)?,
                value
                    .parse::<HeaderValue>()
                    .map_err(|_| CliError::RelayUnavailable)?,
            );
        }
        Ok(headers)
    }
}

impl HttpClient for ReqwestHttpClient {
    fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
        let response = self
            .client
            .get(url)
            .headers(Self::headers(headers)?)
            .send()
            .map_err(|_| CliError::RelayUnavailable)?;
        Self::collect(response)
    }

    fn post_json(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        body: &Value,
    ) -> Result<HttpResponse, CliError> {
        let response = self
            .client
            .post(url)
            .headers(Self::headers(headers)?)
            .json(body)
            .send()
            .map_err(|_| CliError::RelayUnavailable)?;
        Self::collect(response)
    }

    fn post_json_bytes(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Result<HttpResponse, CliError> {
        let mut request_headers = Self::headers(headers)?;
        request_headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let response = self
            .client
            .post(url)
            .headers(request_headers)
            .body(body.to_vec())
            .send()
            .map_err(|_| CliError::RelayUnavailable)?;
        Self::collect(response)
    }

    fn patch_json(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        body: &Value,
    ) -> Result<HttpResponse, CliError> {
        let response = self
            .client
            .patch(url)
            .headers(Self::headers(headers)?)
            .json(body)
            .send()
            .map_err(|_| CliError::RelayUnavailable)?;
        Self::collect(response)
    }

    fn delete(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
        let response = self
            .client
            .delete(url)
            .headers(Self::headers(headers)?)
            .send()
            .map_err(|_| CliError::RelayUnavailable)?;
        Self::collect(response)
    }
}

pub trait TrustedUrlOpener {
    fn open(&self, url: &str) -> Result<(), CliError>;
}

#[derive(Default)]
pub struct MacOsUrlOpener;

impl TrustedUrlOpener for MacOsUrlOpener {
    fn open(&self, url: &str) -> Result<(), CliError> {
        let parsed = Url::parse(url).map_err(|_| CliError::UrlOpenFailed)?;
        if parsed.as_str() != "https://github.com/login/device" {
            return Err(CliError::UrlOpenFailed);
        }
        let status = Command::new("open")
            .arg(parsed.as_str())
            .status()
            .map_err(|_| CliError::UrlOpenFailed)?;
        if status.success() {
            Ok(())
        } else {
            Err(CliError::UrlOpenFailed)
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};

    #[derive(Default)]
    pub struct MemoryCredentialStore {
        pub values: RefCell<HashMap<String, String>>,
        pub fail_reads: RefCell<bool>,
        pub fail_writes: RefCell<bool>,
        pub fail_set_account: RefCell<Option<String>>,
        pub fail_deletes: RefCell<bool>,
    }

    impl CredentialStore for MemoryCredentialStore {
        fn get(&self, account: &str) -> Result<Option<String>, CliError> {
            if *self.fail_reads.borrow() {
                return Err(CliError::CredentialStoreUnavailable);
            }
            Ok(self.values.borrow().get(account).cloned())
        }

        fn set(&self, account: &str, value: &str) -> Result<(), CliError> {
            if *self.fail_writes.borrow()
                || self.fail_set_account.borrow().as_deref() == Some(account)
            {
                return Err(CliError::CredentialStoreUnavailable);
            }
            self.values
                .borrow_mut()
                .insert(account.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), CliError> {
            if *self.fail_deletes.borrow() {
                return Err(CliError::CredentialStoreUnavailable);
            }
            self.values.borrow_mut().remove(account);
            Ok(())
        }
    }

    #[test]
    fn keychain_namespace_is_cli_specific() {
        assert_eq!(KEYCHAIN_SERVICE, "com.multaiplayer.cli");
        assert!(!KEYCHAIN_SERVICE.contains("desktop"));
    }

    #[test]
    fn credential_backend_is_explicit_for_the_build_mode() {
        #[cfg(debug_assertions)]
        assert_eq!(KEYCHAIN_BACKEND, "data-protection-keychain-default-group");
        #[cfg(not(debug_assertions))]
        assert_eq!(KEYCHAIN_BACKEND, "data-protection-keychain");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_access_denial_is_not_misclassified_as_missing_key_material() {
        assert!(matches!(
            classify_legacy_read(Err(keyring_core::Error::NoEntry)),
            Ok(None)
        ));
        let denied =
            keyring_core::Error::NoStorageAccess(Box::new(std::io::Error::other("locked")));
        assert!(matches!(
            classify_legacy_read(Err(denied)),
            Err(CliError::CredentialStoreUnavailable)
        ));
    }
}
