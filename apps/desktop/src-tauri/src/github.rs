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
const LEGACY_KEYCHAIN_ACCOUNT: &str = "github-oauth-token:v1";
const IDENTITY_KEYCHAIN_ACCOUNT: &str = "github-identity-token:v2";
const REPOSITORY_KEYCHAIN_ACCOUNT: &str = "github-repository-token:v2";
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
const GITHUB_IDENTITY_SCOPES: [&str; 1] = ["read:user"];
const GITHUB_REPOSITORY_SCOPES: [&str; 1] = ["repo"];

#[derive(Default)]
pub struct GitHubState {
    pending: Mutex<HashMap<String, PendingDeviceFlow>>,
}

struct PendingDeviceFlow {
    purpose: DeviceFlowPurpose,
    client_id: String,
    device_code: String,
    expires_at: Instant,
    poll_interval: Duration,
    next_poll_at: Instant,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DeviceFlowPurpose {
    Identity,
    Repository,
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
    scope: Option<String>,
    error: Option<String>,
}

struct AccessCredential {
    token: String,
    scopes: Vec<String>,
}

enum TokenPollOutcome {
    Pending,
    SlowDown,
    Complete(AccessCredential),
    AccessDenied,
    Expired,
    InvalidCredential,
    Failed,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DevicePollResult {
    Pending,
    SlowDown {
        retry_after_seconds: u64,
    },
    Complete {
        user: SignedInUser,
        #[serde(rename = "relaySession")]
        relay_session: String,
        #[serde(rename = "relayOrigin")]
        relay_origin: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredGitHubSession {
    user: SignedInUser,
    relay_session: String,
    relay_origin: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RepositoryDevicePollResult {
    Pending,
    SlowDown { retry_after_seconds: u64 },
    Complete,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAccessStatus {
    authorized: bool,
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

mod auth;
pub use auth::*;
#[typed_tauri_command::command]
pub async fn github_create_pull_request(
    request: PullRequestInput,
) -> crate::command_error::CommandResult<PullRequestResult> {
    github_create_pull_request_inner(request)
        .await
        .map_err(github_command_error)
}

async fn github_create_pull_request_inner(
    request: PullRequestInput,
) -> Result<PullRequestResult, String> {
    let request = validate_pull_request(request)?;
    let token = load_repository_token()?;
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
    if response.status() == StatusCode::UNAUTHORIZED {
        let _ = clear_repository_token();
        return Err("GitHub repository authorization expired. Authorize access again.".to_owned());
    }
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

#[typed_tauri_command::command]
pub async fn github_list_action_runs(
    request: ActionRunsInput,
) -> crate::command_error::CommandResult<ActionRunsResult> {
    github_list_action_runs_inner(request)
        .await
        .map_err(github_command_error)
}

async fn github_list_action_runs_inner(
    request: ActionRunsInput,
) -> Result<ActionRunsResult, String> {
    let (owner, repo) = validate_repo(&request.owner, &request.repo)?;
    let branch = request
        .branch
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .map(validate_branch)
        .transpose()?;
    let token = load_repository_token()?;
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
    if response.status() == StatusCode::UNAUTHORIZED {
        let _ = clear_repository_token();
        return Err("GitHub repository authorization expired. Authorize access again.".to_owned());
    }
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

fn github_command_error(message: String) -> crate::command_error::CommandError {
    use crate::command_error::CommandError;

    match message.as_str() {
        "GitHub repository is invalid."
        | "GitHub branch name is invalid."
        | "GitHub text field is invalid."
        | "GitHub pull request body is invalid."
        | "GitHub request is invalid." => CommandError::invalid_argument(message),
        "Sign in to GitHub before using this feature."
        | "Stored GitHub credentials are invalid."
        | "GitHub sign-in was denied."
        | "The GitHub sign-in code expired. Start sign-in again."
        | "GitHub returned an invalid access credential." => CommandError::unauthorized(message),
        "GitHub sign-in state expired. Start again." => CommandError::not_found(message),
        "The credential store is unavailable."
        | "GitHub sign-in could not be stored securely."
        | "GitHub credentials could not be removed from the credential store." => {
            CommandError::storage(message)
        }
        // Never reflect an unexpected internal or upstream error across IPC: future
        // callers may accidentally attach credential material to it.
        _ => CommandError::unavailable("The GitHub operation could not be completed."),
    }
}

#[cfg(test)]
mod tests;
