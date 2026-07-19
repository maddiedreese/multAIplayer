use codex_host_core::host::{
    capabilities_for_version, classify_rpc_line, thread_request, RpcMessage,
};

#[test]
fn cli_adapter_compiles_against_the_ui_independent_host_boundary() {
    let capabilities = capabilities_for_version("0.144.0").expect("tested compatibility");
    assert!(capabilities.supports_method("thread/start"));
    assert!(!capabilities.supports_method("unknown/privileged"));
    assert!(capabilities.supports_server_request("item/fileChange/requestApproval"));
    assert!(!capabilities.supports_server_request("unknown/privileged"));

    let request = thread_request(7, Some("thread-1"), "/tmp/project", "gpt-5.6-sol");
    assert_eq!(request["method"], "thread/resume");
    assert_eq!(request["params"]["excludeTurns"], true);

    let parsed = classify_rpc_line(r#"{"id":7,"result":{}}"#).expect("response");
    assert!(matches!(parsed, RpcMessage::Response { .. }));
}

#[test]
fn cli_adapter_observes_the_same_fail_closed_contract() {
    assert!(classify_rpc_line(r#"{"id":7,"result":{},"error":{}}"#).is_err());
    assert!(capabilities_for_version("0.132.9").is_err());
}
