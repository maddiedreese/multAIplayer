use serde_json::Value;
use std::collections::VecDeque;
use std::io::Write;
use std::process::ChildStdin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

pub(crate) type SharedStdin = Arc<Mutex<ChildStdin>>;
static NEXT_RPC_SESSION_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn allocate_rpc_session_id() -> u64 {
    NEXT_RPC_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RpcId {
    Number(serde_json::Number),
    String(String),
}

impl RpcId {
    pub(crate) fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::Number(value) if value.as_i64().is_some() => Some(Self::Number(value.clone())),
            Value::String(value) => Some(Self::String(value.clone())),
            _ => None,
        }
    }

    pub(crate) fn to_value(&self) -> Value {
        match self {
            Self::Number(value) => Value::Number(value.clone()),
            Self::String(value) => Value::String(value.clone()),
        }
    }
}

#[derive(Debug)]
pub(crate) enum RpcMessage {
    Response {
        id: RpcId,
        value: Value,
    },
    Notification {
        method: String,
        value: Value,
    },
    ServerRequest {
        id: RpcId,
        method: String,
        params: Value,
    },
}

#[derive(Debug)]
pub(crate) struct RpcInbox {
    line_rx: mpsc::Receiver<String>,
    pub(crate) deferred: VecDeque<RpcMessage>,
}

impl RpcInbox {
    pub(crate) fn new(line_rx: mpsc::Receiver<String>) -> Self {
        Self {
            line_rx,
            deferred: VecDeque::new(),
        }
    }

    pub(crate) fn receive(&self, wait: Duration) -> Result<RpcMessage, String> {
        let line = self
            .line_rx
            .recv_timeout(wait)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => "timeout".to_string(),
                mpsc::RecvTimeoutError::Disconnected => {
                    "App-server response channel disconnected".to_string()
                }
            })?;
        classify_rpc_line(&line)
    }
}

pub(crate) fn classify_rpc_line(line: &str) -> Result<RpcMessage, String> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| format!("Invalid app-server JSON line: {error}"))?;
    let method = value.get("method").and_then(Value::as_str);
    let id = value.get("id").and_then(RpcId::from_value);
    let has_result = value.get("result").is_some();
    let has_error = value.get("error").is_some();
    match (method, id) {
        // Direction wins over ID equality: client and server request IDs may collide.
        (Some(method), Some(id)) => Ok(RpcMessage::ServerRequest {
            id,
            method: method.to_string(),
            params: value.get("params").cloned().unwrap_or(Value::Null),
        }),
        (Some(method), None) => Ok(RpcMessage::Notification {
            method: method.to_string(),
            value,
        }),
        (None, Some(id)) if has_result != has_error => Ok(RpcMessage::Response { id, value }),
        (None, Some(_)) => Err("Invalid app-server response envelope".to_string()),
        (None, None) => Err("Invalid app-server message: expected method or id".to_string()),
    }
}

pub(crate) fn send_json_shared(stdin: &SharedStdin, value: Value) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Codex app-server stdin is unavailable".to_string())?;
    writeln!(stdin, "{value}")
        .map_err(|error| format!("Failed to write app-server JSON: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed to flush app-server stdin: {error}"))
}

pub(crate) struct ActiveTimeout {
    limit: Duration,
    consumed: Duration,
    last_checked: Instant,
    was_waiting_for_human: bool,
}

impl ActiveTimeout {
    pub(crate) fn new(limit: Duration) -> Self {
        Self {
            limit,
            consumed: Duration::ZERO,
            last_checked: Instant::now(),
            was_waiting_for_human: false,
        }
    }

    pub(crate) fn expired(&mut self, waiting_for_human: bool) -> bool {
        self.observe(Instant::now(), waiting_for_human)
    }

    fn observe(&mut self, now: Instant, waiting_for_human: bool) -> bool {
        if !self.was_waiting_for_human && !waiting_for_human {
            self.consumed = self
                .consumed
                .saturating_add(now.saturating_duration_since(self.last_checked));
        }
        self.last_checked = now;
        self.was_waiting_for_human = waiting_for_human;
        self.consumed > self.limit
    }
}

pub(crate) fn wait_for_response(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    mut handle_request: impl FnMut(RpcId, String, Value) -> Result<(), String>,
    mut is_waiting_for_human: impl FnMut() -> bool,
    mut is_cancelled: impl FnMut() -> bool,
) -> Result<Value, String> {
    let parsed = wait_for_response_message(
        inbox,
        id.clone(),
        budget,
        &mut handle_request,
        &mut is_waiting_for_human,
        &mut is_cancelled,
    )?;
    if let Some(error) = parsed.get("error") {
        return Err(format!("App-server request {:?} failed: {error}", id));
    }
    Ok(parsed)
}

pub(crate) fn wait_for_response_message(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    handle_request: &mut impl FnMut(RpcId, String, Value) -> Result<(), String>,
    is_waiting_for_human: &mut impl FnMut() -> bool,
    is_cancelled: &mut impl FnMut() -> bool,
) -> Result<Value, String> {
    loop {
        if is_cancelled() {
            return Err(
                "Codex turn was cancelled because the room host context changed".to_string(),
            );
        }
        if let Some(index) = inbox.deferred.iter().position(
            |message| matches!(message, RpcMessage::Response { id: response_id, .. } if response_id == &id),
        ) {
            if let Some(RpcMessage::Response { value, .. }) = inbox.deferred.remove(index) {
                return Ok(value);
            }
        }
        if budget.expired(is_waiting_for_human()) {
            return Err(format!(
                "Timed out waiting for app-server response id {:?}",
                id
            ));
        }
        match inbox.receive(Duration::from_millis(500)) {
            Ok(RpcMessage::Response {
                id: response_id,
                value,
            }) if response_id == id => return Ok(value),
            Ok(RpcMessage::ServerRequest { id, method, params }) => {
                handle_request(id, method, params)?;
            }
            Ok(message) => inbox.deferred.push_back(message),
            Err(error) if error == "timeout" => {}
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifier_accepts_both_id_types_and_prefers_server_requests() {
        assert!(matches!(
            classify_rpc_line(r#"{"id":7,"result":{}}"#).unwrap(),
            RpcMessage::Response {
                id: RpcId::Number(_),
                ..
            }
        ));
        assert!(matches!(
            classify_rpc_line(r#"{"id":"7","method":"request","params":{}}"#).unwrap(),
            RpcMessage::ServerRequest { id: RpcId::String(id), .. } if id == "7"
        ));
    }

    #[test]
    fn human_wait_pauses_active_time_but_not_wall_time_tracking() {
        let start = Instant::now();
        let mut timeout = ActiveTimeout::new(Duration::from_secs(2));
        timeout.last_checked = start;
        assert!(!timeout.observe(start + Duration::from_secs(1), false));
        assert!(!timeout.observe(start + Duration::from_secs(60), true));
        assert!(!timeout.observe(start + Duration::from_secs(61), false));
        assert!(timeout.observe(start + Duration::from_secs(63), false));
    }

    #[test]
    fn invalid_envelopes_do_not_echo_payloads() {
        let error = classify_rpc_line(r#"{"secret":"do-not-log"}"#).unwrap_err();
        assert!(!error.contains("do-not-log"));
        assert!(classify_rpc_line(r#"{"id":1,"result":{},"error":{}}"#).is_err());
    }
}
