use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::codex_rpc::{send_json_shared, RpcId, SharedStdin};
use crate::validation::{ensure_codex_input, ensure_room_id};

pub(crate) type CodexSteeringResponses = Arc<Mutex<HashMap<i64, mpsc::Sender<Value>>>>;

static ACTIVE_CODEX_TURNS: OnceLock<Mutex<HashMap<String, ActiveCodexTurn>>> = OnceLock::new();
static NEXT_ACTIVE_TURN_TOKEN: AtomicU64 = AtomicU64::new(1);
static NEXT_STEER_REQUEST_ID: AtomicI64 = AtomicI64::new(-1);

#[derive(Clone)]
struct ActiveCodexTurn {
    token: u64,
    stdin: SharedStdin,
    thread_id: String,
    turn_id: String,
    client_turn_id: String,
    responses: CodexSteeringResponses,
}

pub(crate) struct ActiveCodexTurnGuard {
    room_id: String,
    token: u64,
    responses: CodexSteeringResponses,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSteerRequest {
    room_id: String,
    input: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSteerResult {
    thread_id: String,
    turn_id: String,
    client_turn_id: String,
}

#[typed_tauri_command::command]
pub(crate) fn steer_codex_turn(
    request: CodexSteerRequest,
) -> crate::command_error::CommandResult<CodexSteerResult> {
    ensure_room_id(&request.room_id)
        .map_err(crate::command_error::CommandError::invalid_argument)?;
    ensure_codex_input(&request.input)
        .map_err(crate::command_error::CommandError::invalid_argument)?;
    let active = ACTIVE_CODEX_TURNS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| {
            crate::command_error::CommandError::unavailable(
                "Active Codex turn state is unavailable",
            )
        })?
        .get(&request.room_id)
        .cloned()
        .ok_or_else(|| {
            crate::command_error::CommandError::unavailable(
                "The active Codex turn is not ready to be steered. Retry, or queue the message for the next turn.",
            )
        })?;
    let request_id = NEXT_STEER_REQUEST_ID.fetch_sub(1, Ordering::Relaxed);
    let (response_tx, response_rx) = mpsc::channel();
    active
        .responses
        .lock()
        .map_err(|_| {
            crate::command_error::CommandError::unavailable(
                "Codex steering response state is unavailable",
            )
        })?
        .insert(request_id, response_tx);
    let send_result = send_to_active_codex_turn(
        &request.room_id,
        active.token,
        &active.stdin,
        codex_steer_request(
            request_id,
            &active.thread_id,
            &active.turn_id,
            &request.input,
        ),
    );
    if let Err(error) = send_result {
        remove_pending_response(&active.responses, request_id);
        return Err(crate::command_error::CommandError::process(error));
    }
    let response = match response_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(response) => response,
        Err(_) => {
            remove_pending_response(&active.responses, request_id);
            return Err(crate::command_error::CommandError::process(
                "Timed out waiting for Codex to acknowledge the steering message",
            ));
        }
    };
    parse_codex_steer_response(&response, &active.turn_id)
        .map_err(crate::command_error::CommandError::process)?;
    Ok(CodexSteerResult {
        thread_id: active.thread_id,
        turn_id: active.turn_id,
        client_turn_id: active.client_turn_id,
    })
}

pub(crate) fn new_codex_steering_responses() -> CodexSteeringResponses {
    Arc::new(Mutex::new(HashMap::new()))
}

pub(crate) fn register_active_codex_turn(
    room_id: &str,
    stdin: SharedStdin,
    thread_id: String,
    turn_id: String,
    client_turn_id: String,
    responses: CodexSteeringResponses,
) -> Result<ActiveCodexTurnGuard, String> {
    let token = NEXT_ACTIVE_TURN_TOKEN.fetch_add(1, Ordering::Relaxed);
    let replaced = ACTIVE_CODEX_TURNS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Active Codex turn state is unavailable".to_string())?
        .insert(
            room_id.to_string(),
            ActiveCodexTurn {
                token,
                stdin,
                thread_id,
                turn_id,
                client_turn_id,
                responses: responses.clone(),
            },
        );
    if let Some(replaced) = replaced {
        cancel_pending_responses(&replaced.responses);
    }
    Ok(ActiveCodexTurnGuard {
        room_id: room_id.to_string(),
        token,
        responses,
    })
}

pub(crate) fn route_codex_steer_response(
    responses: &CodexSteeringResponses,
    id: &RpcId,
    value: Value,
) -> bool {
    let RpcId::Number(number) = id else {
        return false;
    };
    let Some(request_id) = number.as_i64() else {
        return false;
    };
    let response = responses
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&request_id));
    response.is_some_and(|response| response.send(value).is_ok())
}

fn remove_pending_response(responses: &CodexSteeringResponses, request_id: i64) {
    if let Ok(mut responses) = responses.lock() {
        responses.remove(&request_id);
    }
}

fn send_to_active_codex_turn(
    room_id: &str,
    token: u64,
    stdin: &SharedStdin,
    request: Value,
) -> Result<(), String> {
    let active_turns = ACTIVE_CODEX_TURNS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Active Codex turn state is unavailable".to_string())?;
    if active_turns
        .get(room_id)
        .is_none_or(|active| active.token != token)
    {
        return Err("The active Codex turn ended before it could be steered".to_string());
    }
    send_json_shared(stdin, request)
}

