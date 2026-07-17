use super::*;

pub(super) fn client() -> Result<Client, String> {
    build_client(true)
}

pub(super) fn build_client(https_only: bool) -> Result<Client, String> {
    Client::builder()
        .user_agent("multAIplayer-alpha")
        .https_only(https_only)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "GitHub networking is unavailable.".to_owned())
}

pub(super) fn validate_client_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || !value.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("GitHub OAuth is not configured.".to_owned());
    }
    Ok(value.to_owned())
}

pub(super) fn validate_scopes(scopes: &[String]) -> Result<String, String> {
    if scopes.is_empty() || scopes.len() > 8 {
        return Err("GitHub OAuth scopes are invalid.".to_owned());
    }
    for scope in scopes {
        if scope.is_empty()
            || scope.len() > 64
            || !scope
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '_')
        {
            return Err("GitHub OAuth scopes are invalid.".to_owned());
        }
    }
    Ok(scopes.join(" "))
}

#[typed_tauri_command::command]
pub async fn github_device_flow_start(
    state: tauri::State<'_, GitHubState>,
) -> crate::command_error::CommandResult<DeviceFlowStart> {
    github_device_flow_start_inner(state, DeviceFlowPurpose::Identity)
        .await
        .map_err(github_command_error)
}

async fn github_device_flow_start_inner(
    state: tauri::State<'_, GitHubState>,
    purpose: DeviceFlowPurpose,
) -> Result<DeviceFlowStart, String> {
    let client_id = validate_client_id(GITHUB_CLIENT_ID)?;
    let scopes = match purpose {
        DeviceFlowPurpose::Identity => &GITHUB_IDENTITY_SCOPES[..],
        DeviceFlowPurpose::Repository => &GITHUB_REPOSITORY_SCOPES[..],
    }
    .iter()
    .map(|scope| (*scope).to_owned())
    .collect::<Vec<_>>();
    let scope = validate_scopes(&scopes)?;
    let response = client()?
        .post("https://github.com/login/device/code")
        .header(header::ACCEPT, "application/json")
        .json(&serde_json::json!({ "client_id": client_id, "scope": scope }))
        .send()
        .await
        .map_err(|_| "Failed to start GitHub sign-in.".to_owned())?;
    if !response.status().is_success() {
        return Err("GitHub did not start sign-in.".to_owned());
    }
    let body: DeviceCodeResponse = bounded_json(response).await?;
    if body.device_code.is_empty()
        || body.device_code.len() > 1024
        || body.user_code.is_empty()
        || body.user_code.len() > 64
        || body.verification_uri != "https://github.com/login/device"
        || body.expires_in == 0
        || body.expires_in > 3600
        || body.interval == 0
        || body.interval > 60
    {
        return Err("GitHub returned an invalid device flow.".to_owned());
    }
    let flow_id = Uuid::new_v4().to_string();
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "GitHub sign-in state is unavailable.".to_owned())?;
    pending.retain(|_, flow| flow.expires_at > Instant::now());
    if pending.len() >= 8 {
        return Err("Too many GitHub sign-in attempts are active.".to_owned());
    }
    pending.insert(
        flow_id.clone(),
        PendingDeviceFlow {
            purpose,
            client_id,
            device_code: body.device_code,
            expires_at: Instant::now() + Duration::from_secs(body.expires_in),
            poll_interval: Duration::from_secs(body.interval),
            next_poll_at: Instant::now() + Duration::from_secs(body.interval),
        },
    );
    Ok(DeviceFlowStart {
        flow_id,
        user_code: body.user_code,
        verification_uri: body.verification_uri,
        expires_in: body.expires_in,
        interval: body.interval,
    })
}

#[typed_tauri_command::command]
pub async fn github_device_flow_poll(
    window: WebviewWindow,
    state: tauri::State<'_, GitHubState>,
    flow_id: String,
) -> crate::command_error::CommandResult<DevicePollResult> {
    github_device_flow_poll_inner(window, state, flow_id)
        .await
        .map_err(github_command_error)
}

