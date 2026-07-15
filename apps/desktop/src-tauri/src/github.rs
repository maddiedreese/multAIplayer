use regex::Regex;
use reqwest::{header, Client, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{webview::Cookie, WebviewWindow};
use uuid::Uuid;

const KEYCHAIN_SERVICE: &str = "com.multaiplayer.desktop";
const KEYCHAIN_ACCOUNT: &str = "github-oauth-token:v1";
const MAX_TOKEN_CHARS: usize = 8192;
const MAX_RESPONSE_BYTES: usize = 1_048_576;
const GITHUB_CLIENT_ID: &str = match option_env!("MULTAIPLAYER_NATIVE_GITHUB_CLIENT_ID") {
    Some(value) => value,
    None => "Ov23licNchghSlAxuCdK",
};
const RELAY_HTTP_ORIGIN: &str = match option_env!("MULTAIPLAYER_NATIVE_RELAY_HTTP_ORIGIN") {
    Some(value) => value,
    None => "https://relay.multaiplayer.com",
};
const GITHUB_SCOPES: [&str; 2] = ["read:user", "repo"];

#[derive(Default)]
pub struct GitHubState {
    pending: Mutex<HashMap<String, PendingDeviceFlow>>,
}

struct PendingDeviceFlow {
    client_id: String,
    device_code: String,
    expires_at: Instant,
    poll_interval: Duration,
    next_poll_at: Instant,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DeviceFlowStart {
    flow_id: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize, Serialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

enum TokenPollOutcome {
    Pending,
    SlowDown,
    Complete(String),
    AccessDenied,
    Expired,
    InvalidCredential,
    Failed,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DevicePollResult {
    Pending,
    SlowDown { retry_after_seconds: u64 },
    Complete { user: SignedInUser },
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedInUser {
    id: String,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct VerifyResponse {
    user: SignedInUser,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestInput {
    owner: String,
    repo: String,
    title: String,
    body: String,
    head: String,
    base: String,
    draft: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestResult {
    id: u64,
    number: u64,
    url: String,
    title: String,
}

#[derive(Deserialize)]
struct GitHubPullResponse {
    id: u64,
    number: u64,
    html_url: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRunsInput {
    owner: String,
    repo: String,
    branch: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRunsResult {
    total_count: u64,
    runs: Vec<ActionRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRun {
    id: u64,
    name: String,
    display_title: Option<String>,
    run_number: Option<u64>,
    workflow_id: Option<u64>,
    status: String,
    conclusion: Option<String>,
    branch: Option<String>,
    head_sha: Option<String>,
    event: Option<String>,
    url: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct GitHubActionRunsResponse {
    total_count: u64,
    workflow_runs: Vec<GitHubActionRun>,
}

#[derive(Deserialize)]
struct GitHubActionRun {
    id: u64,
    name: String,
    display_title: Option<String>,
    run_number: Option<u64>,
    workflow_id: Option<u64>,
    status: String,
    conclusion: Option<String>,
    head_branch: Option<String>,
    head_sha: Option<String>,
    event: Option<String>,
    html_url: String,
    created_at: String,
    updated_at: String,
}

fn client() -> Result<Client, String> {
    build_client(true)
}

fn build_client(https_only: bool) -> Result<Client, String> {
    Client::builder()
        .user_agent("multAIplayer-alpha")
        .https_only(https_only)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "GitHub networking is unavailable.".to_owned())
}

fn validate_client_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || !value.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("GitHub OAuth is not configured.".to_owned());
    }
    Ok(value.to_owned())
}

fn validate_scopes(scopes: &[String]) -> Result<String, String> {
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

#[tauri::command]
pub async fn github_device_flow_start(
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

#[tauri::command]
pub async fn github_device_flow_poll(
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
        let _ = github_token_delete();
        return Err("Signed in, but the relay session could not be installed.".to_owned());
    }
    state
        .pending
        .lock()
        .map_err(|_| "GitHub sign-in state is unavailable.".to_owned())?
        .remove(&flow_id);
    Ok(DevicePollResult::Complete { user })
}

fn token_poll_outcome(body: TokenResponse) -> TokenPollOutcome {
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

fn github_device_flow_cancel_inner(state: &GitHubState, flow_id: &str) {
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

fn build_session_cookie(base: &Url, session_value: String) -> Result<Cookie<'static>, String> {
    let host = base
        .host_str()
        .ok_or_else(|| "Relay URL is invalid.".to_owned())?;
    Cookie::parse(format!(
        "multaiplayer_session={session_value}; Domain={host}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax"
    ))
    .map(Cookie::into_owned)
    .map_err(|_| "The relay returned an invalid session cookie.".to_owned())
}

fn validate_signed_in_user(mut user: SignedInUser) -> Result<SignedInUser, String> {
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

fn validate_relay_url(value: &str) -> Result<Url, String> {
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

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|_| "The credential store is unavailable.".to_owned())
}

fn store_token(token: &str) -> Result<(), String> {
    token_entry()?
        .set_password(token)
        .map_err(|_| "GitHub sign-in could not be stored securely.".to_owned())
}

fn load_token() -> Result<String, String> {
    let token = token_entry()?
        .get_password()
        .map_err(|_| "Sign in to GitHub before using this feature.".to_owned())?;
    if token.is_empty() || token.len() > MAX_TOKEN_CHARS || token.chars().any(char::is_whitespace) {
        return Err("Stored GitHub credentials are invalid.".to_owned());
    }
    Ok(token)
}

#[tauri::command]
pub fn github_token_delete() -> Result<(), String> {
    match token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => {
            Err("GitHub credentials could not be removed from the credential store.".to_owned())
        }
    }
}

#[tauri::command]
pub async fn github_create_pull_request(
    request: PullRequestInput,
) -> Result<PullRequestResult, String> {
    let request = validate_pull_request(request)?;
    let token = load_token()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls",
        request.owner, request.repo
    );
    let response = client()?
        .post(url)
        .bearer_auth(token)
        .header(header::ACCEPT, "application/vnd.github+json")
        .json(&serde_json::json!({
            "title": request.title,
            "body": request.body,
            "head": request.head,
            "base": request.base,
            "draft": request.draft
        }))
        .send()
        .await
        .map_err(|_| "Failed to create the pull request.".to_owned())?;
    if response.status() != StatusCode::CREATED {
        return Err("GitHub did not create the pull request.".to_owned());
    }
    let body: GitHubPullResponse = bounded_json(response).await?;
    validate_github_url(&body.html_url)?;
    Ok(PullRequestResult {
        id: body.id,
        number: body.number,
        url: body.html_url,
        title: bounded_text(body.title, 256, false)?,
    })
}

#[tauri::command]
pub async fn github_list_action_runs(request: ActionRunsInput) -> Result<ActionRunsResult, String> {
    let (owner, repo) = validate_repo(&request.owner, &request.repo)?;
    let branch = request
        .branch
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .map(validate_branch)
        .transpose()?;
    let token = load_token()?;
    let mut url = Url::parse(&format!(
        "https://api.github.com/repos/{owner}/{repo}/actions/runs"
    ))
    .map_err(|_| "GitHub request is invalid.".to_owned())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", "6");
        if let Some(branch) = &branch {
            query.append_pair("branch", branch);
        }
    }
    let response = client()?
        .get(url)
        .bearer_auth(token)
        .header(header::ACCEPT, "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .send()
        .await
        .map_err(|_| "Failed to load GitHub Actions.".to_owned())?;
    if !response.status().is_success() {
        return Err("GitHub did not return Actions runs.".to_owned());
    }
    let body: GitHubActionRunsResponse = bounded_json(response).await?;
    let runs = body
        .workflow_runs
        .into_iter()
        .take(6)
        .map(normalize_action_run)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ActionRunsResult {
        total_count: body.total_count,
        runs,
    })
}

fn validate_pull_request(mut request: PullRequestInput) -> Result<PullRequestInput, String> {
    let (owner, repo) = validate_repo(&request.owner, &request.repo)?;
    request.owner = owner;
    request.repo = repo;
    request.title = bounded_text(request.title, 256, false)?;
    request.body = bounded_body(request.body, 65_536)?;
    request.head = validate_branch(&request.head)?;
    request.base = validate_branch(&request.base)?;
    Ok(request)
}

fn validate_repo(owner: &str, repo: &str) -> Result<(String, String), String> {
    let owner = owner.trim();
    let repo = repo.trim();
    let owner_re = Regex::new(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
        .map_err(|_| "GitHub validation is unavailable.".to_owned())?;
    let repo_re = Regex::new(r"^[A-Za-z0-9._-]{1,100}$")
        .map_err(|_| "GitHub validation is unavailable.".to_owned())?;
    if !owner_re.is_match(owner) || !repo_re.is_match(repo) || repo == "." || repo == ".." {
        return Err("GitHub repository is invalid.".to_owned());
    }
    Ok((owner.to_owned(), repo.to_owned()))
}

fn validate_branch(value: &str) -> Result<String, String> {
    let value = value.trim();
    let invalid = value.is_empty()
        || value.len() > 255
        || value.starts_with('-')
        || value == "@"
        || value.contains("..")
        || value.chars().any(char::is_whitespace)
        || ['~', '^', ':', '?', '*', '[', '\\']
            .iter()
            .any(|c| value.contains(*c))
        || value.contains("//")
        || value.ends_with('/')
        || value.ends_with('.')
        || value.contains("@{")
        || value
            .split('/')
            .any(|p| p.is_empty() || p.starts_with('.') || p.ends_with(".lock"));
    if invalid {
        return Err("GitHub branch name is invalid.".to_owned());
    }
    Ok(value.to_owned())
}

fn bounded_text(value: String, max: usize, empty_ok: bool) -> Result<String, String> {
    let value = if empty_ok {
        value
    } else {
        value.trim().to_owned()
    };
    if (!empty_ok && value.is_empty())
        || value.chars().count() > max
        || value.chars().any(char::is_control)
    {
        return Err("GitHub text field is invalid.".to_owned());
    }
    Ok(value)
}

fn bounded_body(value: String, max: usize) -> Result<String, String> {
    if value.chars().count() > max
        || value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("GitHub pull request body is invalid.".to_owned());
    }
    Ok(value)
}

fn validate_github_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "GitHub returned an invalid URL.".to_owned())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.username() != ""
        || url.password().is_some()
    {
        return Err("GitHub returned an invalid URL.".to_owned());
    }
    Ok(())
}

fn normalize_action_run(run: GitHubActionRun) -> Result<ActionRun, String> {
    validate_github_url(&run.html_url)?;
    Ok(ActionRun {
        id: run.id,
        name: bounded_text(run.name, 256, false)?,
        display_title: run
            .display_title
            .map(|v| bounded_text(v, 256, false))
            .transpose()?,
        run_number: run.run_number,
        workflow_id: run.workflow_id,
        status: bounded_text(run.status, 64, false)?,
        conclusion: run
            .conclusion
            .map(|v| bounded_text(v, 64, false))
            .transpose()?,
        branch: run
            .head_branch
            .as_deref()
            .map(validate_branch)
            .transpose()?,
        head_sha: run
            .head_sha
            .map(|v| bounded_text(v, 128, false))
            .transpose()?,
        event: run.event.map(|v| bounded_text(v, 64, false)).transpose()?,
        url: run.html_url,
        created_at: bounded_text(run.created_at, 64, false)?,
        updated_at: bounded_text(run.updated_at, 64, false)?,
    })
}

async fn bounded_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("GitHub returned an oversized response.".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The upstream response could not be read.".to_owned())?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("GitHub returned an oversized response.".to_owned());
    }
    serde_json::from_slice(&bytes).map_err(|_| "The upstream response was invalid.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn validates_repo_and_branch_like_webview_contract() {
        assert_eq!(
            validate_repo("owner", "repo.name").unwrap(),
            ("owner".into(), "repo.name".into())
        );
        assert!(validate_repo("bad owner", "repo").is_err());
        assert_eq!(
            validate_branch("codex/secure-auth").unwrap(),
            "codex/secure-auth"
        );
        for invalid in ["bad branch", "../main", "topic.lock", "a//b", "@"] {
            assert!(validate_branch(invalid).is_err());
        }
    }

    #[test]
    fn rejects_untrusted_relay_and_response_urls() {
        assert!(validate_relay_url("http://relay.example").is_err());
        assert!(validate_relay_url("https://user@relay.example").is_err());
        assert!(validate_relay_url("https://attacker.example").is_err());
        assert!(validate_relay_url(RELAY_HTTP_ORIGIN).is_ok());
        assert!(validate_github_url("https://github.com/o/r/pull/1").is_ok());
        assert!(validate_github_url("https://github.com.evil.example/o/r").is_err());
    }

    #[test]
    fn native_configuration_and_cookie_attributes_are_pinned() {
        assert!(validate_client_id(GITHUB_CLIENT_ID).is_ok());
        assert_eq!(GITHUB_SCOPES, ["read:user", "repo"]);
        let base = validate_relay_url(RELAY_HTTP_ORIGIN).unwrap();
        let cookie = build_session_cookie(&base, "session-value".to_owned()).unwrap();
        assert_eq!(cookie.domain(), base.host_str());
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(
            cookie.max_age().map(|value| value.whole_seconds()),
            Some(2_592_000)
        );
        assert_eq!(
            cookie.same_site().map(|value| format!("{value:?}")),
            Some("Lax".to_owned())
        );
    }

    #[test]
    fn credential_client_never_follows_redirects() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(b"HTTP/1.1 307 Temporary Redirect\r\nLocation: https://attacker.example/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let response = tauri::async_runtime::block_on(async {
            build_client(false)
                .unwrap()
                .post(format!("http://{address}/verify"))
                .body("credential")
                .send()
                .await
                .unwrap()
        });
        server.join().unwrap();
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(response.url().host_str(), Some("127.0.0.1"));
    }

    #[test]
    fn serialized_ipc_results_never_have_token_fields() {
        let value = serde_json::to_value(DevicePollResult::Complete {
            user: SignedInUser {
                id: "github:1".into(),
                login: "user".into(),
                name: None,
                avatar_url: None,
            },
        })
        .unwrap();
        let encoded = value.to_string();
        assert!(!encoded.contains("access_token"));
        assert!(!encoded.contains("accessToken"));
        let start = serde_json::to_value(DeviceFlowStart {
            flow_id: "opaque-flow-id".into(),
            user_code: "ABCD-EFGH".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_in: 900,
            interval: 5,
        })
        .unwrap();
        let start_encoded = start.to_string();
        assert!(!start_encoded.contains("device_code"));
        assert!(!start_encoded.contains("access_token"));
    }

    #[test]
    fn device_poll_protocol_preserves_every_github_state() {
        for (error, expected) in [
            ("authorization_pending", "pending"),
            ("slow_down", "slow_down"),
            ("access_denied", "access_denied"),
            ("expired_token", "expired"),
            ("other", "failed"),
        ] {
            let actual = match token_poll_outcome(TokenResponse {
                access_token: None,
                error: Some(error.to_owned()),
            }) {
                TokenPollOutcome::Pending => "pending",
                TokenPollOutcome::SlowDown => "slow_down",
                TokenPollOutcome::AccessDenied => "access_denied",
                TokenPollOutcome::Expired => "expired",
                TokenPollOutcome::Failed => "failed",
                _ => "unexpected",
            };
            assert_eq!(actual, expected);
        }
        assert!(matches!(
            token_poll_outcome(TokenResponse {
                access_token: Some("debug-token".into()),
                error: None
            }),
            TokenPollOutcome::Complete(_)
        ));
        assert!(matches!(
            token_poll_outcome(TokenResponse {
                access_token: Some("bad token".into()),
                error: None
            }),
            TokenPollOutcome::InvalidCredential
        ));
    }
}
