use crate::CliError;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde_json::Value;
use std::{collections::BTreeMap, io::Read, process::Command, time::Duration};

pub const KEYCHAIN_SERVICE: &str = "com.multaiplayer.cli";

pub trait CredentialStore {
    fn get(&self, account: &str) -> Result<Option<String>, CliError>;
    fn set(&self, account: &str, value: &str) -> Result<(), CliError>;
    fn delete(&self, account: &str) -> Result<(), CliError>;
}

#[derive(Default)]
pub struct KeychainStore;

impl KeychainStore {
    fn entry(account: &str) -> Result<keyring::Entry, CliError> {
        keyring::Entry::new(KEYCHAIN_SERVICE, account)
            .map_err(|_| CliError::CredentialStoreUnavailable)
    }
}

impl CredentialStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, CliError> {
        match Self::entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
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
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CliError::CredentialStoreUnavailable),
        }
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
}