async fn github_device_flow_poll_inner(
    window: WebviewWindow,
    state: tauri::State<'_, GitHubState>,
    flow_id: String,
) -> Result<DevicePollResult, String> {
    let credential =
        match poll_device_credential(&state, &flow_id, DeviceFlowPurpose::Identity).await? {
            CredentialPoll::Pending => return Ok(DevicePollResult::Pending),
            CredentialPoll::SlowDown => {
                return Ok(DevicePollResult::SlowDown {
                    retry_after_seconds: 5,
                })
            }
            CredentialPoll::Complete(credential) => credential,
        };
    validate_granted_scopes(DeviceFlowPurpose::Identity, &credential.scopes)?;
    let (user, cookie) = verify_with_relay(RELAY_HTTP_ORIGIN, &credential.token).await?;
    // A new identity must never inherit repository authority from a previous account.
    clear_repository_token()?;
    store_identity_token(&credential.token)?;
    if window.set_cookie(cookie).is_err() {
        let _ = github_token_delete_inner();
        return Err("Signed in, but the relay session could not be installed.".to_owned());
    }
    state
        .pending
        .lock()
        .map_err(|_| "GitHub sign-in state is unavailable.".to_owned())?
        .remove(&flow_id);
    Ok(DevicePollResult::Complete { user })
}

#[typed_tauri_command::command]
pub async fn github_repository_device_flow_start(
    state: tauri::State<'_, GitHubState>,
) -> crate::command_error::CommandResult<DeviceFlowStart> {
    github_device_flow_start_inner(state, DeviceFlowPurpose::Repository)
        .await
        .map_err(github_command_error)
}

#[typed_tauri_command::command]
pub async fn github_repository_device_flow_poll(
    state: tauri::State<'_, GitHubState>,
    flow_id: String,
) -> crate::command_error::CommandResult<RepositoryDevicePollResult> {
    github_repository_device_flow_poll_inner(state, flow_id)
        .await
        .map_err(github_command_error)
}

async fn github_repository_device_flow_poll_inner(
    state: tauri::State<'_, GitHubState>,
    flow_id: String,
) -> Result<RepositoryDevicePollResult, String> {
    let credential =
        match poll_device_credential(&state, &flow_id, DeviceFlowPurpose::Repository).await? {
            CredentialPoll::Pending => return Ok(RepositoryDevicePollResult::Pending),
            CredentialPoll::SlowDown => {
                return Ok(RepositoryDevicePollResult::SlowDown {
                    retry_after_seconds: 5,
                })
            }
            CredentialPoll::Complete(credential) => credential,
        };
    validate_granted_scopes(DeviceFlowPurpose::Repository, &credential.scopes)?;
    ensure_same_github_account(&load_identity_token()?, &credential.token).await?;
    store_repository_token(&credential.token)?;
    state
        .pending
        .lock()
        .map_err(|_| "GitHub authorization state is unavailable.".to_owned())?
        .remove(&flow_id);
    Ok(RepositoryDevicePollResult::Complete)
}

enum CredentialPoll {
    Pending,
    SlowDown,
    Complete(AccessCredential),
}

async fn poll_device_credential(
    state: &GitHubState,
    flow_id: &str,
    purpose: DeviceFlowPurpose,
) -> Result<CredentialPoll, String> {
    let (client_id, device_code) = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "GitHub authorization state is unavailable.".to_owned())?;
        let flow = pending
            .get_mut(flow_id)
            .filter(|flow| flow.expires_at > Instant::now() && flow.purpose == purpose)
            .ok_or_else(|| "GitHub authorization expired or is invalid. Start again.".to_owned())?;
        if Instant::now() < flow.next_poll_at {
            return Ok(CredentialPoll::Pending);
        }
        flow.next_poll_at = Instant::now() + flow.poll_interval;
        (flow.client_id.clone(), flow.device_code.clone())
    };
    let response = client()?
        .post("https://github.com/login/oauth/access_token")
        .header(header::ACCEPT, "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|_| "Failed to complete GitHub authorization.".to_owned())?;
    let body: TokenResponse = bounded_json(response).await?;
    match token_poll_outcome(body) {
        TokenPollOutcome::Complete(credential) => Ok(CredentialPoll::Complete(credential)),
        TokenPollOutcome::Pending => Ok(CredentialPoll::Pending),
        TokenPollOutcome::SlowDown => {
            if let Ok(mut pending) = state.pending.lock() {
                if let Some(flow) = pending.get_mut(flow_id) {
                    flow.poll_interval += Duration::from_secs(5);
                    flow.next_poll_at = Instant::now() + flow.poll_interval;
                }
            }
            Ok(CredentialPoll::SlowDown)
        }
        TokenPollOutcome::AccessDenied => {
            github_device_flow_cancel_inner(state, flow_id);
            Err("GitHub authorization was denied.".to_owned())
        }
        TokenPollOutcome::Expired => {
            github_device_flow_cancel_inner(state, flow_id);
            Err("The GitHub authorization code expired. Start again.".to_owned())
        }
        TokenPollOutcome::InvalidCredential => {
            Err("GitHub returned an invalid access credential.".to_owned())
        }
        TokenPollOutcome::Failed => Err("GitHub did not complete authorization.".to_owned()),
    }
}

