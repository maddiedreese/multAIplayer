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
fn command_errors_are_typed_and_do_not_reflect_unexpected_secrets() {
    let invalid = github_command_error("GitHub repository is invalid.".to_owned());
    assert_eq!(
        invalid.code,
        crate::command_error::CommandErrorCode::InvalidArgument
    );

    let secret = "ghp_DO_NOT_REFLECT_THIS_VALUE";
    let unexpected = github_command_error(secret.to_owned());
    assert_eq!(
        unexpected.code,
        crate::command_error::CommandErrorCode::Unavailable
    );
    assert!(!unexpected.message.contains(secret));
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
    assert_eq!(GITHUB_IDENTITY_SCOPES, ["read:user"]);
    assert_eq!(GITHUB_REPOSITORY_SCOPES, ["repo"]);
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
        Some("None".to_owned())
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
        relay_session: "opaque-relay-session".into(),
        relay_origin: "https://relay.multaiplayer.com".into(),
    })
    .unwrap();
    let encoded = value.to_string();
    assert!(!encoded.contains("access_token"));
    assert!(!encoded.contains("accessToken"));
    assert_eq!(value["relaySession"], "opaque-relay-session");
    assert_eq!(value["relayOrigin"], "https://relay.multaiplayer.com");
    let repository = serde_json::to_value(RepositoryDevicePollResult::Complete).unwrap();
    assert_eq!(repository, serde_json::json!({ "status": "complete" }));
    assert!(!repository.to_string().contains("user"));
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
            scope: None,
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
            scope: Some("read:user".into()),
            error: None
        }),
        TokenPollOutcome::Complete(_)
    ));
    assert!(matches!(
        token_poll_outcome(TokenResponse {
            access_token: Some("bad token".into()),
            scope: Some("read:user".into()),
            error: None
        }),
        TokenPollOutcome::InvalidCredential
    ));
}

#[test]
fn granted_scopes_are_purpose_bound_and_fail_closed() {
    assert!(validate_granted_scopes(DeviceFlowPurpose::Identity, &["read:user".into()]).is_ok());
    assert!(validate_granted_scopes(
        DeviceFlowPurpose::Identity,
        &["read:user".into(), "repo".into()]
    )
    .is_err());
    assert!(validate_granted_scopes(DeviceFlowPurpose::Repository, &["repo".into()]).is_ok());
    assert!(validate_granted_scopes(
        DeviceFlowPurpose::Repository,
        &["repo".into(), "read:user".into()]
    )
    .is_ok());
    assert!(
        validate_granted_scopes(DeviceFlowPurpose::Repository, &["public_repo".into()]).is_err()
    );
}
