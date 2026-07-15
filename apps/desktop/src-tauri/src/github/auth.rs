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
    github_device_flow_start_inner(state)
        .await
        .map_err(github_command_error)
}

async fn github_device_flow_start_inner(
    state: tauri::State<'_, GitHubState>,
) -> Result<DeviceFlowStart, String> {
    let client_id = validate_client_id(GITHUB_CLIENT_ID)?;
    let scopes = GITHUB_SCOPES
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
    let (client_id, device_code) = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "GitHub sign-in state is unavailable.".to_owned())?;
        let flow = pending
            .get_mut(&flow_id)
            .filter(|flow| flow.expires_at > Instant::now())
            .ok_or_else(|| "GitHub sign-in state expired. Start again.".to_owned())?;
        if Instant::now() < flow.next_poll_at {
            return Ok(DevicePollResult::Pending);
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
        .map_err(|_| "Failed to complete GitHub sign-in.".to_owned())?;
    let body: TokenResponse = bounded_json(response).await?;
    let token = match token_poll_outcome(body) {
        TokenPollOutcome::Complete(token) => token,
        TokenPollOutcome::Pending => return Ok(DevicePollResult::Pending),
        TokenPollOutcome::SlowDown => {
            if let Ok(mut pending) = state.pending.lock() {
                if let Some(flow) = pending.get_mut(&flow_id) {
                    flow.poll_interval += Duration::from_secs(5);
                    flow.next_poll_at = Instant::now() + flow.poll_interval;
                }
            }
            return Ok(DevicePollResult::SlowDown {
                retry_after_seconds: 5,
            });
        }
        TokenPollOutcome::AccessDenied => {
            github_device_flow_cancel_inner(&state, &flow_id);
            return Err("GitHub sign-in was denied.".to_owned());
        }
        TokenPollOutcome::Expired => {
            github_device_flow_cancel_inner(&state, &flow_id);
            return Err("The GitHub sign-in code expired. Start sign-in again.".to_owned());
        }
        TokenPollOutcome::InvalidCredential => {
            return Err("GitHub returned an invalid access credential.".to_owned())
        }
        TokenPollOutcome::Failed => return Err("GitHub did not complete sign-in.".to_owned()),
    };
    let (user, cookie) = verify_with_relay(RELAY_HTTP_ORIGIN, &token).await?;
    store_token(&token)?;
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

pub(super) fn token_poll_outcome(body: TokenResponse) -> TokenPollOutcome {
    match body.access_token {
        Some(token)
            if !token.is_empty()
                && token.len() <= MAX_TOKEN_CHARS
                && !token.chars().any(char::is_whitespace) =>
        {
            TokenPollOutcome::Complete(token)
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

pub(super) fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|_| "The credential store is unavailable.".to_owned())
}

pub(super) fn store_token(token: &str) -> Result<(), String> {
    token_entry()?
        .set_password(token)
        .map_err(|_| "GitHub sign-in could not be stored securely.".to_owned())
}

pub(super) fn load_token() -> Result<String, String> {
    let token = token_entry()?
        .get_password()
        .map_err(|_| "Sign in to GitHub before using this feature.".to_owned())?;
    if token.is_empty() || token.len() > MAX_TOKEN_CHARS || token.chars().any(char::is_whitespace) {
        return Err("Stored GitHub credentials are invalid.".to_owned());
    }
    Ok(token)
}

#[typed_tauri_command::command]
pub fn github_token_delete() -> crate::command_error::CommandResult<()> {
    github_token_delete_inner().map_err(github_command_error)
}

pub(super) fn github_token_delete_inner() -> Result<(), String> {
    match token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => {
            Err("GitHub credentials could not be removed from the credential store.".to_owned())
        }
    }
}