async fn ensure_same_github_account(
    identity_token: &str,
    repository_token: &str,
) -> Result<(), String> {
    let identity = github_user_id(identity_token).await?;
    let repository = github_user_id(repository_token).await?;
    if identity != repository {
        return Err(
            "Repository access must be authorized by the signed-in GitHub account.".to_owned(),
        );
    }
    Ok(())
}

async fn github_user_id(token: &str) -> Result<u64, String> {
    #[derive(Deserialize)]
    struct GitHubUserId {
        id: u64,
    }
    let response = client()?
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header(header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "GitHub could not verify the authorized account.".to_owned())?;
    if !response.status().is_success() {
        return Err("GitHub could not verify the authorized account.".to_owned());
    }
    Ok(bounded_json::<GitHubUserId>(response).await?.id)
}

pub(super) fn token_poll_outcome(body: TokenResponse) -> TokenPollOutcome {
    match body.access_token {
        Some(token)
            if !token.is_empty()
                && token.len() <= MAX_TOKEN_CHARS
                && !token.chars().any(char::is_whitespace) =>
        {
            let scopes = body
                .scope
                .unwrap_or_default()
                .split([',', ' '])
                .filter(|scope| !scope.is_empty())
                .map(str::to_owned)
                .collect();
            TokenPollOutcome::Complete(AccessCredential { token, scopes })
        }
        Some(_) => TokenPollOutcome::InvalidCredential,
        None => match body.error.as_deref() {
            Some("authorization_pending") => TokenPollOutcome::Pending,
            Some("slow_down") => TokenPollOutcome::SlowDown,
            Some("access_denied") => TokenPollOutcome::AccessDenied,
            Some("expired_token") => TokenPollOutcome::Expired,
            _ => TokenPollOutcome::Failed,
        },
    }
}

pub(super) fn validate_granted_scopes(
    purpose: DeviceFlowPurpose,
    scopes: &[String],
) -> Result<(), String> {
    let allowed = match purpose {
        DeviceFlowPurpose::Identity => &GITHUB_IDENTITY_SCOPES[..],
        // GitHub may repeat the already-approved identity scope with the optional grant.
        DeviceFlowPurpose::Repository => &["repo", "read:user"][..],
    };
    let required = match purpose {
        DeviceFlowPurpose::Identity => "read:user",
        DeviceFlowPurpose::Repository => "repo",
    };
    if !scopes.iter().any(|scope| scope == required)
        || scopes
            .iter()
            .any(|scope| !allowed.contains(&scope.as_str()))
    {
        return Err(
            "GitHub returned unexpected OAuth permissions. Revoke the app grant and try again."
                .to_owned(),
        );
    }
    Ok(())
}

pub(super) fn github_device_flow_cancel_inner(state: &GitHubState, flow_id: &str) {
    if let Ok(mut pending) = state.pending.lock() {
        pending.remove(flow_id);
    }
}

#[tauri::command]
pub fn github_device_flow_cancel(state: tauri::State<'_, GitHubState>, flow_id: String) {
    github_device_flow_cancel_inner(&state, &flow_id);
}

async fn verify_with_relay(
    relay_url: &str,
    token: &str,
) -> Result<(SignedInUser, Cookie<'static>), String> {
    let base = validate_relay_url(relay_url)?;
    let endpoint = base
        .join("/auth/github/verify")
        .map_err(|_| "Relay URL is invalid.".to_owned())?;
    let response = client()?
        .post(endpoint.clone())
        .json(&serde_json::json!({ "access_token": token }))
        .send()
        .await
        .map_err(|_| "The relay could not verify GitHub sign-in.".to_owned())?;
    if response.url() != &endpoint || !response.status().is_success() {
        return Err("The relay could not verify GitHub sign-in.".to_owned());
    }
    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "The relay did not create a session.".to_owned())?;
    let session_value = set_cookie
        .split(';')
        .next()
        .and_then(|v| v.strip_prefix("multaiplayer_session="))
        .filter(|v| {
            !v.is_empty()
                && v.len() <= 256
                && v.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
        .ok_or_else(|| "The relay returned an invalid session.".to_owned())?
        .to_owned();
    let body: VerifyResponse = bounded_json(response).await?;
    let user = validate_signed_in_user(body.user)?;
    let cookie = build_session_cookie(&base, session_value)?;
    Ok((user, cookie))
}

pub(super) fn build_session_cookie(
    base: &Url,
    session_value: String,
) -> Result<Cookie<'static>, String> {
    let host = base
        .host_str()
        .ok_or_else(|| "Relay URL is invalid.".to_owned())?;
    Cookie::parse(format!(
        "multaiplayer_session={session_value}; Domain={host}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax"
    ))
    .map(Cookie::into_owned)
    .map_err(|_| "The relay returned an invalid session cookie.".to_owned())
}

