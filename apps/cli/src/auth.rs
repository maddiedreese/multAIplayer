use crate::{
    identity::{load_or_create_identity, DeviceIdentityPublic},
    platform::{CredentialStore, HttpClient, HttpResponse, TrustedUrlOpener},
    CliError,
};
use reqwest::Url;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub const GITHUB_TOKEN_ACCOUNT: &str = "github-identity-token:v2";
pub const RELAY_SESSION_ACCOUNT: &str = "relay-session:v1";
const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_VERIFICATION_URL: &str = "https://github.com/login/device";
const MAX_TOKEN_CHARS: usize = 8192;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignedInUser {
    pub id: String,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

pub struct PendingLogin {
    device_code: Zeroizing<String>,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    started_at: Instant,
}

impl PendingLogin {
    pub fn instructions(&self) -> String {
        format!(
            "Open {} and enter code {}",
            self.verification_uri, self.user_code
        )
    }

    pub fn is_expired(&self) -> bool {
        self.started_at.elapsed() >= Duration::from_secs(self.expires_in)
    }

    pub fn next_poll_delay(&self, requested_seconds: u64) -> Duration {
        Duration::from_secs(self.expires_in)
            .saturating_sub(self.started_at.elapsed())
            .min(Duration::from_secs(requested_seconds.max(1)))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedSession {
    pub user: SignedInUser,
    pub relay_origin: String,
    pub device: DeviceIdentityPublic,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoredSession {
    pub user: SignedInUser,
    pub relay_origin: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DevicePollResult {
    Pending,
    SlowDown { retry_after_seconds: u64 },
    Complete(Box<AuthenticatedSession>),
}

pub struct AuthClient<'a, S, H> {
    store: &'a S,
    http: &'a H,
    github_client_id: String,
    relay_origin: String,
}

impl<'a, S: CredentialStore, H: HttpClient> AuthClient<'a, S, H> {
    pub fn new(
        store: &'a S,
        http: &'a H,
        github_client_id: &str,
        relay_origin: &str,
    ) -> Result<Self, CliError> {
        let github_client_id = validate_client_id(github_client_id)?;
        let relay_origin = validate_relay_origin(relay_origin)?;
        Ok(Self {
            store,
            http,
            github_client_id,
            relay_origin,
        })
    }

    pub fn start_login(&self) -> Result<PendingLogin, CliError> {
        let response = self.http.post_json(
            GITHUB_DEVICE_CODE_URL,
            &[("accept", "application/json")],
            &json!({ "client_id": self.github_client_id, "scope": "read:user" }),
        )?;
        require_exact_response_url(
            &response,
            GITHUB_DEVICE_CODE_URL,
            CliError::GitHubUnavailable,
        )?;
        if !(200..300).contains(&response.status) {
            return Err(CliError::GitHubUnavailable);
        }
        let body: DeviceCodeResponse = decode_json(&response, CliError::InvalidGitHubResponse)?;
        if body.device_code.is_empty()
            || body.device_code.len() > 1024
            || body.user_code.is_empty()
            || body.user_code.len() > 64
            || body.user_code.chars().any(char::is_control)
            || body.verification_uri != GITHUB_VERIFICATION_URL
            || body.expires_in == 0
            || body.expires_in > 3600
            || body.interval == 0
            || body.interval > 60
        {
            return Err(CliError::InvalidGitHubResponse);
        }
        Ok(PendingLogin {
            device_code: Zeroizing::new(body.device_code),
            user_code: body.user_code,
            verification_uri: body.verification_uri,
            expires_in: body.expires_in,
            interval: body.interval,
            started_at: Instant::now(),
        })
    }

    pub fn open_login_url(
        &self,
        login: &PendingLogin,
        opener: &impl TrustedUrlOpener,
    ) -> Result<(), CliError> {
        if login.verification_uri != GITHUB_VERIFICATION_URL {
            return Err(CliError::UrlOpenFailed);
        }
        opener.open(&login.verification_uri)
    }

    pub fn poll_login(&self, login: &PendingLogin) -> Result<DevicePollResult, CliError> {
        if login.is_expired() {
            return Err(CliError::AuthorizationExpired);
        }
        let response = self.http.post_json(
            GITHUB_TOKEN_URL,
            &[("accept", "application/json")],
            &json!({
                "client_id": self.github_client_id,
                "device_code": login.device_code.as_str(),
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            }),
        )?;
        require_exact_response_url(&response, GITHUB_TOKEN_URL, CliError::GitHubUnavailable)?;
        if !(200..300).contains(&response.status) {
            return Err(CliError::GitHubUnavailable);
        }
        let body: TokenResponse = decode_json(&response, CliError::InvalidGitHubResponse)?;
        if let Some(token) = body.access_token {
            validate_access_token(&token)?;
            validate_granted_scopes(body.scope.as_deref().unwrap_or_default())?;
            return self
                .finish_login(Zeroizing::new(token))
                .map(Box::new)
                .map(DevicePollResult::Complete);
        }
        match body.error.as_deref() {
            Some("authorization_pending") => Ok(DevicePollResult::Pending),
            Some("slow_down") => Ok(DevicePollResult::SlowDown {
                retry_after_seconds: 5,
            }),
            Some("access_denied") => Err(CliError::AuthorizationDenied),
            Some("expired_token") => Err(CliError::AuthorizationExpired),
            _ => Err(CliError::InvalidGitHubResponse),
        }
    }

    pub fn restore_session(&self) -> Result<Option<RestoredSession>, CliError> {
        let Some(encoded) = self.store.get(RELAY_SESSION_ACCOUNT)? else {
            return Ok(None);
        };
        let record: StoredRelaySession =
            serde_json::from_str(&encoded).map_err(|_| CliError::InvalidStoredCredential)?;
        if record.version != 1 || record.relay_origin != self.relay_origin {
            return Err(CliError::RelayOriginMismatch);
        }
        validate_relay_session(&record.session)?;
        let endpoint = endpoint(&self.relay_origin, "/auth/me")?;
        let cookie = format!("multaiplayer_session={}", record.session);
        let response = self.http.get(&endpoint, &[("cookie", &cookie)])?;
        require_exact_response_url(&response, &endpoint, CliError::RelayUnavailable)?;
        if response.status == 401 {
            return Ok(None);
        }
        if !(200..300).contains(&response.status) {
            return Err(CliError::RelayUnavailable);
        }
        let body: UserResponse = decode_json(&response, CliError::RelayUnavailable)?;
        let user = validate_user(body.user)?;
        Ok(Some(RestoredSession {
            user,
            relay_origin: self.relay_origin.clone(),
        }))
    }

    pub fn logout(&self) -> Result<(), CliError> {
        let stored = self.store.get(RELAY_SESSION_ACCOUNT);
        let network_result = match stored {
            Ok(Some(encoded)) => self.logout_relay_session(&encoded),
            Ok(None) => Ok(()),
            Err(error) => Err(error),
        };
        let session_delete = self.store.delete(RELAY_SESSION_ACCOUNT);
        let token_delete = self.store.delete(GITHUB_TOKEN_ACCOUNT);

        network_result?;
        session_delete?;
        token_delete?;
        Ok(())
    }

    fn finish_login(&self, token: Zeroizing<String>) -> Result<AuthenticatedSession, CliError> {
        let endpoint = endpoint(&self.relay_origin, "/auth/github/verify")?;
        let response =
            self.http
                .post_json(&endpoint, &[], &json!({ "access_token": token.as_str() }))?;
        require_exact_response_url(&response, &endpoint, CliError::RelayUnavailable)?;
        if !(200..300).contains(&response.status) {
            return Err(CliError::RelayUnavailable);
        }
        let body: UserResponse = decode_json(&response, CliError::RelayUnavailable)?;
        let user = validate_user(body.user)?;
        let session = session_cookie(&response)?;
        let display_name = user.name.as_deref().unwrap_or(&user.login);
        let device = load_or_create_identity(self.store, &user.id, display_name)?;
        self.register_device(&session, &device.public)?;

        let record = StoredRelaySession {
            version: 1,
            relay_origin: self.relay_origin.clone(),
            session: session.clone(),
        };
        let encoded_session =
            serde_json::to_string(&record).map_err(|_| CliError::CredentialStoreUnavailable)?;
        let github_credential = StoredGitHubCredential {
            version: 1,
            relay_origin: self.relay_origin.clone(),
            token: token.to_string(),
        };
        let encoded_github_credential = serde_json::to_string(&github_credential)
            .map_err(|_| CliError::CredentialStoreUnavailable)?;
        if let Err(error) = self
            .store
            .set(GITHUB_TOKEN_ACCOUNT, &encoded_github_credential)
        {
            let _ = self.store.delete(GITHUB_TOKEN_ACCOUNT);
            let _ = self.store.delete(RELAY_SESSION_ACCOUNT);
            return Err(error);
        }
        if let Err(error) = self.store.set(RELAY_SESSION_ACCOUNT, &encoded_session) {
            let _ = self.store.delete(GITHUB_TOKEN_ACCOUNT);
            let _ = self.store.delete(RELAY_SESSION_ACCOUNT);
            return Err(error);
        }
        Ok(AuthenticatedSession {
            user,
            relay_origin: self.relay_origin.clone(),
            device: device.public,
        })
    }

    fn register_device(
        &self,
        session: &str,
        device: &DeviceIdentityPublic,
    ) -> Result<(), CliError> {
        let endpoint = endpoint(&self.relay_origin, "/devices")?;
        let cookie = format!("multaiplayer_session={session}");
        let body = serde_json::to_value(device).map_err(|_| CliError::IdentityUnavailable)?;
        let response = self
            .http
            .post_json(&endpoint, &[("cookie", &cookie)], &body)?;
        require_exact_response_url(&response, &endpoint, CliError::RelayUnavailable)?;
        if !matches!(response.status, 200 | 201) {
            return Err(CliError::RelayUnavailable);
        }
        let registered: DeviceResponse = decode_json(&response, CliError::RelayUnavailable)?;
        if registered.device != *device {
            return Err(CliError::RelayUnavailable);
        }
        Ok(())
    }

    fn logout_relay_session(&self, encoded: &str) -> Result<(), CliError> {
        let record: StoredRelaySession =
            serde_json::from_str(encoded).map_err(|_| CliError::InvalidStoredCredential)?;
        if record.version != 1 || record.relay_origin != self.relay_origin {
            return Err(CliError::RelayOriginMismatch);
        }
        validate_relay_session(&record.session)?;
        let endpoint = endpoint(&self.relay_origin, "/auth/logout")?;
        let cookie = format!("multaiplayer_session={}", record.session);
        let response = self
            .http
            .post_json(&endpoint, &[("cookie", &cookie)], &json!({}))?;
        require_exact_response_url(&response, &endpoint, CliError::RelayUnavailable)?;
        if !(200..300).contains(&response.status) {
            return Err(CliError::RelayUnavailable);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    scope: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct UserResponse {
    user: SignedInUser,
}

#[derive(Deserialize)]
struct DeviceResponse {
    device: DeviceIdentityPublic,
}

#[derive(Serialize, Deserialize)]
struct StoredRelaySession {
    version: u8,
    relay_origin: String,
    session: String,
}

pub(crate) struct RelayTransportSession {
    pub origin: String,
    pub secret: Zeroizing<String>,
}

pub(crate) fn load_relay_transport_session(
    store: &impl CredentialStore,
    expected_origin: &str,
) -> Result<Option<RelayTransportSession>, CliError> {
    let expected_origin = validate_relay_origin(expected_origin)?;
    let Some(encoded) = store.get(RELAY_SESSION_ACCOUNT)? else {
        return Ok(None);
    };
    let record: StoredRelaySession =
        serde_json::from_str(&encoded).map_err(|_| CliError::InvalidStoredCredential)?;
    if record.version != 1 || record.relay_origin != expected_origin {
        return Err(CliError::RelayOriginMismatch);
    }
    validate_relay_session(&record.session)?;
    Ok(Some(RelayTransportSession {
        origin: record.relay_origin,
        secret: Zeroizing::new(record.session),
    }))
}

#[derive(Serialize, Deserialize)]
struct StoredGitHubCredential {
    version: u8,
    relay_origin: String,
    token: String,
}

fn validate_client_id(value: &str) -> Result<String, CliError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || !value.chars().all(|c| c.is_ascii_alphanumeric()) {
        Err(CliError::GitHubNotConfigured)
    } else {
        Ok(value.to_owned())
    }
}

pub(crate) fn validate_relay_origin(value: &str) -> Result<String, CliError> {
    let url = Url::parse(value).map_err(|_| CliError::RelayOriginMismatch)?;
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(CliError::RelayOriginMismatch);
    }
    Ok(url.origin().ascii_serialization())
}

pub(crate) fn endpoint(origin: &str, path: &str) -> Result<String, CliError> {
    let origin = Url::parse(origin).map_err(|_| CliError::RelayOriginMismatch)?;
    origin
        .join(path)
        .map(|url| url.to_string())
        .map_err(|_| CliError::RelayOriginMismatch)
}

fn require_exact_response_url(
    response: &HttpResponse,
    expected: &str,
    error: CliError,
) -> Result<(), CliError> {
    if response.final_url == expected {
        Ok(())
    } else {
        Err(error)
    }
}

fn decode_json<T: DeserializeOwned>(
    response: &HttpResponse,
    error: CliError,
) -> Result<T, CliError> {
    if response.body.len() > 1_048_576 {
        return Err(error);
    }
    serde_json::from_slice(&response.body).map_err(|_| error)
}

fn validate_access_token(token: &str) -> Result<(), CliError> {
    if token.is_empty() || token.len() > MAX_TOKEN_CHARS || token.chars().any(char::is_whitespace) {
        Err(CliError::InvalidGitHubResponse)
    } else {
        Ok(())
    }
}

fn validate_granted_scopes(value: &str) -> Result<(), CliError> {
    let scopes = value
        .split([',', ' '])
        .filter(|scope| !scope.is_empty())
        .collect::<Vec<_>>();
    if scopes == ["read:user"] {
        Ok(())
    } else {
        Err(CliError::InvalidGitHubResponse)
    }
}

fn validate_user(user: SignedInUser) -> Result<SignedInUser, CliError> {
    if !user.id.starts_with("github:")
        || !valid_text(&user.id, 256)
        || !valid_text(&user.login, 120)
        || user
            .name
            .as_deref()
            .is_some_and(|name| !valid_text(name, 120))
    {
        return Err(CliError::RelayUnavailable);
    }
    if let Some(avatar) = &user.avatar_url {
        let url = Url::parse(avatar).map_err(|_| CliError::RelayUnavailable)?;
        let host = url.host_str().unwrap_or_default();
        if url.scheme() != "https"
            || url.username() != ""
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
            || !(host == "github.com"
                || host == "githubusercontent.com"
                || host.ends_with(".githubusercontent.com"))
        {
            return Err(CliError::RelayUnavailable);
        }
    }
    Ok(user)
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

fn session_cookie(response: &HttpResponse) -> Result<String, CliError> {
    let value = response
        .headers
        .get("set-cookie")
        .and_then(|header| header.split(';').next())
        .and_then(|cookie| cookie.strip_prefix("multaiplayer_session="))
        .ok_or(CliError::RelayUnavailable)?;
    validate_relay_session(value)?;
    Ok(value.to_owned())
}

fn validate_relay_session(value: &str) -> Result<(), CliError> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        Err(CliError::InvalidStoredCredential)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        identity::{HPKE_IDENTITY_ACCOUNT, SIGNING_IDENTITY_ACCOUNT},
        platform::{tests::MemoryCredentialStore, TrustedUrlOpener},
    };
    use serde_json::Value;
    use std::{cell::RefCell, collections::VecDeque};

    const RELAY: &str = "https://relay.example.com";
    const CLIENT_ID: &str = "Client123";
    const ACCESS_TOKEN: &str = "github_access_token_value_1234567890";
    const SESSION: &str = "relay_session_value_1234567890";

    #[derive(Clone)]
    struct RecordedRequest {
        method: &'static str,
        url: String,
        headers: Vec<(String, String)>,
        body: Option<Value>,
    }

    #[derive(Default)]
    struct MockHttp {
        responses: RefCell<VecDeque<Result<HttpResponse, CliError>>>,
        requests: RefCell<Vec<RecordedRequest>>,
    }

    impl MockHttp {
        fn push(&self, response: HttpResponse) {
            self.responses.borrow_mut().push_back(Ok(response));
        }

        fn respond(url: &str, status: u16, body: Value) -> HttpResponse {
            HttpResponse {
                status,
                final_url: url.to_owned(),
                headers: Default::default(),
                body: serde_json::to_vec(&body).unwrap(),
            }
        }

        fn take(&self) -> Result<HttpResponse, CliError> {
            self.responses.borrow_mut().pop_front().unwrap()
        }
    }

    impl HttpClient for MockHttp {
        fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
            self.requests.borrow_mut().push(RecordedRequest {
                method: "GET",
                url: url.to_owned(),
                headers: headers
                    .iter()
                    .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                    .collect(),
                body: None,
            });
            self.take()
        }

        fn post_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, CliError> {
            self.requests.borrow_mut().push(RecordedRequest {
                method: "POST",
                url: url.to_owned(),
                headers: headers
                    .iter()
                    .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                    .collect(),
                body: Some(body.clone()),
            });
            self.take()
        }
    }

    fn start_response() -> HttpResponse {
        MockHttp::respond(
            GITHUB_DEVICE_CODE_URL,
            200,
            json!({
                "device_code": "private-device-code",
                "user_code": "ABCD-EFGH",
                "verification_uri": GITHUB_VERIFICATION_URL,
                "expires_in": 900,
                "interval": 5
            }),
        )
    }

    fn completed_responses(http: &MockHttp) {
        http.push(MockHttp::respond(
            GITHUB_TOKEN_URL,
            200,
            json!({ "access_token": ACCESS_TOKEN, "scope": "read:user" }),
        ));
        let mut verify = MockHttp::respond(
            &format!("{RELAY}/auth/github/verify"),
            200,
            json!({ "user": { "id": "github:42", "login": "maddie", "name": "Maddie" } }),
        );
        verify.headers.insert(
            "set-cookie".to_owned(),
            format!("multaiplayer_session={SESSION}; Path=/; HttpOnly; Secure"),
        );
        http.push(verify);
    }

    fn device_response(request: &Value) -> HttpResponse {
        MockHttp::respond(
            &format!("{RELAY}/devices"),
            201,
            json!({ "device": request }),
        )
    }

    #[derive(Default)]
    struct RecordingOpener(RefCell<Vec<String>>);

    impl TrustedUrlOpener for RecordingOpener {
        fn open(&self, url: &str) -> Result<(), CliError> {
            self.0.borrow_mut().push(url.to_owned());
            Ok(())
        }
    }

    struct FailingOpener;

    impl TrustedUrlOpener for FailingOpener {
        fn open(&self, _url: &str) -> Result<(), CliError> {
            Err(CliError::UrlOpenFailed)
        }
    }

    #[test]
    fn device_flow_prints_only_public_values_and_opens_only_trusted_url() {
        let store = MemoryCredentialStore::default();
        let http = MockHttp::default();
        http.push(start_response());
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        let login = client.start_login().unwrap();
        assert_eq!(
            login.instructions(),
            "Open https://github.com/login/device and enter code ABCD-EFGH"
        );
        assert!(!login.instructions().contains("private-device-code"));
        let opener = RecordingOpener::default();
        client.open_login_url(&login, &opener).unwrap();
        assert_eq!(opener.0.borrow().as_slice(), [GITHUB_VERIFICATION_URL]);
        assert_eq!(
            client.open_login_url(&login, &FailingOpener),
            Err(CliError::UrlOpenFailed)
        );
        let request = http.requests.borrow().first().unwrap().clone();
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, GITHUB_DEVICE_CODE_URL);
        assert_eq!(
            request.body,
            Some(json!({ "client_id": CLIENT_ID, "scope": "read:user" }))
        );
        assert!(login.next_poll_delay(5) <= Duration::from_secs(5));
    }

    #[test]
    fn polling_covers_pending_slow_down_denied_and_invalid_outcomes() {
        for (body, expected) in [
            (
                json!({ "error": "authorization_pending" }),
                Ok(DevicePollResult::Pending),
            ),
            (
                json!({ "error": "slow_down" }),
                Ok(DevicePollResult::SlowDown {
                    retry_after_seconds: 5,
                }),
            ),
            (
                json!({ "error": "access_denied" }),
                Err(CliError::AuthorizationDenied),
            ),
            (
                json!({ "error": "unknown" }),
                Err(CliError::InvalidGitHubResponse),
            ),
        ] {
            let store = MemoryCredentialStore::default();
            let http = MockHttp::default();
            http.push(start_response());
            http.push(MockHttp::respond(GITHUB_TOKEN_URL, 200, body));
            let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
            let login = client.start_login().unwrap();
            assert_eq!(client.poll_login(&login), expected);
        }
    }

    #[test]
    fn polling_covers_http_and_transport_errors_without_exposing_device_code() {
        for response in [
            Ok(MockHttp::respond(
                GITHUB_TOKEN_URL,
                503,
                json!({ "error": "upstream" }),
            )),
            Err(CliError::GitHubUnavailable),
        ] {
            let store = MemoryCredentialStore::default();
            let http = MockHttp::default();
            http.push(start_response());
            http.responses.borrow_mut().push_back(response);
            let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
            let login = client.start_login().unwrap();
            let error = client.poll_login(&login).unwrap_err();
            assert!(!format!("{error:?} {error}").contains("private-device-code"));
        }
    }

    #[test]
    fn github_and_relay_redirects_fail_closed() {
        let store = MemoryCredentialStore::default();
        let http = MockHttp::default();
        let mut redirected_start = start_response();
        redirected_start.final_url = "https://evil.example/device".to_owned();
        http.push(redirected_start);
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        assert!(matches!(
            client.start_login(),
            Err(CliError::GitHubUnavailable)
        ));

        store.values.borrow_mut().insert(
            RELAY_SESSION_ACCOUNT.to_owned(),
            serde_json::to_string(&StoredRelaySession {
                version: 1,
                relay_origin: RELAY.to_owned(),
                session: SESSION.to_owned(),
            })
            .unwrap(),
        );
        let mut redirected_restore = MockHttp::respond(
            &format!("{RELAY}/auth/me"),
            200,
            json!({ "user": { "id": "github:42", "login": "maddie" } }),
        );
        redirected_restore.final_url = "https://evil.example/auth/me".to_owned();
        http.push(redirected_restore);
        assert_eq!(client.restore_session(), Err(CliError::RelayUnavailable));
    }

    #[test]
    fn response_bodies_are_bounded() {
        let store = MemoryCredentialStore::default();
        let http = MockHttp::default();
        http.push(HttpResponse {
            status: 200,
            final_url: GITHUB_DEVICE_CODE_URL.to_owned(),
            headers: Default::default(),
            body: vec![b'x'; 1_048_577],
        });
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        assert!(matches!(
            client.start_login(),
            Err(CliError::InvalidGitHubResponse)
        ));
    }

    #[test]
    fn completed_login_registers_desktop_compatible_device_and_redacts_secrets() {
        let store = MemoryCredentialStore::default();
        let http = MockHttp::default();
        http.push(start_response());
        completed_responses(&http);
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        let login = client.start_login().unwrap();

        // Registration echoes the exact request, matching the relay's current response contract.
        let placeholder = MockHttp::respond(&format!("{RELAY}/devices"), 500, json!({}));
        http.push(placeholder);
        let error = client.poll_login(&login).unwrap_err();
        assert_eq!(error, CliError::RelayUnavailable);
        let requests = http.requests.borrow();
        let registration = requests.last().unwrap();
        let body = registration.body.as_ref().unwrap();
        for field in [
            "userId",
            "deviceId",
            "displayName",
            "signaturePublicKey",
            "signatureKeyFingerprint",
            "hpkePublicKey",
            "hpkeKeyFingerprint",
        ] {
            assert!(body.get(field).is_some());
        }
        assert_eq!(requests[1].url, GITHUB_TOKEN_URL);
        assert_eq!(
            requests[1].body,
            Some(json!({
                "client_id": CLIENT_ID,
                "device_code": "private-device-code",
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            }))
        );
        assert_eq!(requests[2].url, format!("{RELAY}/auth/github/verify"));
        assert_eq!(
            requests[2].body,
            Some(json!({ "access_token": ACCESS_TOKEN }))
        );
        assert_eq!(registration.url, format!("{RELAY}/devices"));
        assert!(registration
            .headers
            .iter()
            .any(|(name, value)| name == "cookie"
                && value == &format!("multaiplayer_session={SESSION}")));
        let all_public_output = format!("{error:?} {error} {}", login.instructions());
        assert!(!all_public_output.contains(ACCESS_TOKEN));
        assert!(!all_public_output.contains(SESSION));
        assert!(!all_public_output.contains("private-device-code"));
    }

    #[test]
    fn completed_login_persists_origin_bound_session() {
        let store = MemoryCredentialStore::default();
        let http = MockHttp::default();
        http.push(start_response());
        completed_responses(&http);
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        let login = client.start_login().unwrap();

        // Derive the deterministic registration response from a first failed attempt's captured body.
        http.push(MockHttp::respond(
            &format!("{RELAY}/devices"),
            503,
            json!({}),
        ));
        assert!(client.poll_login(&login).is_err());
        let registration_body = http.requests.borrow().last().unwrap().body.clone().unwrap();

        completed_responses(&http);
        http.push(device_response(&registration_body));
        let result = client.poll_login(&login).unwrap();
        let DevicePollResult::Complete(session) = result else {
            panic!("completed login did not return a session");
        };
        assert!(!format!("{session:?}").contains(ACCESS_TOKEN));
        assert!(!format!("{session:?}").contains(SESSION));
        let github_credential: StoredGitHubCredential =
            serde_json::from_str(store.values.borrow().get(GITHUB_TOKEN_ACCOUNT).unwrap()).unwrap();
        assert_eq!(github_credential.version, 1);
        assert_eq!(github_credential.relay_origin, RELAY);
        assert_eq!(github_credential.token, ACCESS_TOKEN);
        let session = store
            .values
            .borrow()
            .get(RELAY_SESSION_ACCOUNT)
            .unwrap()
            .clone();
        assert!(session.contains(RELAY));
        assert!(session.contains(SESSION));
    }

    #[test]
    fn restoration_is_origin_bound_and_mismatch_fails_before_network() {
        let store = MemoryCredentialStore::default();
        store.values.borrow_mut().insert(
            RELAY_SESSION_ACCOUNT.to_owned(),
            serde_json::to_string(&StoredRelaySession {
                version: 1,
                relay_origin: RELAY.to_owned(),
                session: SESSION.to_owned(),
            })
            .unwrap(),
        );
        let http = MockHttp::default();
        let other = AuthClient::new(&store, &http, CLIENT_ID, "https://other.example.com").unwrap();
        assert_eq!(other.restore_session(), Err(CliError::RelayOriginMismatch));
        assert!(http.requests.borrow().is_empty());

        http.push(MockHttp::respond(
            &format!("{RELAY}/auth/me"),
            200,
            json!({ "user": { "id": "github:42", "login": "maddie" } }),
        ));
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        let restored = client.restore_session().unwrap().unwrap();
        assert_eq!(restored.relay_origin, RELAY);
        let request = http.requests.borrow().last().unwrap().clone();
        assert_eq!(request.method, "GET");
        assert_eq!(request.url, format!("{RELAY}/auth/me"));
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| name == "cookie" && value.contains(SESSION)));
    }

    #[test]
    fn non_default_https_relay_port_is_preserved_and_origin_bound() {
        const PORT_RELAY: &str = "https://relay.example.com:8443";
        let store = MemoryCredentialStore::default();
        store.values.borrow_mut().insert(
            RELAY_SESSION_ACCOUNT.to_owned(),
            serde_json::to_string(&StoredRelaySession {
                version: 1,
                relay_origin: PORT_RELAY.to_owned(),
                session: SESSION.to_owned(),
            })
            .unwrap(),
        );
        let http = MockHttp::default();
        http.push(MockHttp::respond(
            &format!("{PORT_RELAY}/auth/me"),
            200,
            json!({ "user": { "id": "github:42", "login": "maddie" } }),
        ));

        let port_client = AuthClient::new(&store, &http, CLIENT_ID, PORT_RELAY).unwrap();
        assert_eq!(port_client.relay_origin, PORT_RELAY);
        let restored = port_client.restore_session().unwrap().unwrap();
        assert_eq!(restored.relay_origin, PORT_RELAY);
        assert_eq!(
            http.requests.borrow().last().unwrap().url,
            format!("{PORT_RELAY}/auth/me")
        );

        let default_port_client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        assert_eq!(
            default_port_client.restore_session(),
            Err(CliError::RelayOriginMismatch)
        );
        assert_eq!(http.requests.borrow().len(), 1);
        assert_eq!(
            AuthClient::new(&store, &http, CLIENT_ID, "https://relay.example.com:443")
                .unwrap()
                .relay_origin,
            RELAY
        );
    }

    #[test]
    fn relay_origin_still_rejects_non_https_and_non_origin_inputs() {
        let store = MemoryCredentialStore::default();
        let http = MockHttp::default();
        for invalid in [
            "http://relay.example.com:8443",
            "https://user@relay.example.com",
            "https://user:password@relay.example.com",
            "https://relay.example.com/path",
            "https://relay.example.com?query=value",
            "https://relay.example.com#fragment",
            "not a URL",
        ] {
            assert!(matches!(
                AuthClient::new(&store, &http, CLIENT_ID, invalid),
                Err(CliError::RelayOriginMismatch)
            ));
        }
    }

    #[test]
    fn logout_removes_auth_but_retains_device_and_room_key_namespaces() {
        let store = MemoryCredentialStore::default();
        for (account, value) in [
            (GITHUB_TOKEN_ACCOUNT, ACCESS_TOKEN),
            (
                RELAY_SESSION_ACCOUNT,
                &serde_json::to_string(&StoredRelaySession {
                    version: 1,
                    relay_origin: RELAY.to_owned(),
                    session: SESSION.to_owned(),
                })
                .unwrap(),
            ),
            (SIGNING_IDENTITY_ACCOUNT, "signing-private-material"),
            (HPKE_IDENTITY_ACCOUNT, "hpke-private-material"),
            ("mls-group-state:v1", "mls-key-material"),
            ("room-state-wrap:v1", "room-key-material"),
        ] {
            store
                .values
                .borrow_mut()
                .insert(account.to_owned(), value.to_owned());
        }
        let http = MockHttp::default();
        http.push(MockHttp::respond(
            &format!("{RELAY}/auth/logout"),
            200,
            json!({ "ok": true }),
        ));
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        client.logout().unwrap();
        let values = store.values.borrow();
        assert!(!values.contains_key(GITHUB_TOKEN_ACCOUNT));
        assert!(!values.contains_key(RELAY_SESSION_ACCOUNT));
        assert_eq!(
            values.get(SIGNING_IDENTITY_ACCOUNT).map(String::as_str),
            Some("signing-private-material")
        );
        assert_eq!(
            values.get(HPKE_IDENTITY_ACCOUNT).map(String::as_str),
            Some("hpke-private-material")
        );
        assert_eq!(
            values.get("mls-group-state:v1").map(String::as_str),
            Some("mls-key-material")
        );
        assert_eq!(
            values.get("room-state-wrap:v1").map(String::as_str),
            Some("room-key-material")
        );
        let request = http.requests.borrow().last().unwrap().clone();
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, format!("{RELAY}/auth/logout"));
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| name == "cookie"
                && value == &format!("multaiplayer_session={SESSION}")));
    }

    #[test]
    fn relay_logout_failure_still_clears_local_auth_only() {
        let store = MemoryCredentialStore::default();
        for (account, value) in [
            (GITHUB_TOKEN_ACCOUNT, "origin-bound-github-credential"),
            (
                RELAY_SESSION_ACCOUNT,
                &serde_json::to_string(&StoredRelaySession {
                    version: 1,
                    relay_origin: RELAY.to_owned(),
                    session: SESSION.to_owned(),
                })
                .unwrap(),
            ),
            (SIGNING_IDENTITY_ACCOUNT, "signing-private-material"),
            (HPKE_IDENTITY_ACCOUNT, "hpke-private-material"),
            ("mls-group-state:v1", "mls-key-material"),
            ("room-state-wrap:v1", "room-key-material"),
        ] {
            store
                .values
                .borrow_mut()
                .insert(account.to_owned(), value.to_owned());
        }
        let http = MockHttp::default();
        http.responses
            .borrow_mut()
            .push_back(Err(CliError::RelayUnavailable));
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        assert_eq!(client.logout(), Err(CliError::RelayUnavailable));
        let values = store.values.borrow();
        assert!(!values.contains_key(GITHUB_TOKEN_ACCOUNT));
        assert!(!values.contains_key(RELAY_SESSION_ACCOUNT));
        assert!(values.contains_key(SIGNING_IDENTITY_ACCOUNT));
        assert!(values.contains_key(HPKE_IDENTITY_ACCOUNT));
        assert!(values.contains_key("mls-group-state:v1"));
        assert!(values.contains_key("room-state-wrap:v1"));
    }

    #[test]
    fn keychain_errors_and_http_errors_never_include_secret_values() {
        let store = MemoryCredentialStore::default();
        *store.fail_reads.borrow_mut() = true;
        let http = MockHttp::default();
        let client = AuthClient::new(&store, &http, CLIENT_ID, RELAY).unwrap();
        let error = client.restore_session().unwrap_err();
        assert_eq!(error, CliError::CredentialStoreUnavailable);
        for secret in [
            ACCESS_TOKEN,
            SESSION,
            "signing-private-material",
            "hpke-private-material",
        ] {
            assert!(!format!("{error:?} {error}").contains(secret));
        }
    }

    #[test]
    fn every_public_error_and_debug_path_is_secret_free() {
        let errors = [
            CliError::GitHubNotConfigured,
            CliError::InvalidGitHubResponse,
            CliError::AuthorizationPending,
            CliError::AuthorizationDenied,
            CliError::AuthorizationExpired,
            CliError::GitHubUnavailable,
            CliError::RelayOriginMismatch,
            CliError::RelayUnavailable,
            CliError::CredentialStoreUnavailable,
            CliError::InvalidStoredCredential,
            CliError::IdentityScopeMismatch,
            CliError::IdentityUnavailable,
            CliError::UrlOpenFailed,
        ];
        for error in errors {
            let rendered = format!("{error:?} {error}");
            for secret in [
                ACCESS_TOKEN,
                SESSION,
                "private-device-code",
                "private-material",
            ] {
                assert!(!rendered.contains(secret));
            }
        }
    }
}
