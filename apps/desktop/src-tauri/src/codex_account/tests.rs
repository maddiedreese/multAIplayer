use super::*;

#[test]
fn native_compatibility_bounds_match_the_shared_support_policy() {
    let policy: Value = serde_json::from_str(include_str!(
        "../../../../../contracts/codex-app-server/support-policy.json"
    ))
    .expect("support policy");
    let minimum = policy["minimumSupportedVersion"]
        .as_str()
        .expect("minimum supported version");
    let latest = policy["latestContractTestedVersion"]
        .as_str()
        .expect("latest contract-tested version");

    let (minimum_major, minimum_minor, minimum_patch) =
        parse_semver(minimum).expect("minimum semver");
    let below_minimum = if minimum_patch > 0 {
        format!("{minimum_major}.{minimum_minor}.{}", minimum_patch - 1)
    } else {
        format!("{minimum_major}.{}.0", minimum_minor - 1)
    };
    assert!(selected_manifest(&below_minimum).is_err());
    assert!(selected_manifest(minimum).is_ok());

    let (latest_major, latest_minor, _) = parse_semver(latest).expect("latest semver");
    let latest_capabilities = capabilities_for_version(latest).expect("latest capabilities");
    assert_eq!(latest_capabilities.manifest_version, latest);
    assert!(latest_capabilities.compatibility_warning.is_none());
    let newer = format!("{latest_major}.{}.0", latest_minor + 1);
    assert!(capabilities_for_version(&newer)
        .expect("newer capabilities")
        .compatibility_warning
        .is_some());
}

#[test]
fn capability_gate_reads_bundled_manifests() {
    let old = capabilities_for_version("0.133.0").expect("old capabilities");
    let current = capabilities_for_version("0.144.0").expect("current capabilities");
    assert!(old.supports_account && old.supports_apps && old.supports_mcp);
    assert!(!old.supports_hosted_login_success);
    assert!(!old.supports_writes_approval);
    assert!(!old.supports_last_turn_fork);
    assert!(current.supports_hosted_login_success);
    assert!(current.supports_writes_approval);
    assert!(current.supports_last_turn_fork);
    let newer = capabilities_for_version("0.145.0").expect("newer capabilities");
    assert!(newer.supports_account && newer.supports_apps && newer.supports_mcp);
    assert!(!newer.supports_hosted_login_success);
    assert!(!newer.supports_writes_approval);
    assert!(newer.compatibility_warning.is_some());
}

#[test]
fn request_ids_are_state_monotonic_across_process_generations() {
    let state = CodexHostState::default();
    let first = state
        .next_id
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(2);
    let second = state
        .next_id
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(2);
    assert_eq!((first, second), (2, 3));

    let old_pending = Arc::new(Mutex::new(HashMap::<i64, mpsc::Sender<Value>>::new()));
    let new_pending = Arc::new(Mutex::new(HashMap::<i64, mpsc::Sender<Value>>::new()));
    let (old_tx, _old_rx) = mpsc::channel();
    let (new_tx, _new_rx) = mpsc::channel();
    old_pending
        .lock()
        .expect("old pending")
        .insert(first, old_tx);
    new_pending
        .lock()
        .expect("new pending")
        .insert(second, new_tx);
    old_pending.lock().expect("old cleanup").remove(&first);
    assert!(new_pending
        .lock()
        .expect("new pending remains")
        .contains_key(&second));
}

#[cfg(unix)]
#[test]
fn dropping_host_process_terminates_its_child() {
    let mut core_process = AppServerProcess::spawn(&AppServerProcessConfig {
        executable: "sh".to_string(),
        cwd: None,
        arguments: vec!["-c".to_string(), "sleep 30".to_string()],
        capture_stderr: false,
    })
    .expect("spawn child");
    assert!(core_process.is_alive());
    let process = HostProcess {
        process: core_process,
        pending: Arc::new(Mutex::new(HashMap::new())),
        capabilities: capabilities_for_version("0.144.0").expect("capabilities"),
    };
    drop(process);
}

#[test]
fn global_approval_modes_fail_closed() {
    assert!(is_supported_app_approval_mode("auto"));
    assert!(is_supported_app_approval_mode("prompt"));
    assert!(is_supported_app_approval_mode("writes"));
    assert!(!is_supported_app_approval_mode("approve"));
}

#[test]
fn notifications_are_allowlisted_and_secret_bearing_fields_are_dropped() {
    let notification = sanitize_host_notification("account/login/completed", Some(&json!({
        "loginId": "login-1", "success": false, "error": "token=secret eyJabc", "accessToken": "never"
    }))).expect("safe notification");
    assert_eq!(notification.params.get("loginId"), Some(&json!("login-1")));
    assert_eq!(
        notification.params.get("error"),
        Some(&json!("[redacted] [redacted]"))
    );
    assert!(notification.params.get("accessToken").is_none());
    assert!(sanitize_host_notification(
        "account/chatgptAuthTokens/refresh",
        Some(&json!({ "accessToken": "secret" }))
    )
    .is_none());
}

#[test]
fn host_responses_are_reduced_to_safe_display_fields() {
    let account = parse_account(&json!({ "type": "chatgpt", "email": "dev@example.com", "planType": "plus", "accessToken": "secret" })).expect("account");
    let serialized = serde_json::to_value(account).expect("serialize account");
    assert_eq!(
        serialized,
        json!({ "accountType": "chatgpt", "email": "dev@example.com", "planType": "plus" })
    );
    let apps = parse_apps(&json!({ "data": [{ "id": "drive", "name": "Drive", "isEnabled": true, "isAccessible": true, "installUrl": "https://secret.invalid" }] })).expect("apps");
    assert!(!serde_json::to_value(apps)
        .expect("serialize apps")
        .to_string()
        .contains("installUrl"));
}

#[test]
fn safe_urls_reject_arbitrary_plaintext_origins() {
    assert!(safe_url(Some(&json!("https://auth.openai.com/start")), "url").is_ok());
    assert!(safe_url(Some(&json!("http://localhost:1455/success")), "url").is_ok());
    assert!(safe_url(Some(&json!("http://evil.test/token")), "url").is_err());
    assert!(safe_url(Some(&json!("javascript:alert(1)")), "url").is_err());
}