pub(super) fn validate_signed_in_user(mut user: SignedInUser) -> Result<SignedInUser, String> {
    user.id = bounded_text(user.id, 256, false)?;
    if !user.id.starts_with("github:") {
        return Err("The relay returned an invalid GitHub identity.".to_owned());
    }
    user.login = bounded_text(user.login, 120, false)?;
    user.name = user
        .name
        .map(|value| bounded_text(value, 120, false))
        .transpose()?;
    if let Some(avatar) = &user.avatar_url {
        let url = Url::parse(avatar)
            .map_err(|_| "The relay returned an invalid avatar URL.".to_owned())?;
        let host = url.host_str().unwrap_or_default();
        if url.scheme() != "https"
            || url.username() != ""
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
            || !(host == "github.com"
                || host == "githubusercontent.com"
                || host.ends_with(".githubusercontent.com"))
        {
            return Err("The relay returned an invalid avatar URL.".to_owned());
        }
    }
    Ok(user)
}

pub(super) fn validate_relay_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Relay URL is invalid.".to_owned())?;
    if url.as_str().trim_end_matches('/') != RELAY_HTTP_ORIGIN.trim_end_matches('/')
        || url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Relay URL must be a trusted HTTPS origin.".to_owned());
    }
    Ok(url)
}

pub(super) fn token_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|_| "The credential store is unavailable.".to_owned())
}

pub(super) fn store_identity_token(token: &str) -> Result<(), String> {
    token_entry(IDENTITY_KEYCHAIN_ACCOUNT)?
        .set_password(token)
        .map_err(|_| "GitHub sign-in could not be stored securely.".to_owned())
}

pub(super) fn store_repository_token(token: &str) -> Result<(), String> {
    token_entry(REPOSITORY_KEYCHAIN_ACCOUNT)?
        .set_password(token)
        .map_err(|_| "GitHub repository authorization could not be stored securely.".to_owned())
}

fn load_stored_token(account: &str, missing_message: &str) -> Result<String, String> {
    let token = token_entry(account)?
        .get_password()
        .map_err(|_| missing_message.to_owned())?;
    if token.is_empty() || token.len() > MAX_TOKEN_CHARS || token.chars().any(char::is_whitespace) {
        return Err("Stored GitHub credentials are invalid.".to_owned());
    }
    Ok(token)
}

pub(super) fn load_identity_token() -> Result<String, String> {
    load_stored_token(
        IDENTITY_KEYCHAIN_ACCOUNT,
        "Sign in to GitHub before using this feature.",
    )
}

pub(super) fn load_repository_token() -> Result<String, String> {
    load_stored_token(
        REPOSITORY_KEYCHAIN_ACCOUNT,
        "Authorize GitHub repository access before using this feature.",
    )
}

#[typed_tauri_command::command]
pub fn github_repository_access_status(
) -> crate::command_error::CommandResult<RepositoryAccessStatus> {
    Ok(RepositoryAccessStatus {
        authorized: load_repository_token().is_ok(),
    })
}

fn delete_token(account: &str) -> Result<(), String> {
    match token_entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => {
            Err("GitHub credentials could not be removed from the credential store.".to_owned())
        }
    }
}

pub(super) fn clear_repository_token() -> Result<(), String> {
    delete_token(REPOSITORY_KEYCHAIN_ACCOUNT)
}

#[typed_tauri_command::command]
pub fn github_token_delete() -> crate::command_error::CommandResult<()> {
    github_token_delete_inner().map_err(github_command_error)
}

pub(super) fn github_token_delete_inner() -> Result<(), String> {
    let identity = delete_token(IDENTITY_KEYCHAIN_ACCOUNT);
    let repository = delete_token(REPOSITORY_KEYCHAIN_ACCOUNT);
    let legacy = delete_token(LEGACY_KEYCHAIN_ACCOUNT);
    identity.and(repository).and(legacy)
}
