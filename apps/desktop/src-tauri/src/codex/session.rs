use super::*;

impl CodexServerSession {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn start(
        app: &tauri::AppHandle,
        rpc_state: CodexRpcState,
        room_id: &str,
        cwd: &str,
        reasoning_effort: &str,
        service_tier: &str,
        sandbox_config: &CodexSandboxConfig,
        timeout: Duration,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        let arguments = vec![
            "-c".to_string(),
            format!("model_reasoning_effort=\"{reasoning_effort}\""),
            "-c".to_string(),
            format!("service_tier=\"{service_tier}\""),
            "-c".to_string(),
            "show_raw_agent_reasoning=true".to_string(),
            "-c".to_string(),
            format!("sandbox_mode=\"{}\"", sandbox_config.sandbox_mode),
            "-c".to_string(),
            format!("approval_policy=\"{}\"", sandbox_config.approval_policy),
            "-c".to_string(),
            format!(
                "sandbox_workspace_write.network_access={}",
                sandbox_config.network_access
            ),
            "app-server".to_string(),
        ];
        let mut process = AppServerProcess::spawn(&AppServerProcessConfig::codex(
            arguments,
            Some(std::path::Path::new(cwd)),
            true,
        ))?;
        let stdin = process.stdin();
        let line_rx = process.take_stdout_lines()?;

        let session_id = allocate_rpc_session_id();
        let mut inbox = RpcInbox::new(line_rx);
        let mut budget = ActiveTimeout::new(timeout);
        let context = RpcRequestContext {
            app,
            state: rpc_state.clone(),
            room_id,
            session_id,
            stdin: stdin.clone(),
            cancelled: Some(cancelled),
            proposed_by: None,
            context_summary: None,
            approved_project_root: Some(std::path::Path::new(cwd)),
        };
        let mut pending_guard = PendingSessionGuard::new(rpc_state.clone(), session_id);
        cleanup_on_error(
            &mut process,
            send_json_shared(
                &stdin,
                json!({
                    "method": "initialize",
                    "id": 1,
                    "params": {
                        "clientInfo": {
                            "name": "multaiplayer",
                            "title": "multAIplayer",
                            "version": env!("CARGO_PKG_VERSION")
                        },
                        "capabilities": {
                            "experimentalApi": true
                        }
                    }
                }),
            ),
        )?;
        cleanup_on_error(
            &mut process,
            wait_for_response(&mut inbox, RpcId::Number(1.into()), &mut budget, &context),
        )?;
        cleanup_on_error(
            &mut process,
            send_json_shared(&stdin, json!({ "method": "initialized", "params": {} })),
        )?;
        pending_guard.disarm();

        Ok(Self {
            process,
            stdin,
            inbox,
            next_id: 2,
            last_used: Instant::now(),
            session_id,
            rpc_state,
            app: app.clone(),
            room_id: room_id.to_string(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn run_turn(
        &mut self,
        cwd: &str,
        input: &str,
        model: &str,
        reasoning_effort: &str,
        service_tier: &str,
        previous_thread_id: Option<&str>,
        client_turn_id: &str,
        timeout: Duration,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
        proposed_by: Option<&str>,
        context_summary: Option<&str>,
        share_raw_reasoning: bool,
    ) -> Result<CodexTurnResult, String> {
        let mut budget = ActiveTimeout::new(timeout);
        let stdin = self.stdin.clone();
        let app = self.app.clone();
        let rpc_state = self.rpc_state.clone();
        let room_id = self.room_id.clone();
        let context = RpcRequestContext {
            app: &app,
            state: rpc_state,
            room_id: &room_id,
            session_id: self.session_id,
            stdin,
            cancelled: Some(cancelled.clone()),
            proposed_by,
            context_summary,
            approved_project_root: Some(std::path::Path::new(cwd)),
        };
        let thread_request_id = self.allocate_id();
        cleanup_on_error(
            &mut self.process,
            send_json_shared(
                &self.stdin,
                codex_thread_request(thread_request_id, previous_thread_id, cwd, model),
            ),
        )?;
        let thread_response = cleanup_on_error(
            &mut self.process,
            wait_for_response_message(
                &mut self.inbox,
                RpcId::Number(thread_request_id.into()),
                &mut budget,
                &context,
            ),
        )?;
        let mut events = Vec::new();
        let mut thread_id = thread_id_from_response(&thread_response, "thread start/resume")
            .or_else(|error| {
                let Some(previous_thread_id) = previous_thread_id else {
                    return Err(error);
                };
                let _ = error;
                events.push(format!(
                    "thread/resume failed; starting a new thread instead of {previous_thread_id}."
                ));
                let fallback_request_id = self.allocate_id();
                cleanup_on_error(
                    &mut self.process,
                    send_json_shared(
                        &self.stdin,
                        codex_thread_start_request(fallback_request_id, cwd, model),
                    ),
                )?;
                let fallback_response = cleanup_on_error(
                    &mut self.process,
                    wait_for_response(
                        &mut self.inbox,
                        RpcId::Number(fallback_request_id.into()),
                        &mut budget,
                        &context,
                    ),
                )?;
                thread_id_from_response(&fallback_response, "thread/start fallback")
            })
            .inspect_err(|_| {
                self.process.terminate();
            })?;
        if previous_thread_id == Some(thread_id.as_str()) {
            events.push(format!("thread/resume: {thread_id}"));
        } else {
            events.push(format!("thread/start: {thread_id}"));
        }

        let turn_request_id = self.allocate_id();
        cleanup_on_error(
            &mut self.process,
            send_json_shared(
                &self.stdin,
                json!({
                    "method": "turn/start",
                    "id": turn_request_id,
                    "params": {
                        "threadId": thread_id,
                        "input": [{ "type": "text", "text": input }],
                        "cwd": cwd,
                        "model": model,
                        "modelReasoningEffort": reasoning_effort,
                        "serviceTier": service_tier
                    }
                }),
            ),
        )?;

        let mut transcript = String::new();
        let mut activity_started_at = HashMap::<String, String>::new();
        let mut generated_images = Vec::new();
        let steering_responses = new_codex_steering_responses();
        let mut active_turn_guard = None;

        let status = loop {
            if cancelled.load(Ordering::Acquire) {
                break "cancelled".to_string();
            }
            if budget.expired(self.rpc_state.has_pending_session(self.session_id)) {
                break "timeout".to_string();
            }

            let message = self
                .inbox
                .deferred
                .pop_front()
                .map(Ok)
                .unwrap_or_else(|| self.inbox.receive(Duration::from_millis(500)));
            match message {
                Ok(RpcMessage::Response { id, value: parsed }) => {
                    if id == RpcId::Number(turn_request_id.into()) {
                        events.push("turn/start acknowledged".to_string());
                        if parsed.get("error").is_some() {
                            events.push("turn/start failed".to_string());
                            break "error".to_string();
                        }
                        let Some(active_turn_id) = parsed
                            .get("result")
                            .and_then(|result| result.get("turn"))
                            .and_then(|turn| turn.get("id"))
                            .and_then(Value::as_str)
                        else {
                            events.push("turn/start omitted the active turn id".to_string());
                            break "error".to_string();
                        };
                        active_turn_guard = Some(register_active_codex_turn(
                            &room_id,
                            self.stdin.clone(),
                            thread_id.clone(),
                            active_turn_id.to_string(),
                            client_turn_id.to_string(),
                            steering_responses.clone(),
                        )?);
                    } else {
                        route_codex_steer_response(&steering_responses, &id, parsed);
                    }
                }
                Ok(RpcMessage::ServerRequest { id, method, params }) => {
                    if let Err(error) =
                        self.rpc_state
                            .register(&context, id, method.clone(), params)
                    {
                        events.push(format!("{method}: request handling failed: {error}"));
                        break "error".to_string();
                    }
                    events.push(method);
                }
                Ok(RpcMessage::Notification {
                    method,
                    value: parsed,
                }) => {
                    if method == "item/completed" && generated_images.len() < 5 {
                        if let Some(image) = project_generated_image(&parsed) {
                            generated_images.push(image);
                        }
                    }
                    if let Some(activity) = project_codex_activity(
                        &method,
                        &parsed,
                        &room_id,
                        client_turn_id,
                        &mut activity_started_at,
                        share_raw_reasoning,
                    ) {
                        let _ = self.app.emit("codex://activity", activity);
                    }
                    if method == "serverRequest/resolved" {
                        if let Some(id) = parsed
                            .get("params")
                            .and_then(|params| params.get("requestId"))
                            .and_then(RpcId::from_value)
                        {
                            if let Some(event) =
                                self.rpc_state.remove_resolved(self.session_id, &id)
                            {
                                let _ = self.app.emit("codex://server-request-resolved", event);
                            }
                        }
                    }
                    if method.contains("agentMessage") || method.contains("message") {
                        if let Some(delta) = core_extract_text_delta(&parsed) {
                            transcript.push_str(&delta);
                        }
                    }

                    events.push(method.clone());

                    if method == "turn/completed" {
                        break parsed
                            .get("params")
                            .and_then(|params| params.get("turn"))
                            .and_then(|turn| turn.get("status"))
                            .and_then(Value::as_str)
                            .unwrap_or("completed")
                            .to_string();
                    }
                }
                Err(error) if error == "timeout" => continue,
                Err(error) => {
                    events.push(error);
                    break "disconnected".to_string();
                }
            }
        };

        self.rpc_state.cancel_session(
            self.session_id,
            "Codex turn ended before the request was answered",
        );
        drop(active_turn_guard);

        self.last_used = Instant::now();
        let stderr = self.process.drain_stderr().join("\n");

        Ok(CodexTurnResult {
            thread_id: Some(std::mem::take(&mut thread_id)),
            status,
            transcript,
            events,
            stderr,
            generated_images,
        })
    }

    pub(super) fn allocate_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub(super) fn is_alive(&mut self) -> bool {
        self.process.is_alive()
    }
}
