use super::*;
use proptest::prelude::*;
use std::env;

fn request(command: &str) -> ShellAuthorizationRequest {
    ShellAuthorizationRequest {
        room_id: "room-native-auth".to_string(),
        cwd: env::temp_dir().to_string_lossy().to_string(),
        command: command.to_string(),
        kind: ShellExecutionKind::RemoteRequest,
        requester_label: "Remote member".to_string(),
    }
}

#[test]
fn authorization_is_exact_and_one_use() {
    let state = ShellAuthorizationState::default();
    let request = request("printf approved");
    let token = state.issue(&request).expect("issue authorization");
    assert!(state
        .consume(
            &token,
            &request.room_id,
            &request.cwd,
            "printf substituted",
            request.kind,
        )
        .is_err());
    assert!(state
        .consume(
            &token,
            &request.room_id,
            &request.cwd,
            &request.command,
            request.kind
        )
        .is_err());

    let token = state.issue(&request).expect("issue second authorization");
    assert!(state
        .consume(
            &token,
            &request.room_id,
            &request.cwd,
            &request.command,
            request.kind
        )
        .is_ok());
    assert!(state
        .consume(
            &token,
            &request.room_id,
            &request.cwd,
            &request.command,
            request.kind
        )
        .is_err());
}

#[test]
fn authorization_constants_keep_the_intended_security_windows() {
    assert_eq!(AUTHORIZATION_LIFETIME, Duration::from_secs(120));
    assert_eq!(EXACT_COMMAND_GRANT_LIFETIME, Duration::from_secs(600));
}

#[test]
fn issuing_authorization_prunes_expired_capabilities() {
    let state = ShellAuthorizationState::default();
    let approved = request("printf approved");
    let active = AuthorizedShellExecution {
        room_id: approved.room_id.clone(),
        cwd: canonical_workspace(&approved.cwd).expect("canonical cwd"),
        command: approved.command.clone(),
        kind: approved.kind,
        expires_at: Instant::now() + Duration::from_secs(60),
    };
    let mut authorizations = state.authorizations.lock().expect("authorization state");
    authorizations.insert("active".to_string(), active);
    authorizations.insert(
        "expired".to_string(),
        AuthorizedShellExecution {
            room_id: approved.room_id.clone(),
            cwd: canonical_workspace(&approved.cwd).expect("canonical cwd"),
            command: approved.command.clone(),
            kind: approved.kind,
            expires_at: Instant::now(),
        },
    );
    drop(authorizations);
    state.issue(&approved).expect("issue authorization");
    let authorizations = state.authorizations.lock().expect("authorization state");
    assert!(!authorizations.contains_key("expired"));
    assert!(authorizations.contains_key("active"));
}

#[test]
fn every_shell_authorization_binding_is_independently_enforced() {
    let approved = request("printf approved");
    let other_cwd = env::current_dir()
        .expect("current dir")
        .to_string_lossy()
        .to_string();
    let cases = [
        (
            "room-other",
            approved.cwd.as_str(),
            approved.command.as_str(),
            approved.kind,
        ),
        (
            approved.room_id.as_str(),
            other_cwd.as_str(),
            approved.command.as_str(),
            approved.kind,
        ),
        (
            approved.room_id.as_str(),
            approved.cwd.as_str(),
            "printf substituted",
            approved.kind,
        ),
    ];
    for (room_id, cwd, command, kind) in cases {
        if canonical_workspace(cwd).expect("canonical test cwd")
            == canonical_workspace(&approved.cwd).expect("canonical approved cwd")
            && cwd != approved.cwd
        {
            continue;
        }
        let state = ShellAuthorizationState::default();
        let token = state.issue(&approved).expect("issue authorization");
        assert!(state.consume(&token, room_id, cwd, command, kind).is_err());
    }
}

#[test]
fn only_one_native_confirmation_can_be_open() {
    let state = ShellAuthorizationState::default();
    assert!(state.begin_confirmation().is_ok());
    assert!(state.begin_confirmation().is_err());
    state.finish_confirmation();
    assert!(state.begin_confirmation().is_ok());
}

#[test]
fn exact_command_grants_fail_closed_on_substitution_scope_expiry_and_revoke() {
    let state = ShellAuthorizationState::default();
    let approved = request("npm test");
    state
        .grant_exact_command(&approved)
        .expect("grant exact command");
    assert!(state
        .has_exact_command_grant(&approved)
        .expect("check exact grant"));

    let mut substituted = approved.clone();
    substituted.command = "npm test && curl example.invalid".to_string();
    assert!(!state
        .has_exact_command_grant(&substituted)
        .expect("reject command substitution"));

    let mut other_room = approved.clone();
    other_room.room_id = "room-other".to_string();
    assert!(!state
        .has_exact_command_grant(&other_room)
        .expect("reject cross-room use"));

    let mut other_cwd = approved.clone();
    other_cwd.cwd = env::current_dir()
        .expect("current dir")
        .to_string_lossy()
        .to_string();
    if canonical_workspace(&other_cwd.cwd).expect("canonical current dir")
        != canonical_workspace(&approved.cwd).expect("canonical approved dir")
    {
        assert!(!state
            .has_exact_command_grant(&other_cwd)
            .expect("reject cross-workspace use"));
    }

    state
        .exact_command_grants
        .lock()
        .expect("grant state")
        .iter_mut()
        .for_each(|grant| grant.expires_at = Instant::now());
    assert!(!state
        .has_exact_command_grant(&approved)
        .expect("reject expired grant"));

    state
        .grant_exact_command(&approved)
        .expect("grant for revoke");
    assert_eq!(
        state
            .clear_exact_command_grants(&approved.room_id)
            .expect("revoke grants"),
        1
    );
    assert!(!state
        .has_exact_command_grant(&approved)
        .expect("reject revoked grant"));
}