fn cancel_pending_responses(responses: &CodexSteeringResponses) {
    let pending = responses
        .lock()
        .map(|mut pending| {
            pending
                .drain()
                .map(|(_, sender)| sender)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for sender in pending {
        let _ = sender.send(json!({
            "error": { "message": "The active Codex turn ended before steering was acknowledged" }
        }));
    }
}

fn codex_steer_request(request_id: i64, thread_id: &str, turn_id: &str, input: &str) -> Value {
    json!({
        "method": "turn/steer",
        "id": request_id,
        "params": {
            "threadId": thread_id,
            "expectedTurnId": turn_id,
            "input": [{ "type": "text", "text": input }]
        }
    })
}

fn parse_codex_steer_response(response: &Value, expected_turn_id: &str) -> Result<(), String> {
    if response.get("error").is_some() {
        return Err("Codex rejected the steering message".to_string());
    }
    let response_turn_id = response
        .get("result")
        .and_then(|result| result.get("turnId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "turn/steer did not return a turn id".to_string())?;
    if response_turn_id != expected_turn_id {
        return Err("Codex acknowledged steering for a different active turn".to_string());
    }
    Ok(())
}

impl Drop for ActiveCodexTurnGuard {
    fn drop(&mut self) {
        if let Ok(mut active_turns) = ACTIVE_CODEX_TURNS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
        {
            if active_turns
                .get(&self.room_id)
                .is_some_and(|active| active.token == self.token)
            {
                active_turns.remove(&self.room_id);
            }
        }
        cancel_pending_responses(&self.responses);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_emits_typed_validation_and_availability_codes() {
        let invalid = steer_codex_turn(CodexSteerRequest {
            room_id: "".to_string(),
            input: "steer".to_string(),
        })
        .expect_err("empty room id should fail validation");
        assert_eq!(
            invalid.code,
            crate::command_error::CommandErrorCode::InvalidArgument
        );

        let unavailable = steer_codex_turn(CodexSteerRequest {
            room_id: "native-error-code-no-active-turn".to_string(),
            input: "steer".to_string(),
        })
        .expect_err("room without active turn should be unavailable");
        assert_eq!(
            unavailable.code,
            crate::command_error::CommandErrorCode::Unavailable
        );
    }

    #[test]
    fn steering_request_binds_the_expected_active_turn() {
        assert_eq!(
            codex_steer_request(-7, "thread-1", "turn-2", "change direction"),
            json!({
                "method": "turn/steer",
                "id": -7,
                "params": {
                    "threadId": "thread-1",
                    "expectedTurnId": "turn-2",
                    "input": [{ "type": "text", "text": "change direction" }]
                }
            })
        );
    }

    #[test]
    fn steering_response_must_acknowledge_the_expected_turn() {
        assert!(
            parse_codex_steer_response(&json!({"result":{"turnId":"turn-2"}}), "turn-2").is_ok()
        );
        assert!(
            parse_codex_steer_response(&json!({"result":{"turnId":"turn-other"}}), "turn-2")
                .is_err()
        );
        assert!(parse_codex_steer_response(
            &json!({"error":{"message":"not steerable: secret-input"}}),
            "turn-2"
        )
        .is_err());
        let rejected = parse_codex_steer_response(
            &json!({"error":{"message":"not steerable: secret-input"}}),
            "turn-2",
        )
        .expect_err("rejected response");
        assert!(!rejected.contains("secret-input"));
        let malformed =
            parse_codex_steer_response(&json!({"result":{"unexpected":"secret-result"}}), "turn-2")
                .expect_err("malformed response");
        assert!(!malformed.contains("secret-result"));
    }

    #[test]
    fn steering_response_routes_only_to_its_correlated_request() {
        let responses = new_codex_steering_responses();
        let (tx, rx) = mpsc::channel();
        responses.lock().expect("responses").insert(-3, tx);
        assert!(!route_codex_steer_response(
            &responses,
            &RpcId::Number(4.into()),
            json!({"result":{"turnId":"turn-2"}})
        ));
        assert!(route_codex_steer_response(
            &responses,
            &RpcId::Number((-3).into()),
            json!({"result":{"turnId":"turn-2"}})
        ));
        assert_eq!(rx.recv().expect("response")["result"]["turnId"], "turn-2");
    }

    #[test]
    fn ending_a_turn_releases_all_pending_steering_waiters() {
        let responses = new_codex_steering_responses();
        let (first_tx, first_rx) = mpsc::channel();
        let (second_tx, second_rx) = mpsc::channel();
        responses.lock().expect("responses").insert(-10, first_tx);
        responses.lock().expect("responses").insert(-11, second_tx);

        cancel_pending_responses(&responses);

        assert!(first_rx
            .recv()
            .expect("first cancellation")
            .get("error")
            .is_some());
        assert!(second_rx
            .recv()
            .expect("second cancellation")
            .get("error")
            .is_some());
        assert!(responses.lock().expect("responses").is_empty());
        assert!(!route_codex_steer_response(
            &responses,
            &RpcId::Number((-10).into()),
            json!({"result":{"turnId":"late-turn"}})
        ));
    }
}
