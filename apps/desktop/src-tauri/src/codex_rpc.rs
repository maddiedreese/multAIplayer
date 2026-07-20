//! Thin desktop adapter over the UI-independent Codex host RPC core.

#[cfg(test)]
use codex_activity_projection::host::classify_rpc_line;
pub(crate) use codex_activity_projection::host::{
    allocate_rpc_session_id, send_json_shared, wait_for_response, wait_for_response_message,
    ActiveTimeout, RpcId, RpcInbox, RpcMessage, SharedStdin,
};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn desktop_adapter_preserves_core_rpc_classification() {
        let line = json!({"id":"request-7", "method":"item/commandExecution/requestApproval", "params":{}}).to_string();
        let adapted = classify_rpc_line(&line).expect("desktop adapter classification");
        let core = codex_activity_projection::host::classify_rpc_line(&line)
            .expect("host core classification");
        assert_eq!(adapted, core);
    }

    #[test]
    fn desktop_adapter_keeps_ambiguous_envelopes_fail_closed() {
        let line = r#"{"id":1,"result":{},"error":{"message":"token=secret"}}"#;
        let error = classify_rpc_line(line).expect_err("ambiguous envelope must fail");
        assert_eq!(error, "Invalid app-server response envelope");
        assert!(!error.contains("secret"));
    }
}