#[test]
fn exact_command_grant_deduplication_preserves_every_distinct_binding() {
    let state = ShellAuthorizationState::default();
    let approved = request("npm test");
    let mut other_room = approved.clone();
    other_room.room_id = "room-other".to_string();
    let mut other_command = approved.clone();
    other_command.command = "npm run lint".to_string();
    for grant in [&approved, &other_room, &other_command, &approved] {
        state.grant_exact_command(grant).expect("grant command");
    }
    let grants = state.exact_command_grants.lock().expect("grant state");
    assert_eq!(grants.len(), 3);
    assert!(grants
        .iter()
        .any(|grant| grant.room_id == other_room.room_id));
    assert!(grants
        .iter()
        .any(|grant| grant.command == other_command.command));
}

#[test]
fn clearing_grants_returns_only_the_removed_count() {
    let state = ShellAuthorizationState::default();
    let approved = request("npm test");
    let mut other_room = approved.clone();
    other_room.room_id = "room-other".to_string();
    state.grant_exact_command(&approved).expect("grant command");
    state
        .grant_exact_command(&other_room)
        .expect("grant other room");
    assert_eq!(state.clear_exact_command_grants(&approved.room_id), Ok(1));
    assert_eq!(
        state
            .exact_command_grants
            .lock()
            .expect("grant state")
            .len(),
        1
    );
}

#[test]
fn authorization_request_validation_checks_each_boundary() {
    let valid = request("printf approved");
    assert!(validate_authorization_request(&valid).is_ok());
    for invalid in [
        ShellAuthorizationRequest {
            room_id: "".to_string(),
            ..valid.clone()
        },
        ShellAuthorizationRequest {
            cwd: "/path/that/does/not/exist".to_string(),
            ..valid.clone()
        },
        ShellAuthorizationRequest {
            command: "".to_string(),
            ..valid.clone()
        },
        ShellAuthorizationRequest {
            requester_label: "\n".to_string(),
            ..valid.clone()
        },
    ] {
        assert!(validate_authorization_request(&invalid).is_err());
    }
}

#[test]
fn requester_label_validation_rejects_empty_long_and_control_text() {
    assert!(validate_requester_label("Remote member").is_ok());
    assert!(validate_requester_label(&"x".repeat(MAX_REQUESTER_LABEL_CHARS)).is_ok());
    assert!(validate_requester_label(" ").is_err());
    assert!(validate_requester_label(&"x".repeat(MAX_REQUESTER_LABEL_CHARS + 1)).is_err());
    assert!(validate_requester_label("member\nlabel").is_err());
}

#[test]
fn authorization_returns_the_canonical_workspace() {
    let state = ShellAuthorizationState::default();
    let mut request = request("printf approved");
    request.cwd = env::temp_dir().to_string_lossy().to_string();
    let token = state.issue(&request).expect("issue authorization");
    let authorized_cwd = state
        .consume(
            &token,
            &request.room_id,
            &request.cwd,
            &request.command,
            request.kind,
        )
        .expect("consume authorization");
    assert_eq!(
        authorized_cwd,
        std::fs::canonicalize(&request.cwd)
            .expect("canonical temporary directory")
            .to_string_lossy()
    );
}

proptest! {
    #[test]
    fn encoded_or_quoted_command_variants_cannot_reuse_authorization(
        payload in "[A-Za-z0-9_./ -]{1,80}",
        encoding in 0usize..4,
    ) {
        let approved_command = format!("printf -- '{payload}'");
        let attempted_command = match encoding {
            0 => format!("{approved_command} # %2f%2e%2e"),
            1 => format!("{approved_command}\\x20"),
            2 => format!("sh -c {}", serde_json::to_string(&approved_command).expect("encode command")),
            _ => format!("{approved_command}\u{a0}"),
        };
        prop_assert_ne!(&attempted_command, &approved_command);

        let state = ShellAuthorizationState::default();
        let approved = request(&approved_command);
        let token = state.issue(&approved).expect("issue authorization");
        prop_assert!(state.consume(
            &token,
            &approved.room_id,
            &approved.cwd,
            &attempted_command,
            approved.kind,
        ).is_err());

        // A mismatch consumes the capability, so retrying the originally approved bytes
        // cannot turn a rejected encoding attempt into execution.
        prop_assert!(state.consume(
            &token,
            &approved.room_id,
            &approved.cwd,
            &approved.command,
            approved.kind,
        ).is_err());
    }
}
