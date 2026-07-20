use codex_host_core::host::{
    allocate_rpc_session_id, capabilities_for_version, extract_text_delta, send_json_shared,
    thread_id_from_response, thread_request, ActiveTimeout, AppServerProcess,
    AppServerProcessConfig, RpcId, RpcInbox, RpcMessage,
};
use multaiplayer_protocol::{
    CatalogSelectionPolicy, ChatPlaintextPayload, ChatRole, CodexActivityPlaintextPayload,
    CodexReasoningEffort, CodexSandboxLevel, CodexSpeed, Validate,
};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

pub const PROPOSAL_TTL_SECONDS: i64 = 15 * 60;
pub const MAX_CONTEXT_MESSAGES: usize = 32;
pub const MAX_CONTEXT_MESSAGE_CHARS: usize = 2_000;
pub const MAX_CONTEXT_CHARS: usize = 24_000;
pub const MAX_ASSISTANT_CHARS: usize = 120_000;
pub const PRIVILEGED_REQUEST_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PRIVILEGED_PARAMS_BYTES: usize = 256 * 1024;
const MAX_PRIVILEGED_TEXT_CHARS: usize = 8_000;

const INTERACTIVE_SERVER_METHODS: &[&str] = &[
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "tool/requestUserInput",
    "mcpServer/elicitation/request",
    "applyPatchApproval",
    "execCommandApproval",
];
static NEXT_PRIVILEGED_REQUEST_KEY: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexProposal {
    pub room_id: String,
    pub proposal_id: String,
    pub proposer: String,
    pub proposer_user_id: String,
    pub task: String,
    pub created_at: String,
    pub expires_at_unix: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalPhase {
    Idle,
    Proposed,
    Approved,
    Starting,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ProposalError {
    #[error("The Codex proposal is invalid or exceeds its bounds.")]
    Invalid,
    #[error("This room already has a pending proposal or active turn.")]
    Busy,
    #[error("The proposal does not match this room and exact proposal id.")]
    BindingMismatch,
    #[error("The proposal expired before approval.")]
    Expired,
    #[error("Only the current active host can approve or start this turn.")]
    NotActiveHost,
    #[error("The proposal transition is invalid.")]
    InvalidTransition,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalMachine {
    room_id: String,
    phase: ProposalPhase,
    proposal: Option<CodexProposal>,
    completed_ids: BTreeSet<String>,
}

impl ProposalMachine {
    pub fn new(room_id: &str) -> Result<Self, ProposalError> {
        if !bounded_identifier(room_id, 160) {
            return Err(ProposalError::Invalid);
        }
        Ok(Self {
            room_id: room_id.to_owned(),
            phase: ProposalPhase::Idle,
            proposal: None,
            completed_ids: BTreeSet::new(),
        })
    }

    pub fn phase(&self) -> ProposalPhase {
        self.phase
    }

    pub fn pending(&self) -> Option<&CodexProposal> {
        self.proposal.as_ref()
    }

    pub fn observe(
        &mut self,
        proposal: CodexProposal,
        now_unix: i64,
    ) -> Result<bool, ProposalError> {
        validate_proposal(&proposal)?;
        if proposal.room_id != self.room_id {
            return Err(ProposalError::BindingMismatch);
        }
        if self.completed_ids.contains(&proposal.proposal_id) {
            return Ok(false);
        }
        if proposal.expires_at_unix <= now_unix {
            return Err(ProposalError::Expired);
        }
        if let Some(current) = &self.proposal {
            if current == &proposal {
                return Ok(false);
            }
            return Err(ProposalError::Busy);
        }
        if !matches!(
            self.phase,
            ProposalPhase::Idle
                | ProposalPhase::Completed
                | ProposalPhase::Failed
                | ProposalPhase::Cancelled
        ) {
            return Err(ProposalError::Busy);
        }
        self.phase = ProposalPhase::Proposed;
        self.proposal = Some(proposal);
        Ok(true)
    }

    pub fn approve(
        &mut self,
        room_id: &str,
        proposal_id: &str,
        now_unix: i64,
        active_host: bool,
    ) -> Result<bool, ProposalError> {
        if room_id == self.room_id && self.completed_ids.contains(proposal_id) {
            return Ok(false);
        }
        self.require_binding(room_id, proposal_id)?;
        if !active_host {
            return Err(ProposalError::NotActiveHost);
        }
        let proposal = self
            .proposal
            .as_ref()
            .ok_or(ProposalError::BindingMismatch)?;
        if proposal.expires_at_unix <= now_unix {
            self.phase = ProposalPhase::Cancelled;
            self.finish_current();
            return Err(ProposalError::Expired);
        }
        if self.phase == ProposalPhase::Approved {
            return Ok(false);
        }
        if self.phase != ProposalPhase::Proposed {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Approved;
        Ok(true)
    }

    pub fn start(
        &mut self,
        room_id: &str,
        proposal_id: &str,
        active_host: bool,
    ) -> Result<(), ProposalError> {
        self.require_binding(room_id, proposal_id)?;
        if !active_host {
            return Err(ProposalError::NotActiveHost);
        }
        if self.phase != ProposalPhase::Approved {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Starting;
        self.phase = ProposalPhase::Running;
        Ok(())
    }

    pub fn cancel(&mut self, room_id: &str, proposal_id: &str) -> Result<bool, ProposalError> {
        if room_id == self.room_id && self.completed_ids.contains(proposal_id) {
            return Ok(false);
        }
        self.require_binding(room_id, proposal_id)?;
        if self.phase == ProposalPhase::Cancelled {
            return Ok(false);
        }
        if matches!(self.phase, ProposalPhase::Completed | ProposalPhase::Failed) {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Cancelled;
        self.finish_current();
        Ok(true)
    }

    pub fn complete(
        &mut self,
        room_id: &str,
        proposal_id: &str,
        active_host: bool,
    ) -> Result<bool, ProposalError> {
        if room_id == self.room_id && self.completed_ids.contains(proposal_id) {
            return Ok(false);
        }
        self.require_binding(room_id, proposal_id)?;
        if !active_host {
            self.phase = ProposalPhase::Cancelled;
            self.finish_current();
            return Err(ProposalError::NotActiveHost);
        }
        if self.phase == ProposalPhase::Completed {
            return Ok(false);
        }
        if self.phase != ProposalPhase::Running {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Completed;
        self.finish_current();
        Ok(true)
    }

    pub fn fail(&mut self, room_id: &str, proposal_id: &str) -> Result<(), ProposalError> {
        self.require_binding(room_id, proposal_id)?;
        if !matches!(self.phase, ProposalPhase::Starting | ProposalPhase::Running) {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Failed;
        self.finish_current();
        Ok(())
    }

    pub fn observe_started(
        &mut self,
        room_id: &str,
        proposal_id: &str,
    ) -> Result<(), ProposalError> {
        if room_id != self.room_id {
            return Err(ProposalError::BindingMismatch);
        }
        if self.completed_ids.contains(proposal_id) || self.phase == ProposalPhase::Running {
            return Ok(());
        }
        self.require_binding(room_id, proposal_id)?;
        if self.phase != ProposalPhase::Proposed {
            return Err(ProposalError::InvalidTransition);
        }
        // A persisted started event without a live worker is an interrupted
        // execution. Mark it terminal so restart can never duplicate the turn.
        self.phase = ProposalPhase::Cancelled;
        self.finish_current();
        Ok(())
    }

    fn require_binding(&self, room_id: &str, proposal_id: &str) -> Result<(), ProposalError> {
        if room_id != self.room_id
            || self
                .proposal
                .as_ref()
                .is_none_or(|proposal| proposal.proposal_id != proposal_id)
        {
            Err(ProposalError::BindingMismatch)
        } else {
            Ok(())
        }
    }

    fn finish_current(&mut self) {
        if let Some(proposal) = self.proposal.take() {
            self.completed_ids.insert(proposal.proposal_id);
            while self.completed_ids.len() > 256 {
                if let Some(first) = self.completed_ids.iter().next().cloned() {
                    self.completed_ids.remove(&first);
                }
            }
        }
    }
}

fn validate_proposal(proposal: &CodexProposal) -> Result<(), ProposalError> {
    if !bounded_identifier(&proposal.room_id, 160)
        || !bounded_identifier(&proposal.proposal_id, 160)
        || !bounded_text(&proposal.proposer, 120)
        || !bounded_identifier(&proposal.proposer_user_id, 128)
        || proposal.task.trim().is_empty()
        || proposal.task.chars().count() > 4_096
        || proposal.created_at.chars().count() > 64
        || proposal.expires_at_unix <= 0
    {
        Err(ProposalError::Invalid)
    } else {
        Ok(())
    }
}

fn bounded_identifier(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContextExtent {
    pub included_messages: usize,
    pub excluded_messages: usize,
    pub included_chars: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuiltContext {
    pub input: String,
    pub extent: ContextExtent,
}

pub fn build_bounded_context(
    proposal: &CodexProposal,
    history: &[ChatPlaintextPayload],
    participant_display_names: &[String],
    room_model_intent: &str,
) -> Result<BuiltContext, ProposalError> {
    validate_proposal(proposal)?;
    let task = sanitize_context_text(&proposal.task, 4_096);
    if task.trim().is_empty() {
        return Err(ProposalError::Invalid);
    }
    let mut participants = participant_display_names
        .iter()
        .map(|name| sanitize_context_text(name, 120))
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    participants.sort();
    participants.dedup();
    participants.truncate(32);
    let model_intent = sanitize_context_text(room_model_intent, 80);
    let mut input = format!(
        "Room proposal by {}:\n{}\n\nParticipants: {}\nRoom model intent: {}\n\nBounded room transcript:\n",
        sanitize_context_text(&proposal.proposer, 120),
        task,
        participants.join(", "),
        model_intent
    );
    let mut included_messages = 0;
    let mut excluded_messages = 0;
    let recent = history
        .iter()
        .rev()
        .take(MAX_CONTEXT_MESSAGES.saturating_mul(2))
        .collect::<Vec<_>>();
    for message in recent.into_iter().rev() {
        if included_messages >= MAX_CONTEXT_MESSAGES {
            excluded_messages += 1;
            continue;
        }
        let body = sanitize_context_text(&message.body, MAX_CONTEXT_MESSAGE_CHARS);
        if body.is_empty() || body == "[excluded]" {
            excluded_messages += 1;
            continue;
        }
        let role = match message.role {
            ChatRole::Human => "participant",
            ChatRole::Codex => "assistant",
            ChatRole::System => {
                excluded_messages += 1;
                continue;
            }
        };
        let line = format!(
            "- {role} {}: {}\n",
            sanitize_context_text(&message.author, 120),
            body
        );
        if input.chars().count().saturating_add(line.chars().count()) > MAX_CONTEXT_CHARS {
            excluded_messages += 1;
            continue;
        }
        input.push_str(&line);
        included_messages += 1;
    }
    if input.chars().count() > MAX_CONTEXT_CHARS {
        input = input.chars().take(MAX_CONTEXT_CHARS).collect();
    }
    Ok(BuiltContext {
        extent: ContextExtent {
            included_messages,
            excluded_messages,
            included_chars: input.chars().count(),
        },
        input,
    })
}

fn sanitize_context_text(value: &str, max_chars: usize) -> String {
    let bounded = value.chars().take(max_chars).collect::<String>();
    let mut output = Vec::new();
    for token in bounded.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        let secret_like = [
            "token",
            "secret",
            "password",
            "authorization",
            "cookie",
            "api_key",
            "apikey",
            "passphrase",
            "multaiplayerjoin=",
            ".env",
        ]
        .iter()
        .any(|marker| lower.contains(marker));
        let local_path = token.starts_with('/')
            || token.starts_with("~/")
            || token.starts_with("file://")
            || token.contains("/Users/")
            || token.contains("/private/");
        if secret_like || local_path {
            output.push("[excluded]");
        } else {
            output.push(token);
        }
    }
    let rendered = output.join(" ");
    if rendered
        .split_whitespace()
        .all(|token| token == "[excluded]")
    {
        "[excluded]".to_owned()
    } else {
        rendered
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexTurnSettings {
    pub model: String,
    pub model_policy: CatalogSelectionPolicy,
    pub reasoning_effort: CodexReasoningEffort,
    pub reasoning_policy: CatalogSelectionPolicy,
    pub speed: CodexSpeed,
    pub service_tier_policy: CatalogSelectionPolicy,
    pub sandbox: CodexSandboxLevel,
}

impl Default for CodexTurnSettings {
    fn default() -> Self {
        Self {
            model: "gpt-5.6-sol".to_owned(),
            model_policy: CatalogSelectionPolicy::Auto,
            reasoning_effort: CodexReasoningEffort::Medium,
            reasoning_policy: CatalogSelectionPolicy::Auto,
            speed: CodexSpeed::Standard,
            service_tier_policy: CatalogSelectionPolicy::Auto,
            sandbox: CodexSandboxLevel::WorkspaceWrite,
        }
    }
}

impl CodexTurnSettings {
    pub fn reasoning_label(&self) -> &'static str {
        match self.reasoning_effort {
            CodexReasoningEffort::None => "none",
            CodexReasoningEffort::Minimal => "minimal",
            CodexReasoningEffort::Low => "low",
            CodexReasoningEffort::Medium => "medium",
            CodexReasoningEffort::High => "high",
            CodexReasoningEffort::Xhigh => "xhigh",
            CodexReasoningEffort::Max => "max",
        }
    }

    pub fn service_tier(&self) -> &'static str {
        match self.speed {
            CodexSpeed::Standard => "default",
            CodexSpeed::Fast => "fast",
        }
    }

    pub fn sandbox_label(&self) -> &'static str {
        match self.sandbox {
            CodexSandboxLevel::ReadOnly => "read_only",
            CodexSandboxLevel::WorkspaceWrite => "workspace_write",
            CodexSandboxLevel::WorkspaceWriteNetwork => "workspace_write_network",
            CodexSandboxLevel::DangerFullAccess => "danger_full_access",
        }
    }

    fn sandbox_process_mode(&self) -> &'static str {
        match self.sandbox {
            CodexSandboxLevel::ReadOnly => "read-only",
            CodexSandboxLevel::WorkspaceWrite | CodexSandboxLevel::WorkspaceWriteNetwork => {
                "workspace-write"
            }
            CodexSandboxLevel::DangerFullAccess => "danger-full-access",
        }
    }

    fn network_access(&self) -> bool {
        matches!(
            self.sandbox,
            CodexSandboxLevel::WorkspaceWriteNetwork | CodexSandboxLevel::DangerFullAccess
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostPreview {
    pub proposal_id: String,
    pub proposer: String,
    pub task: String,
    pub room_name: String,
    pub project_association: String,
    pub context_extent: ContextExtent,
    pub effective_model: String,
    pub service_tier: String,
    pub reasoning_effort: String,
    pub sandbox: String,
}

impl HostPreview {
    pub fn trusted_text(&self) -> String {
        format!(
            "Codex proposal: {}\nProposer: {}\nTask: {}\nRoom: {}\nProject association: {}\nContext: {} messages, {} excluded, {} chars\nEffective model: {}\nService tier: {}\nReasoning effort: {}\nSandbox: {}\nApprove with: /approve {}\nDeny with: /deny {}",
            self.proposal_id,
            self.proposer,
            self.task,
            self.room_name,
            self.project_association,
            self.context_extent.included_messages,
            self.context_extent.excluded_messages,
            self.context_extent.included_chars,
            self.effective_model,
            self.service_tier,
            self.reasoning_effort,
            self.sandbox,
            self.proposal_id,
            self.proposal_id,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedTurnRequest {
    pub project_path: PathBuf,
    pub input: String,
    pub settings: CodexTurnSettings,
    pub previous_thread_id: Option<String>,
    pub timeout: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedTurnResult {
    pub thread_id: String,
    pub assistant_message: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PrivilegedDecision {
    Approve,
    Deny,
    Respond(Value),
}

#[derive(Clone, Debug, PartialEq)]
pub struct PrivilegedRequestPrompt {
    pub request_key: String,
    pub room_id: String,
    pub session_id: u64,
    pub request_id: RpcId,
    pub method: String,
    pub params: Value,
    pub expires_at_unix_ms: u64,
}

impl PrivilegedRequestPrompt {
    pub fn trusted_text(&self) -> String {
        let params = safe_terminal_text(&self.params.to_string(), MAX_PRIVILEGED_TEXT_CHARS);
        let response_help = if matches!(
            self.method.as_str(),
            "item/tool/requestUserInput"
                | "tool/requestUserInput"
                | "mcpServer/elicitation/request"
        ) {
            format!(
                "Respond with: /respond {} <JSON response>",
                self.request_key
            )
        } else {
            format!(
                "Approve with: /approve {}\nDeny with: /deny {}",
                self.request_key, self.request_key
            )
        };
        format!(
            "Codex privileged request\nRoom: {}\nRequest: {}\nMethod: {}\nExpires: {}\nProjected request: {}\n{}",
            safe_terminal_text(&self.room_id, 160),
            safe_terminal_text(&self.request_key, 160),
            safe_terminal_text(&self.method, 256),
            self.expires_at_unix_ms,
            params,
            response_help,
        )
    }

    pub fn response(
        &self,
        decision: PrivilegedDecision,
        active_host: bool,
    ) -> Result<PrivilegedResponse, HostedTurnError> {
        if !active_host {
            return Err(HostedTurnError::Cancelled);
        }
        let now_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| HostedTurnError::InvalidResponse)?
            .as_millis()
            .min(u64::MAX as u128) as u64;
        if now_unix_ms >= self.expires_at_unix_ms {
            return Err(HostedTurnError::Timeout);
        }
        validate_privileged_result(&self.method, &self.params, &decision)
            .map_err(|_| HostedTurnError::InvalidResponse)?;
        Ok(PrivilegedResponse {
            request_key: self.request_key.clone(),
            room_id: self.room_id.clone(),
            session_id: self.session_id,
            request_id: self.request_id.clone(),
            method: self.method.clone(),
            active_host,
            decision,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PrivilegedResponse {
    pub request_key: String,
    pub room_id: String,
    pub session_id: u64,
    pub request_id: RpcId,
    pub method: String,
    pub active_host: bool,
    pub decision: PrivilegedDecision,
}

#[derive(Clone, Debug, PartialEq)]
pub enum HostedTurnEvent {
    PrivilegedRequest(PrivilegedRequestPrompt),
    Activity(Box<CodexActivityPlaintextPayload>),
}

pub struct HostedTurnInteraction {
    event_rx: mpsc::Receiver<HostedTurnEvent>,
    response_tx: mpsc::Sender<PrivilegedResponse>,
}

impl HostedTurnInteraction {
    pub fn try_recv(&self) -> Result<HostedTurnEvent, mpsc::TryRecvError> {
        self.event_rx.try_recv()
    }

    pub fn respond(&self, response: PrivilegedResponse) -> Result<(), HostedTurnError> {
        self.response_tx
            .send(response)
            .map_err(|_| HostedTurnError::Cancelled)
    }
}

pub struct HostedTurnWorkerInteraction {
    room_id: String,
    turn_id: String,
    host: String,
    host_user_id: String,
    session_id: u64,
    event_tx: mpsc::Sender<HostedTurnEvent>,
    response_rx: mpsc::Receiver<PrivilegedResponse>,
    approved_project_root: Option<PathBuf>,
    allow_network: bool,
}

pub fn hosted_turn_interaction(
    room_id: &str,
    turn_id: &str,
    host: &str,
    host_user_id: &str,
) -> Result<(HostedTurnInteraction, HostedTurnWorkerInteraction), HostedTurnError> {
    if !bounded_identifier(room_id, 160)
        || !bounded_identifier(turn_id, 160)
        || !bounded_text(host, 120)
        || !bounded_identifier(host_user_id, 128)
    {
        return Err(HostedTurnError::InvalidResponse);
    }
    let (event_tx, event_rx) = mpsc::channel();
    let (response_tx, response_rx) = mpsc::channel();
    let session_id = allocate_rpc_session_id();
    Ok((
        HostedTurnInteraction {
            event_rx,
            response_tx,
        },
        HostedTurnWorkerInteraction {
            room_id: room_id.to_owned(),
            turn_id: turn_id.to_owned(),
            host: host.to_owned(),
            host_user_id: host_user_id.to_owned(),
            session_id,
            event_tx,
            response_rx,
            approved_project_root: None,
            allow_network: false,
        },
    ))
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum HostedTurnError {
    #[error("Codex compatibility could not be verified.")]
    Compatibility,
    #[error("Codex app-server could not be started safely.")]
    Start,
    #[error("Codex app-server returned an invalid or unsupported response.")]
    InvalidResponse,
    #[error("Codex requested a privileged operation that this CLI version cannot approve.")]
    PrivilegedRequestUnsupported,
    #[error("The Codex turn was cancelled because host authority changed.")]
    Cancelled,
    #[error("The Codex turn exceeded its active execution deadline.")]
    Timeout,
    #[error("The Codex turn failed.")]
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedProcessConfig {
    pub executable: String,
    pub version: String,
    pub extra_arguments: Vec<String>,
}

pub fn probe_codex_process(executable: &str) -> Result<HostedProcessConfig, HostedTurnError> {
    let output = Command::new(executable)
        .arg("--version")
        .output()
        .map_err(|_| HostedTurnError::Compatibility)?;
    if !output.status.success() || output.stdout.len() > 4_096 {
        return Err(HostedTurnError::Compatibility);
    }
    let version_output =
        std::str::from_utf8(&output.stdout).map_err(|_| HostedTurnError::Compatibility)?;
    let version = codex_host_core::host::parse_codex_version(version_output)
        .ok_or(HostedTurnError::Compatibility)?;
    capabilities_for_version(&version).map_err(|_| HostedTurnError::Compatibility)?;
    Ok(HostedProcessConfig {
        executable: executable.to_owned(),
        version,
        extra_arguments: Vec::new(),
    })
}

pub fn resolve_turn_settings(
    process_config: &HostedProcessConfig,
    requested: &CodexTurnSettings,
    cancelled: &AtomicBool,
) -> Result<CodexTurnSettings, HostedTurnError> {
    capabilities_for_version(&process_config.version)
        .map_err(|_| HostedTurnError::Compatibility)?;
    let config = AppServerProcessConfig {
        executable: process_config.executable.clone(),
        cwd: None,
        arguments: process_config
            .extra_arguments
            .iter()
            .cloned()
            .chain(["app-server".to_owned()])
            .collect(),
        capture_stderr: false,
    };
    let mut process = AppServerProcess::spawn(&config).map_err(|_| HostedTurnError::Start)?;
    let result = (|| {
        let stdin = process.stdin();
        let line_rx = process
            .take_stdout_lines()
            .map_err(|_| HostedTurnError::Start)?;
        let mut inbox = RpcInbox::new(line_rx);
        let mut budget = ActiveTimeout::new(Duration::from_secs(8));
        send_json_shared(
            &stdin,
            json!({
                "method":"initialize",
                "id":1,
                "params":{
                    "clientInfo":{"name":"multaiplayer-cli","title":"multAIplayer CLI","version":env!("CARGO_PKG_VERSION")},
                    "capabilities":{"experimentalApi":true}
                }
            }),
        )
        .map_err(|_| HostedTurnError::Start)?;
        wait_exact_response(&mut inbox, RpcId::Number(1.into()), &mut budget, cancelled)?;
        send_json_shared(&stdin, json!({"method":"initialized","params":{}}))
            .map_err(|_| HostedTurnError::Failed)?;
        send_json_shared(
            &stdin,
            json!({
                "method":"model/list",
                "id":2,
                "params":{"includeHidden":false,"limit":100}
            }),
        )
        .map_err(|_| HostedTurnError::Failed)?;
        let response =
            wait_exact_response(&mut inbox, RpcId::Number(2.into()), &mut budget, cancelled)?;
        resolve_catalog_response(requested, &response)
    })();
    process.terminate();
    result
}

fn resolve_catalog_response(
    requested: &CodexTurnSettings,
    response: &serde_json::Value,
) -> Result<CodexTurnSettings, HostedTurnError> {
    let models = response
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(serde_json::Value::as_array)
        .ok_or(HostedTurnError::InvalidResponse)?;
    let parsed = models
        .iter()
        .take(100)
        .filter_map(parse_catalog_model)
        .collect::<Vec<_>>();
    let selected = match requested.model_policy {
        CatalogSelectionPolicy::Auto => parsed
            .iter()
            .find(|model| model.is_default)
            .or_else(|| parsed.first()),
        CatalogSelectionPolicy::Pinned => parsed
            .iter()
            .find(|model| model.model == requested.model)
            .or_else(|| parsed.iter().find(|model| model.is_default))
            .or_else(|| parsed.first()),
    }
    .ok_or(HostedTurnError::InvalidResponse)?;

    let reasoning_effort = match requested.reasoning_policy {
        CatalogSelectionPolicy::Auto => selected.default_reasoning_effort.clone(),
        CatalogSelectionPolicy::Pinned
            if selected.reasoning.contains(&requested.reasoning_effort) =>
        {
            requested.reasoning_effort.clone()
        }
        CatalogSelectionPolicy::Pinned => selected.default_reasoning_effort.clone(),
    };
    let speed = match requested.service_tier_policy {
        CatalogSelectionPolicy::Auto => selected.default_speed.clone(),
        CatalogSelectionPolicy::Pinned if selected.speeds.contains(&requested.speed) => {
            requested.speed.clone()
        }
        CatalogSelectionPolicy::Pinned => selected.default_speed.clone(),
    };
    Ok(CodexTurnSettings {
        model: selected.model.clone(),
        model_policy: requested.model_policy.clone(),
        reasoning_effort,
        reasoning_policy: requested.reasoning_policy.clone(),
        speed,
        service_tier_policy: requested.service_tier_policy.clone(),
        sandbox: requested.sandbox.clone(),
    })
}

struct CatalogModel {
    model: String,
    is_default: bool,
    default_reasoning_effort: CodexReasoningEffort,
    reasoning: Vec<CodexReasoningEffort>,
    default_speed: CodexSpeed,
    speeds: Vec<CodexSpeed>,
}

fn parse_catalog_model(value: &serde_json::Value) -> Option<CatalogModel> {
    if value.get("hidden").and_then(serde_json::Value::as_bool) == Some(true) {
        return None;
    }
    let model = value
        .get("model")
        .or_else(|| value.get("id"))?
        .as_str()?
        .trim();
    if model.is_empty()
        || model.chars().count() > 128
        || !model.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return None;
    }
    let reasoning = value
        .get("supportedReasoningEfforts")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("reasoningEffort")
                .and_then(serde_json::Value::as_str)
                .and_then(parse_reasoning_effort)
        })
        .collect::<Vec<_>>();
    let default_reasoning_effort = value
        .get("defaultReasoningEffort")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_reasoning_effort)
        .filter(|effort| reasoning.is_empty() || reasoning.contains(effort))
        .or_else(|| reasoning.first().cloned())?;
    let speeds = value
        .get("serviceTiers")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("id")
                .and_then(serde_json::Value::as_str)
                .and_then(parse_speed)
        })
        .collect::<Vec<_>>();
    let default_speed = value
        .get("defaultServiceTier")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_speed)
        .filter(|speed| speeds.is_empty() || speeds.contains(speed))
        .or_else(|| speeds.first().cloned())
        .unwrap_or(CodexSpeed::Standard);
    Some(CatalogModel {
        model: model.to_owned(),
        is_default: value
            .get("isDefault")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        default_reasoning_effort,
        reasoning,
        default_speed,
        speeds,
    })
}

fn parse_reasoning_effort(value: &str) -> Option<CodexReasoningEffort> {
    match value {
        "none" => Some(CodexReasoningEffort::None),
        "minimal" => Some(CodexReasoningEffort::Minimal),
        "low" => Some(CodexReasoningEffort::Low),
        "medium" => Some(CodexReasoningEffort::Medium),
        "high" => Some(CodexReasoningEffort::High),
        "xhigh" => Some(CodexReasoningEffort::Xhigh),
        "max" => Some(CodexReasoningEffort::Max),
        _ => None,
    }
}

fn parse_speed(value: &str) -> Option<CodexSpeed> {
    match value {
        "default" => Some(CodexSpeed::Standard),
        "fast" => Some(CodexSpeed::Fast),
        _ => None,
    }
}

pub fn run_hosted_turn(
    process_config: &HostedProcessConfig,
    request: &HostedTurnRequest,
    cancelled: &AtomicBool,
) -> Result<HostedTurnResult, HostedTurnError> {
    run_hosted_turn_inner(process_config, request, cancelled, None)
}

pub fn run_hosted_turn_with_interaction(
    process_config: &HostedProcessConfig,
    request: &HostedTurnRequest,
    cancelled: &AtomicBool,
    interaction: &mut HostedTurnWorkerInteraction,
) -> Result<HostedTurnResult, HostedTurnError> {
    run_hosted_turn_inner(process_config, request, cancelled, Some(interaction))
}

fn run_hosted_turn_inner(
    process_config: &HostedProcessConfig,
    request: &HostedTurnRequest,
    cancelled: &AtomicBool,
    mut interaction: Option<&mut HostedTurnWorkerInteraction>,
) -> Result<HostedTurnResult, HostedTurnError> {
    capabilities_for_version(&process_config.version)
        .map_err(|_| HostedTurnError::Compatibility)?;
    let canonical_project = canonical_project(&request.project_path)?;
    if let Some(interaction) = interaction.as_deref_mut() {
        interaction.approved_project_root = Some(canonical_project.clone());
        interaction.allow_network = request.settings.network_access();
    }
    if request.input.is_empty() || request.input.chars().count() > MAX_CONTEXT_CHARS {
        return Err(HostedTurnError::InvalidResponse);
    }
    let mut arguments = process_config.extra_arguments.clone();
    arguments.extend([
        "-c".to_owned(),
        format!(
            "model_reasoning_effort=\"{}\"",
            request.settings.reasoning_label()
        ),
        "-c".to_owned(),
        format!("service_tier=\"{}\"", request.settings.service_tier()),
        "-c".to_owned(),
        format!(
            "sandbox_mode=\"{}\"",
            request.settings.sandbox_process_mode()
        ),
        "-c".to_owned(),
        "approval_policy=\"on-request\"".to_owned(),
        "-c".to_owned(),
        format!(
            "sandbox_workspace_write.network_access={}",
            request.settings.network_access()
        ),
        "app-server".to_owned(),
    ]);
    let config = AppServerProcessConfig {
        executable: process_config.executable.clone(),
        cwd: Some(canonical_project.clone()),
        arguments,
        capture_stderr: false,
    };
    let mut process = AppServerProcess::spawn(&config).map_err(|_| HostedTurnError::Start)?;
    let stdin = process.stdin();
    let line_rx = process
        .take_stdout_lines()
        .map_err(|_| HostedTurnError::Start)?;
    let mut inbox = RpcInbox::new(line_rx);
    let mut budget = ActiveTimeout::new(request.timeout);
    send_json_shared(
        &stdin,
        json!({
            "method":"initialize",
            "id":1,
            "params":{
                "clientInfo":{"name":"multaiplayer-cli","title":"multAIplayer CLI","version":env!("CARGO_PKG_VERSION")},
                "capabilities":{"experimentalApi":true}
            }
        }),
    )
    .map_err(|_| HostedTurnError::Start)?;
    wait_exact_response_interactive(
        &mut inbox,
        RpcId::Number(1.into()),
        &mut budget,
        cancelled,
        interaction.as_deref_mut(),
        &stdin,
    )?;
    send_json_shared(&stdin, json!({"method":"initialized","params":{}}))
        .map_err(|_| HostedTurnError::Failed)?;
    let cwd = canonical_project
        .to_str()
        .ok_or(HostedTurnError::InvalidResponse)?;
    send_json_shared(
        &stdin,
        thread_request(
            2,
            request.previous_thread_id.as_deref(),
            cwd,
            &request.settings.model,
        ),
    )
    .map_err(|_| HostedTurnError::Failed)?;
    let thread_response = wait_exact_response_interactive(
        &mut inbox,
        RpcId::Number(2.into()),
        &mut budget,
        cancelled,
        interaction.as_deref_mut(),
        &stdin,
    )?;
    let thread_id = thread_id_from_response(&thread_response, "thread")
        .map_err(|_| HostedTurnError::InvalidResponse)?;
    send_json_shared(
        &stdin,
        json!({
            "method":"turn/start",
            "id":3,
            "params":{
                "threadId":thread_id,
                "input":[{"type":"text","text":request.input}],
                "cwd":cwd,
                "model":request.settings.model,
                "modelReasoningEffort":request.settings.reasoning_label(),
                "serviceTier":request.settings.service_tier()
            }
        }),
    )
    .map_err(|_| HostedTurnError::Failed)?;
    let mut acknowledged = false;
    let mut assistant = String::new();
    let mut started_by_item = HashMap::new();
    loop {
        if cancelled.load(Ordering::Acquire) {
            process.terminate();
            return Err(HostedTurnError::Cancelled);
        }
        if budget.expired(false) {
            process.terminate();
            return Err(HostedTurnError::Timeout);
        }
        match inbox.receive(Duration::from_millis(100)) {
            Ok(RpcMessage::Response { id, value }) if id == RpcId::Number(3.into()) => {
                if value.get("error").is_some()
                    || value
                        .get("result")
                        .and_then(|result| result.get("turn"))
                        .and_then(|turn| turn.get("id"))
                        .and_then(serde_json::Value::as_str)
                        .is_none()
                {
                    return Err(HostedTurnError::InvalidResponse);
                }
                acknowledged = true;
            }
            Ok(RpcMessage::Notification { method, value }) => {
                if let Some(interaction) = interaction.as_deref_mut() {
                    if let Some(activity) =
                        project_shared_activity(&method, &value, interaction, &mut started_by_item)
                    {
                        interaction
                            .event_tx
                            .send(HostedTurnEvent::Activity(Box::new(activity)))
                            .map_err(|_| HostedTurnError::Cancelled)?;
                    }
                }
                if method.contains("agentMessage") {
                    if let Some(delta) = extract_text_delta(&value) {
                        append_bounded(&mut assistant, &delta, MAX_ASSISTANT_CHARS);
                    }
                }
                if method == "turn/completed" {
                    let status = value
                        .get("params")
                        .and_then(|params| params.get("turn"))
                        .and_then(|turn| turn.get("status"))
                        .and_then(serde_json::Value::as_str)
                        .ok_or(HostedTurnError::InvalidResponse)?;
                    if !acknowledged || status != "completed" || assistant.is_empty() {
                        return Err(HostedTurnError::Failed);
                    }
                    return Ok(HostedTurnResult {
                        thread_id,
                        assistant_message: assistant,
                    });
                }
            }
            Ok(RpcMessage::ServerRequest { id, method, params }) => {
                let Some(interaction) = interaction.as_deref_mut() else {
                    process.terminate();
                    return Err(HostedTurnError::PrivilegedRequestUnsupported);
                };
                handle_privileged_request(
                    &stdin,
                    id,
                    method,
                    params,
                    interaction,
                    cancelled,
                    &mut budget,
                )?;
            }
            Ok(RpcMessage::Response { .. }) => return Err(HostedTurnError::InvalidResponse),
            Err(error) if error == "timeout" => {}
            Err(_) => return Err(HostedTurnError::Failed),
        }
    }
}

fn handle_privileged_request(
    stdin: &codex_host_core::host::SharedStdin,
    id: RpcId,
    method: String,
    params: Value,
    interaction: &mut HostedTurnWorkerInteraction,
    cancelled: &AtomicBool,
    budget: &mut ActiveTimeout,
) -> Result<(), HostedTurnError> {
    if !INTERACTIVE_SERVER_METHODS.contains(&method.as_str()) {
        return send_privileged_error(stdin, &id, -32601, "Unsupported app-server request")
            .map_err(|_| HostedTurnError::Failed);
    }
    let projected = match project_privileged_request(&method, &params) {
        Ok(projected) => projected,
        Err(()) => {
            return send_privileged_error(
                stdin,
                &id,
                -32602,
                "Invalid or unsupported interactive request",
            )
            .map_err(|_| HostedTurnError::Failed)
        }
    };
    if !privileged_request_allowed(&method, &projected, interaction) {
        return send_privileged_error(
            stdin,
            &id,
            -32001,
            "Privileged request exceeds the approved project sandbox",
        )
        .map_err(|_| HostedTurnError::Failed);
    }
    let request_key = format!(
        "rpc-{}-{}",
        interaction.session_id,
        NEXT_PRIVILEGED_REQUEST_KEY.fetch_add(1, Ordering::Relaxed)
    );
    let expires_at = Instant::now() + PRIVILEGED_REQUEST_TTL;
    let expires_at_unix_ms = SystemTime::now()
        .checked_add(PRIVILEGED_REQUEST_TTL)
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(u64::MAX);
    let prompt = PrivilegedRequestPrompt {
        request_key,
        room_id: interaction.room_id.clone(),
        session_id: interaction.session_id,
        request_id: id.clone(),
        method,
        params: projected,
        expires_at_unix_ms,
    };
    interaction
        .event_tx
        .send(HostedTurnEvent::PrivilegedRequest(prompt.clone()))
        .map_err(|_| HostedTurnError::Cancelled)?;
    let _ = budget.expired(true);
    loop {
        let _ = budget.expired(true);
        if cancelled.load(Ordering::Acquire) {
            let _ = send_privileged_error(
                stdin,
                &id,
                -32800,
                "Codex request cancelled because host authority changed",
            );
            return Err(HostedTurnError::Cancelled);
        }
        if Instant::now() >= expires_at {
            return send_privileged_error(
                stdin,
                &id,
                -32800,
                "Codex request expired while waiting for the host",
            )
            .map_err(|_| HostedTurnError::Failed);
        }
        match interaction
            .response_rx
            .recv_timeout(Duration::from_millis(100))
        {
            Ok(response) => {
                if validate_privileged_response_binding(&prompt, &response).is_err() {
                    continue;
                }
                let result = match validate_privileged_result(
                    &prompt.method,
                    &prompt.params,
                    &response.decision,
                ) {
                    Ok(result) => result,
                    Err(()) => continue,
                };
                if !privileged_request_allowed(&prompt.method, &prompt.params, interaction) {
                    return send_privileged_error(
                        stdin,
                        &id,
                        -32001,
                        "Privileged request is no longer within the approved project sandbox",
                    )
                    .map_err(|_| HostedTurnError::Failed);
                }
                send_json_shared(stdin, json!({"id": id.to_value(), "result": result}))
                    .map_err(|_| HostedTurnError::Failed)?;
                let _ = budget.expired(false);
                return Ok(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(HostedTurnError::Cancelled),
        }
    }
}

pub fn validate_privileged_response_binding(
    prompt: &PrivilegedRequestPrompt,
    response: &PrivilegedResponse,
) -> Result<(), HostedTurnError> {
    if !response.active_host {
        return Err(HostedTurnError::Cancelled);
    }
    if response.request_key != prompt.request_key
        || response.room_id != prompt.room_id
        || response.session_id != prompt.session_id
        || response.request_id != prompt.request_id
        || response.method != prompt.method
    {
        return Err(HostedTurnError::InvalidResponse);
    }
    Ok(())
}

fn send_privileged_error(
    stdin: &codex_host_core::host::SharedStdin,
    id: &RpcId,
    code: i64,
    message: &str,
) -> Result<(), String> {
    send_json_shared(
        stdin,
        json!({"id": id.to_value(), "error": {"code": code, "message": message}}),
    )
}

fn project_privileged_request(method: &str, params: &Value) -> Result<Value, ()> {
    if serde_json::to_vec(params).map_err(|_| ())?.len() > MAX_PRIVILEGED_PARAMS_BYTES {
        return Err(());
    }
    let input = params.as_object().ok_or(())?;
    let mut output = Map::new();
    match method {
        "item/commandExecution/requestApproval" | "execCommandApproval" => {
            copy_projected_text(input, &mut output, "reason", 2_000)?;
            copy_projected_text(input, &mut output, "cwd", 4_096)?;
            let command = input.get("command").ok_or(())?;
            let command = if let Some(command) = command.as_str() {
                Value::String(bounded_prompt_text(command, MAX_PRIVILEGED_TEXT_CHARS)?)
            } else if let Some(parts) = command.as_array() {
                if parts.len() > 200 {
                    return Err(());
                }
                Value::Array(
                    parts
                        .iter()
                        .map(|part| {
                            part.as_str()
                                .ok_or(())
                                .and_then(|part| bounded_prompt_text(part, 2_000))
                                .map(Value::String)
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                )
            } else {
                return Err(());
            };
            output.insert("command".to_owned(), command);
        }
        "item/fileChange/requestApproval" | "applyPatchApproval" => {
            copy_projected_text(input, &mut output, "reason", 2_000)?;
            copy_projected_text(input, &mut output, "grantRoot", 4_096)?;
        }
        "item/permissions/requestApproval" => {
            copy_projected_text(input, &mut output, "reason", 2_000)?;
            copy_projected_text(input, &mut output, "cwd", 4_096)?;
            let permissions = project_permissions(input.get("permissions").ok_or(())?)?;
            output.insert("permissions".to_owned(), permissions);
        }
        "item/tool/requestUserInput" | "tool/requestUserInput" => {
            output.insert(
                "questions".to_owned(),
                project_questions(input.get("questions").ok_or(())?)?,
            );
        }
        "mcpServer/elicitation/request" => return project_elicitation(input),
        _ => return Err(()),
    }
    for key in ["threadId", "turnId", "itemId"] {
        copy_projected_text(input, &mut output, key, 512)?;
    }
    Ok(Value::Object(output))
}

fn copy_projected_text(
    input: &Map<String, Value>,
    output: &mut Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<(), ()> {
    if let Some(value) = input.get(key) {
        output.insert(
            key.to_owned(),
            Value::String(bounded_prompt_text(value.as_str().ok_or(())?, max)?),
        );
    }
    Ok(())
}

fn bounded_prompt_text(value: &str, max: usize) -> Result<String, ()> {
    if value.chars().count() > max || value.chars().any(char::is_control) {
        Err(())
    } else {
        Ok(value.to_owned())
    }
}

fn project_permissions(value: &Value) -> Result<Value, ()> {
    let input = value.as_object().ok_or(())?;
    if input
        .keys()
        .any(|key| !matches!(key.as_str(), "network" | "fileSystem"))
    {
        return Err(());
    }
    let mut output = Map::new();
    if let Some(network) = input.get("network") {
        let network = network.as_object().ok_or(())?;
        if network.keys().any(|key| key != "enabled") {
            return Err(());
        }
        let enabled = network.get("enabled").and_then(Value::as_bool).ok_or(())?;
        output.insert("network".to_owned(), json!({"enabled": enabled}));
    }
    if let Some(files) = input.get("fileSystem") {
        let files = files.as_object().ok_or(())?;
        if files
            .keys()
            .any(|key| !matches!(key.as_str(), "read" | "write"))
        {
            return Err(());
        }
        let mut projected = Map::new();
        for key in ["read", "write"] {
            if let Some(paths) = files.get(key) {
                let paths = paths.as_array().ok_or(())?;
                if paths.len() > 100 {
                    return Err(());
                }
                projected.insert(
                    key.to_owned(),
                    Value::Array(
                        paths
                            .iter()
                            .map(|path| {
                                bounded_prompt_text(path.as_str().ok_or(())?, 4_096)
                                    .map(Value::String)
                            })
                            .collect::<Result<Vec<_>, _>>()?,
                    ),
                );
            }
        }
        output.insert("fileSystem".to_owned(), Value::Object(projected));
    }
    Ok(Value::Object(output))
}

fn privileged_request_allowed(
    method: &str,
    projected: &Value,
    interaction: &HostedTurnWorkerInteraction,
) -> bool {
    let Some(root) = interaction.approved_project_root.as_deref() else {
        return false;
    };
    if matches!(
        method,
        "item/fileChange/requestApproval" | "applyPatchApproval"
    ) {
        return projected
            .get("grantRoot")
            .and_then(Value::as_str)
            .is_none_or(|path| path_within_project(path, root));
    }
    if method != "item/permissions/requestApproval" {
        return true;
    }
    let Some(permissions) = projected.get("permissions").and_then(Value::as_object) else {
        return false;
    };
    if permissions
        .get("network")
        .and_then(|network| network.get("enabled"))
        .and_then(Value::as_bool)
        .is_some_and(|enabled| enabled && !interaction.allow_network)
    {
        return false;
    }
    permissions
        .get("fileSystem")
        .and_then(Value::as_object)
        .is_none_or(|files| {
            ["read", "write"].into_iter().all(|key| {
                files
                    .get(key)
                    .and_then(Value::as_array)
                    .is_none_or(|paths| {
                        paths.iter().all(|path| {
                            path.as_str()
                                .is_some_and(|path| path_within_project(path, root))
                        })
                    })
            })
        })
}

fn path_within_project(path: &str, root: &Path) -> bool {
    use std::path::Component;

    if path.is_empty() || path.chars().any(char::is_control) {
        return false;
    }
    let path = Path::new(path);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return false;
    }
    if candidate.exists() {
        return candidate
            .canonicalize()
            .is_ok_and(|candidate| candidate.starts_with(root));
    }
    let mut existing = candidate.as_path();
    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            return false;
        };
        existing = parent;
    }
    existing
        .canonicalize()
        .is_ok_and(|existing| existing.starts_with(root))
}

fn project_questions(value: &Value) -> Result<Value, ()> {
    let questions = value.as_array().ok_or(())?;
    if questions.is_empty() || questions.len() > 3 {
        return Err(());
    }
    let projected = questions
        .iter()
        .map(|question| {
            let question = question.as_object().ok_or(())?;
            let id = bounded_prompt_text(question.get("id").and_then(Value::as_str).ok_or(())?, 128)?;
            let text = question
                .get("question")
                .or_else(|| question.get("header"))
                .and_then(Value::as_str)
                .ok_or(())?;
            let mut output = Map::from_iter([
                ("id".to_owned(), Value::String(id)),
                (
                    "question".to_owned(),
                    Value::String(bounded_prompt_text(text, 2_000)?),
                ),
                (
                    "isSecret".to_owned(),
                    Value::Bool(
                        question
                            .get("isSecret")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    ),
                ),
            ]);
            if let Some(options) = question.get("options") {
                let options = options.as_array().ok_or(())?;
                if options.len() > 50 {
                    return Err(());
                }
                output.insert(
                    "options".to_owned(),
                    Value::Array(
                        options
                            .iter()
                            .map(|option| {
                                let option = option.as_object().ok_or(())?;
                                Ok(json!({
                                    "label": bounded_prompt_text(option.get("label").and_then(Value::as_str).ok_or(())?, 200)?,
                                    "description": bounded_prompt_text(option.get("description").and_then(Value::as_str).unwrap_or(""), 500)?
                                }))
                            })
                            .collect::<Result<Vec<_>, ()>>()?,
                    ),
                );
            }
            Ok(Value::Object(output))
        })
        .collect::<Result<Vec<_>, ()>>()?;
    Ok(Value::Array(projected))
}

fn project_elicitation(input: &Map<String, Value>) -> Result<Value, ()> {
    let mode = bounded_prompt_text(input.get("mode").and_then(Value::as_str).ok_or(())?, 32)?;
    let message = bounded_prompt_text(
        input.get("message").and_then(Value::as_str).ok_or(())?,
        2_000,
    )?;
    match mode.as_str() {
        "url" => {
            let url =
                bounded_prompt_text(input.get("url").and_then(Value::as_str).ok_or(())?, 4_096)?;
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(());
            }
            Ok(json!({"mode":"url", "message":message, "url":url}))
        }
        "form" | "openai/form" => {
            let schema = input.get("requestedSchema").cloned().ok_or(())?;
            validate_form_schema(&schema)?;
            Ok(json!({"mode":mode, "message":message, "requestedSchema":schema}))
        }
        _ => Err(()),
    }
}

fn validate_form_schema(value: &Value) -> Result<(), ()> {
    let schema = value.as_object().ok_or(())?;
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or(())?;
    if properties.len() > 24 {
        return Err(());
    }
    for (name, property) in properties {
        bounded_prompt_text(name, 128)?;
        let property = property.as_object().ok_or(())?;
        if !matches!(
            property.get("type").and_then(Value::as_str),
            Some("string" | "number" | "integer" | "boolean")
        ) {
            return Err(());
        }
    }
    Ok(())
}

fn validate_privileged_result(
    method: &str,
    projected_params: &Value,
    decision: &PrivilegedDecision,
) -> Result<Value, ()> {
    match (method, decision) {
        (
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval",
            PrivilegedDecision::Approve,
        ) => Ok(json!({"decision":"accept"})),
        (
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval",
            PrivilegedDecision::Deny,
        ) => Ok(json!({"decision":"decline"})),
        ("execCommandApproval" | "applyPatchApproval", PrivilegedDecision::Approve) => {
            Ok(json!({"decision":"approved"}))
        }
        ("execCommandApproval" | "applyPatchApproval", PrivilegedDecision::Deny) => {
            Ok(json!({"decision":"denied"}))
        }
        ("item/permissions/requestApproval", PrivilegedDecision::Approve) => Ok(json!({
            "permissions": projected_params.get("permissions").cloned().ok_or(())?,
            "scope":"turn",
            "strictAutoReview":false
        })),
        ("item/permissions/requestApproval", PrivilegedDecision::Deny) => {
            Ok(json!({"permissions":{}}))
        }
        (
            "item/tool/requestUserInput" | "tool/requestUserInput",
            PrivilegedDecision::Respond(result),
        ) => {
            validate_answers(projected_params, result)?;
            Ok(result.clone())
        }
        ("item/tool/requestUserInput" | "tool/requestUserInput", PrivilegedDecision::Deny) => {
            Ok(json!({"answers":{}}))
        }
        ("mcpServer/elicitation/request", PrivilegedDecision::Approve)
            if projected_params.get("mode") == Some(&json!("url")) =>
        {
            Ok(json!({"action":"accept"}))
        }
        ("mcpServer/elicitation/request", PrivilegedDecision::Deny) => {
            Ok(json!({"action":"decline"}))
        }
        ("mcpServer/elicitation/request", PrivilegedDecision::Respond(result)) => {
            validate_elicitation_response(projected_params, result)?;
            Ok(result.clone())
        }
        _ => Err(()),
    }
}

fn validate_answers(params: &Value, result: &Value) -> Result<(), ()> {
    let answers = result.get("answers").and_then(Value::as_object).ok_or(())?;
    if result.as_object().is_none_or(|result| result.len() != 1) {
        return Err(());
    }
    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .ok_or(())?;
    let ids = questions
        .iter()
        .filter_map(|question| question.get("id").and_then(Value::as_str))
        .collect::<BTreeSet<_>>();
    if answers.keys().any(|id| !ids.contains(id.as_str())) {
        return Err(());
    }
    for answer in answers.values() {
        let values = answer.get("answers").and_then(Value::as_array).ok_or(())?;
        if values.len() > 20
            || values.iter().any(|value| {
                value.as_str().is_none_or(|value| {
                    value.chars().count() > MAX_PRIVILEGED_TEXT_CHARS
                        || value.chars().any(char::is_control)
                })
            })
        {
            return Err(());
        }
    }
    Ok(())
}

fn validate_elicitation_response(params: &Value, result: &Value) -> Result<(), ()> {
    let result = result.as_object().ok_or(())?;
    let action = result.get("action").and_then(Value::as_str).ok_or(())?;
    if !matches!(action, "accept" | "decline" | "cancel")
        || result
            .keys()
            .any(|key| !matches!(key.as_str(), "action" | "content"))
    {
        return Err(());
    }
    if action != "accept" {
        return result
            .get("content")
            .is_none_or(Value::is_null)
            .then_some(())
            .ok_or(());
    }
    if params.get("mode") == Some(&json!("url")) {
        return result
            .get("content")
            .is_none_or(Value::is_null)
            .then_some(())
            .ok_or(());
    }
    let schema = params
        .get("requestedSchema")
        .and_then(Value::as_object)
        .ok_or(())?;
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or(())?;
    let content = result.get("content").and_then(Value::as_object).ok_or(())?;
    if content.keys().any(|key| !properties.contains_key(key)) {
        return Err(());
    }
    for required in schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let required = required.as_str().ok_or(())?;
        if !content.contains_key(required) {
            return Err(());
        }
    }
    for (key, value) in content {
        let field = properties.get(key).and_then(Value::as_object).ok_or(())?;
        let field_type = field.get("type").and_then(Value::as_str).ok_or(())?;
        let valid = match field_type {
            "string" => value.as_str().is_some_and(|value| {
                let length = value.chars().count();
                length <= MAX_PRIVILEGED_TEXT_CHARS
                    && !value.chars().any(char::is_control)
                    && field
                        .get("minLength")
                        .and_then(Value::as_u64)
                        .is_none_or(|minimum| length >= minimum as usize)
                    && field
                        .get("maxLength")
                        .and_then(Value::as_u64)
                        .is_none_or(|maximum| length <= maximum as usize)
                    && field
                        .get("enum")
                        .and_then(Value::as_array)
                        .is_none_or(|options| {
                            options.len() <= 50
                                && options.iter().any(|option| option.as_str() == Some(value))
                        })
            }),
            "number" | "integer" => value.as_f64().is_some_and(|number| {
                (field_type != "integer" || number.fract() == 0.0)
                    && field
                        .get("minimum")
                        .and_then(Value::as_f64)
                        .is_none_or(|minimum| number >= minimum)
                    && field
                        .get("maximum")
                        .and_then(Value::as_f64)
                        .is_none_or(|maximum| number <= maximum)
            }),
            "boolean" => value.as_bool().is_some(),
            _ => false,
        };
        if !valid {
            return Err(());
        }
    }
    Ok(())
}

fn project_shared_activity(
    method: &str,
    notification: &Value,
    interaction: &HostedTurnWorkerInteraction,
    started_by_item: &mut HashMap<String, String>,
) -> Option<CodexActivityPlaintextPayload> {
    let projected = codex_host_core::project_codex_activity(
        method,
        notification,
        &interaction.room_id,
        &interaction.turn_id,
        started_by_item,
        false,
    )?;
    let mut value = serde_json::to_value(projected).ok()?;
    let object = value.as_object_mut()?;
    // The CLI shares lifecycle metadata and configured reasoning summaries only.
    // Raw command output, diffs, tool arguments/results, and unknown upstream
    // fields remain host-local.
    if object.get("kind").and_then(Value::as_str) != Some("reasoning") {
        object.remove("details");
    } else if let Some(details) = object.get_mut("details").and_then(Value::as_object_mut) {
        details.remove("rawContent");
        if let Some(summaries) = details.get_mut("summaries").and_then(Value::as_array_mut) {
            for summary in summaries {
                if let Some(text) = summary.as_str() {
                    *summary = Value::String(redact_shared_text(text, 4_096));
                }
            }
        }
    }
    object.insert("host".to_owned(), Value::String(interaction.host.clone()));
    object.insert(
        "eventType".to_owned(),
        Value::String("codex.activity".to_owned()),
    );
    object.insert(
        "hostUserId".to_owned(),
        Value::String(interaction.host_user_id.clone()),
    );
    let payload: CodexActivityPlaintextPayload = serde_json::from_value(value).ok()?;
    payload.validate().ok()?;
    Some(payload)
}

fn redact_shared_text(value: &str, max: usize) -> String {
    safe_terminal_text(value, max)
        .split_whitespace()
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            let credential_shaped = part.contains('=')
                || part.contains("://")
                || lower.starts_with("bearer")
                || lower.starts_with("ghp_")
                || lower.starts_with("github_pat_")
                || lower.starts_with("sk-")
                || lower.starts_with("akia")
                || (part.chars().count() >= 24
                    && part.chars().all(|character| {
                        character.is_ascii_alphanumeric() || "_-".contains(character)
                    })
                    && part
                        .chars()
                        .any(|character| character.is_ascii_alphabetic())
                    && part.chars().any(|character| character.is_ascii_digit()));
            if credential_shaped
                || [
                    "token",
                    "secret",
                    "password",
                    "authorization",
                    "cookie",
                    "api_key",
                    "apikey",
                    "passphrase",
                    ".env",
                ]
                .iter()
                .any(|marker| lower.contains(marker))
                || part.starts_with('/')
                || part.starts_with("~/")
            {
                "[redacted]".to_owned()
            } else {
                part.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn safe_terminal_text(value: &str, max: usize) -> String {
    value
        .chars()
        .take(max)
        .map(|character| {
            if unsafe_terminal_character(character) {
                '\u{fffd}'
            } else {
                character
            }
        })
        .collect()
}

fn unsafe_terminal_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{061c}'
                | '\u{200b}'..='\u{200f}'
                | '\u{2028}'..='\u{202e}'
                | '\u{2060}'..='\u{206f}'
                | '\u{feff}'
                | '\u{fff9}'..='\u{fffb}'
        )
        || (character as u32) & 0xffff == 0xffff
        || (character as u32) & 0xffff == 0xfffe
}

fn wait_exact_response_interactive(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    cancelled: &AtomicBool,
    mut interaction: Option<&mut HostedTurnWorkerInteraction>,
    stdin: &codex_host_core::host::SharedStdin,
) -> Result<Value, HostedTurnError> {
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(HostedTurnError::Cancelled);
        }
        if budget.expired(false) {
            return Err(HostedTurnError::Timeout);
        }
        match inbox.receive(Duration::from_millis(100)) {
            Ok(RpcMessage::Response {
                id: response_id,
                value,
            }) if response_id == id => {
                if value.get("error").is_some() {
                    return Err(HostedTurnError::Failed);
                }
                return Ok(value);
            }
            Ok(RpcMessage::ServerRequest {
                id: request_id,
                method,
                params,
            }) => {
                let Some(interaction) = interaction.as_deref_mut() else {
                    return Err(HostedTurnError::PrivilegedRequestUnsupported);
                };
                handle_privileged_request(
                    stdin,
                    request_id,
                    method,
                    params,
                    interaction,
                    cancelled,
                    budget,
                )?;
            }
            Ok(_) => return Err(HostedTurnError::InvalidResponse),
            Err(error) if error == "timeout" => {}
            Err(_) => return Err(HostedTurnError::Failed),
        }
    }
}

fn wait_exact_response(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    cancelled: &AtomicBool,
) -> Result<serde_json::Value, HostedTurnError> {
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(HostedTurnError::Cancelled);
        }
        if budget.expired(false) {
            return Err(HostedTurnError::Timeout);
        }
        match inbox.receive(Duration::from_millis(100)) {
            Ok(RpcMessage::Response {
                id: response_id,
                value,
            }) if response_id == id => {
                if value.get("error").is_some() {
                    return Err(HostedTurnError::Failed);
                }
                return Ok(value);
            }
            Ok(RpcMessage::ServerRequest { .. }) => {
                return Err(HostedTurnError::PrivilegedRequestUnsupported)
            }
            Ok(_) => return Err(HostedTurnError::InvalidResponse),
            Err(error) if error == "timeout" => {}
            Err(_) => return Err(HostedTurnError::Failed),
        }
    }
}

fn canonical_project(path: &Path) -> Result<PathBuf, HostedTurnError> {
    let canonical = std::fs::canonicalize(path).map_err(|_| HostedTurnError::Start)?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(HostedTurnError::Start)
    }
}

fn append_bounded(target: &mut String, value: &str, max_chars: usize) {
    let remaining = max_chars.saturating_sub(target.chars().count());
    target.extend(value.chars().take(remaining));
}

pub fn cancellation_flag() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

pub fn unix_seconds_from_rfc3339(value: &str) -> Option<i64> {
    if value.len() < 20 || !value.ends_with('Z') {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<u32>().ok()?;
    let day = value.get(8..10)?.parse::<u32>().ok()?;
    let hour = value.get(11..13)?.parse::<u32>().ok()?;
    let minute = value.get(14..16)?.parse::<u32>().ok()?;
    let second = value.get(17..19)?.parse::<u32>().ok()?;
    let suffix = value.get(19..value.len() - 1)?;
    if (!suffix.is_empty()
        && (!suffix.starts_with('.')
            || suffix.len() == 1
            || !suffix[1..].bytes().all(|byte| byte.is_ascii_digit())))
        || !(1..=12).contains(&month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days_this_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return None,
    };
    if day == 0 || day > days_this_month {
        return None;
    }
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    days_since_epoch
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second))
}

pub fn proposal_expiry_from_rfc3339(created_at: &str, now_unix: i64) -> Result<i64, ProposalError> {
    let created_unix = unix_seconds_from_rfc3339(created_at).ok_or(ProposalError::Invalid)?;
    if created_unix > now_unix {
        return Err(ProposalError::Invalid);
    }
    let expires_at = created_unix
        .checked_add(PROPOSAL_TTL_SECONDS)
        .ok_or(ProposalError::Invalid)?;
    if expires_at <= now_unix {
        return Err(ProposalError::Expired);
    }
    Ok(expires_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use multaiplayer_protocol::ChatRole;
    use std::sync::atomic::AtomicBool;

    fn proposal() -> CodexProposal {
        CodexProposal {
            room_id: "room-1".into(),
            proposal_id: "proposal-1".into(),
            proposer: "Maddie".into(),
            proposer_user_id: "github:maddie".into(),
            task: "Review the bounded context".into(),
            created_at: "2026-07-19T12:00:00.000Z".into(),
            expires_at_unix: 2_000,
        }
    }

    fn chat(id: &str, role: ChatRole, body: &str) -> ChatPlaintextPayload {
        ChatPlaintextPayload {
            id: id.into(),
            author: "Maddie".into(),
            author_user_id: "github:maddie".into(),
            role,
            body: body.into(),
            time: "12:00".into(),
            created_at: Some("2026-07-19T12:00:00.000Z".into()),
            reply_to: None,
            attachments: None,
        }
    }

    #[test]
    fn proposal_binding_expiry_idempotency_and_authority_are_exact() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        assert!(machine.observe(proposal(), 1_000).unwrap());
        assert!(!machine.observe(proposal(), 1_000).unwrap());
        assert_eq!(
            machine.observe(
                CodexProposal {
                    proposal_id: "other".into(),
                    ..proposal()
                },
                1_000
            ),
            Err(ProposalError::Busy)
        );
        assert_eq!(
            machine.approve("other-room", "proposal-1", 1_000, true),
            Err(ProposalError::BindingMismatch)
        );
        assert_eq!(
            machine.approve("room-1", "proposal-1", 1_000, false),
            Err(ProposalError::NotActiveHost)
        );
        assert!(machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap());
        assert!(!machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap());
        machine.start("room-1", "proposal-1", true).unwrap();
        assert_eq!(
            machine.complete("room-1", "proposal-1", false),
            Err(ProposalError::NotActiveHost)
        );
        assert_eq!(machine.phase(), ProposalPhase::Cancelled);
        assert!(!machine.observe(proposal(), 1_000).unwrap());

        let mut expired = ProposalMachine::new("room-1").unwrap();
        assert_eq!(
            expired.observe(proposal(), 2_000),
            Err(ProposalError::Expired)
        );
    }

    #[test]
    fn one_pending_and_one_active_turn_are_enforced() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        machine.observe(proposal(), 1_000).unwrap();
        assert_eq!(
            machine.observe(
                CodexProposal {
                    proposal_id: "proposal-2".into(),
                    ..proposal()
                },
                1_000
            ),
            Err(ProposalError::Busy)
        );
        machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap();
        machine.start("room-1", "proposal-1", true).unwrap();
        assert_eq!(
            machine.observe(
                CodexProposal {
                    proposal_id: "proposal-3".into(),
                    ..proposal()
                },
                1_000
            ),
            Err(ProposalError::Busy)
        );
    }

    #[test]
    fn terminal_and_expired_proposals_release_the_pending_slot() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        machine.observe(proposal(), 1_000).unwrap();
        machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap();
        machine.start("room-1", "proposal-1", true).unwrap();
        machine.complete("room-1", "proposal-1", true).unwrap();
        assert!(machine
            .observe(
                CodexProposal {
                    proposal_id: "proposal-2".into(),
                    ..proposal()
                },
                1_000,
            )
            .unwrap());
        assert!(machine.cancel("room-1", "proposal-2").unwrap());
        assert!(machine
            .observe(
                CodexProposal {
                    proposal_id: "proposal-3".into(),
                    ..proposal()
                },
                1_000,
            )
            .unwrap());

        let mut expired = ProposalMachine::new("room-1").unwrap();
        expired.observe(proposal(), 1_000).unwrap();
        assert_eq!(
            expired.approve("room-1", "proposal-1", 2_000, true),
            Err(ProposalError::Expired)
        );
        assert!(expired
            .observe(
                CodexProposal {
                    proposal_id: "proposal-2".into(),
                    expires_at_unix: 3_000,
                    ..proposal()
                },
                2_000,
            )
            .unwrap());
    }

    #[test]
    fn auto_catalog_resolution_uses_the_effective_host_defaults() {
        let resolved = resolve_catalog_response(
            &CodexTurnSettings::default(),
            &json!({
                "result": {"data": [
                    {
                        "id": "fallback-model",
                        "isDefault": false,
                        "defaultReasoningEffort": "medium",
                        "supportedReasoningEfforts": [{"reasoningEffort":"medium"}],
                        "serviceTiers": [{"id":"default"}],
                        "defaultServiceTier":"default"
                    },
                    {
                        "id": "catalog-default",
                        "model": "effective-model",
                        "isDefault": true,
                        "defaultReasoningEffort": "high",
                        "supportedReasoningEfforts": [
                            {"reasoningEffort":"medium"},
                            {"reasoningEffort":"high"}
                        ],
                        "serviceTiers": [{"id":"default"},{"id":"fast"}],
                        "defaultServiceTier":"fast"
                    }
                ]}
            }),
        )
        .unwrap();
        assert_eq!(resolved.model, "effective-model");
        assert_eq!(resolved.reasoning_effort, CodexReasoningEffort::High);
        assert_eq!(resolved.speed, CodexSpeed::Fast);
    }

    #[test]
    fn context_is_bounded_typed_and_excludes_secrets_paths_system_and_raw_shapes() {
        let history = vec![
            chat("1", ChatRole::Human, "normal discussion"),
            chat(
                "2",
                ChatRole::System,
                "raw app-server payload accessToken=never",
            ),
            chat(
                "3",
                ChatRole::Human,
                "token=supersecret /Users/example/private.rs",
            ),
            chat("4", ChatRole::Codex, &"a".repeat(10_000)),
        ];
        let built = build_bounded_context(
            &proposal(),
            &history,
            &["Maddie".into(), "Guest".into()],
            "auto",
        )
        .unwrap();
        assert!(built.input.contains("normal discussion"));
        assert!(!built.input.contains("supersecret"));
        assert!(!built.input.contains("/Users/example"));
        assert!(!built.input.contains("accessToken"));
        assert!(!built.input.contains("raw app-server"));
        assert!(built.input.chars().count() <= MAX_CONTEXT_CHARS);
        assert!(built.extent.included_messages <= MAX_CONTEXT_MESSAGES);
    }

    #[test]
    fn trusted_preview_contains_every_required_effective_field_without_project_path() {
        let preview = HostPreview {
            proposal_id: "proposal-1".into(),
            proposer: "Maddie".into(),
            task: "Review".into(),
            room_name: "Room".into(),
            project_association: "associated on this device".into(),
            context_extent: ContextExtent {
                included_messages: 3,
                excluded_messages: 2,
                included_chars: 400,
            },
            effective_model: "gpt-5.6-sol".into(),
            service_tier: "default".into(),
            reasoning_effort: "medium".into(),
            sandbox: "workspace_write".into(),
        };
        let rendered = preview.trusted_text();
        for expected in [
            "Maddie",
            "Review",
            "3 messages",
            "gpt-5.6-sol",
            "default",
            "medium",
            "workspace_write",
        ] {
            assert!(rendered.contains(expected));
        }
        assert!(!rendered.contains("/Users/"));
    }

    fn request_prompt(method: &str, params: Value) -> PrivilegedRequestPrompt {
        PrivilegedRequestPrompt {
            request_key: "rpc-7-1".into(),
            room_id: "room-1".into(),
            session_id: 7,
            request_id: RpcId::Number(99.into()),
            method: method.into(),
            params: project_privileged_request(method, &params).unwrap(),
            expires_at_unix_ms: u64::MAX,
        }
    }

    #[test]
    fn complete_privileged_request_matrix_requires_an_exact_human_decision() {
        let cases = [
            (
                "item/commandExecution/requestApproval",
                json!({"command":"cargo test","cwd":"/project","reason":"verify"}),
                PrivilegedDecision::Approve,
                json!({"decision":"accept"}),
            ),
            (
                "item/fileChange/requestApproval",
                json!({"grantRoot":"/project","reason":"edit"}),
                PrivilegedDecision::Deny,
                json!({"decision":"decline"}),
            ),
            (
                "item/permissions/requestApproval",
                json!({"permissions":{"fileSystem":{"read":["src"]}}}),
                PrivilegedDecision::Approve,
                json!({"permissions":{"fileSystem":{"read":["src"]}},"scope":"turn","strictAutoReview":false}),
            ),
            (
                "item/tool/requestUserInput",
                json!({"questions":[{"id":"choice","question":"Continue?","options":[{"label":"yes"}]}]}),
                PrivilegedDecision::Respond(json!({"answers":{"choice":{"answers":["yes"]}}})),
                json!({"answers":{"choice":{"answers":["yes"]}}}),
            ),
            (
                "mcpServer/elicitation/request",
                json!({"mode":"url","message":"Authenticate","url":"https://example.invalid"}),
                PrivilegedDecision::Approve,
                json!({"action":"accept"}),
            ),
            (
                "mcpServer/elicitation/request",
                json!({"mode":"form","message":"Configure","requestedSchema":{"properties":{"name":{"type":"string"}}}}),
                PrivilegedDecision::Respond(json!({"action":"accept","content":{"name":"safe"}})),
                json!({"action":"accept","content":{"name":"safe"}}),
            ),
            (
                "execCommandApproval",
                json!({"command":["cargo","test"]}),
                PrivilegedDecision::Approve,
                json!({"decision":"approved"}),
            ),
            (
                "applyPatchApproval",
                json!({"reason":"edit"}),
                PrivilegedDecision::Deny,
                json!({"decision":"denied"}),
            ),
        ];
        for (method, params, decision, expected) in cases {
            let prompt = request_prompt(method, params);
            assert_eq!(
                validate_privileged_result(method, &prompt.params, &decision),
                Ok(expected),
                "request matrix mismatch for {method}"
            );
            assert!(prompt.response(decision, true).is_ok());
        }
    }

    #[test]
    fn privileged_responses_bind_host_room_session_request_method_and_expiry() {
        let prompt = request_prompt(
            "item/commandExecution/requestApproval",
            json!({"command":"cargo test"}),
        );
        let valid = prompt.response(PrivilegedDecision::Approve, true).unwrap();
        assert!(validate_privileged_response_binding(&prompt, &valid).is_ok());
        for response in [
            PrivilegedResponse {
                room_id: "other-room".into(),
                ..valid.clone()
            },
            PrivilegedResponse {
                session_id: 8,
                ..valid.clone()
            },
            PrivilegedResponse {
                request_key: "rpc-7-2".into(),
                ..valid.clone()
            },
            PrivilegedResponse {
                request_id: RpcId::Number(100.into()),
                ..valid.clone()
            },
            PrivilegedResponse {
                method: "item/fileChange/requestApproval".into(),
                ..valid.clone()
            },
            PrivilegedResponse {
                active_host: false,
                ..valid.clone()
            },
        ] {
            assert!(validate_privileged_response_binding(&prompt, &response).is_err());
        }
        assert_eq!(
            prompt.response(PrivilegedDecision::Approve, false),
            Err(HostedTurnError::Cancelled)
        );
        let expired = PrivilegedRequestPrompt {
            expires_at_unix_ms: 0,
            ..prompt
        };
        assert_eq!(
            expired.response(PrivilegedDecision::Approve, true),
            Err(HostedTurnError::Timeout)
        );
    }

    #[test]
    fn malformed_unknown_and_oversized_privileged_requests_fail_closed() {
        assert!(project_privileged_request("unknown/request", &json!({})).is_err());
        assert!(project_privileged_request(
            "item/commandExecution/requestApproval",
            &json!({"command": 7})
        )
        .is_err());
        assert!(project_privileged_request(
            "item/permissions/requestApproval",
            &json!({"permissions":{"unknown":true}})
        )
        .is_err());
        assert!(
            project_privileged_request("item/tool/requestUserInput", &json!({"questions":[]}))
                .is_err()
        );
        assert!(project_privileged_request(
            "mcpServer/elicitation/request",
            &json!({"mode":"unsupported","message":"x"})
        )
        .is_err());
        assert!(project_privileged_request(
            "item/commandExecution/requestApproval",
            &json!({"command":"x".repeat(MAX_PRIVILEGED_PARAMS_BYTES)})
        )
        .is_err());
    }

    #[test]
    fn permission_and_file_authority_are_rechecked_against_the_project_root() {
        let (_, mut worker) =
            hosted_turn_interaction("room-1", "turn-1", "Host", "github:host").unwrap();
        worker.approved_project_root = Some(std::env::temp_dir().canonicalize().unwrap());
        worker.allow_network = false;
        let allowed = project_privileged_request(
            "item/permissions/requestApproval",
            &json!({"permissions":{"fileSystem":{"write":["multaiplayer-new-file"]}}}),
        )
        .unwrap();
        assert!(privileged_request_allowed(
            "item/permissions/requestApproval",
            &allowed,
            &worker
        ));
        let escaped = project_privileged_request(
            "item/permissions/requestApproval",
            &json!({"permissions":{"fileSystem":{"read":["../outside"]}}}),
        )
        .unwrap();
        assert!(!privileged_request_allowed(
            "item/permissions/requestApproval",
            &escaped,
            &worker
        ));
        let network = project_privileged_request(
            "item/permissions/requestApproval",
            &json!({"permissions":{"network":{"enabled":true}}}),
        )
        .unwrap();
        assert!(!privileged_request_allowed(
            "item/permissions/requestApproval",
            &network,
            &worker
        ));
        let file_escape = project_privileged_request(
            "item/fileChange/requestApproval",
            &json!({"grantRoot":"/"}),
        )
        .unwrap();
        assert!(!privileged_request_allowed(
            "item/fileChange/requestApproval",
            &file_escape,
            &worker
        ));
    }

    #[test]
    fn trusted_prompt_neutralizes_terminal_spoofing_and_bounds_display() {
        let mut prompt = request_prompt(
            "item/tool/requestUserInput",
            json!({"questions":[{"id":"q","question":"safe"}]}),
        );
        prompt.params = json!({"question": format!("approve\u{1b}[2J{}", "x".repeat(20_000))});
        let rendered = prompt.trusted_text();
        assert!(!rendered.contains('\u{1b}'));
        assert!(rendered.contains("\\u001b"));
        assert!(rendered.chars().count() < 10_000);
        assert!(rendered.contains("Codex privileged request"));
    }

    #[test]
    fn shared_activity_is_normalized_bounded_and_excludes_raw_host_fields() {
        let (_, worker) =
            hosted_turn_interaction("room-1", "turn-1", "Host", "github:host").unwrap();
        let command = json!({"params":{"item":{
            "id":"command-1","type":"commandExecution","status":"completed",
            "command":"cat /Users/host/.env TOKEN=secret",
            "aggregatedOutput":"arbitrary stdout password=hunter2",
            "unknown":{"accessToken":"never"}
        }}});
        let activity =
            project_shared_activity("item/completed", &command, &worker, &mut HashMap::new())
                .unwrap();
        let encoded = serde_json::to_string(&activity).unwrap();
        assert!(encoded.contains("command"));
        for forbidden in [
            "/Users/host",
            "TOKEN=secret",
            "arbitrary stdout",
            "hunter2",
            "accessToken",
            "unknown",
        ] {
            assert!(!encoded.contains(forbidden));
        }
        assert!(activity.details.is_none());

        let reasoning = json!({"params":{"item":{
            "id":"reason-1","type":"reasoning","status":"completed",
            "summary":[{"type":"summary_text","text":"Checked token=secret /private/path AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE ghp_abcdefghijklmnopqrstuvwxyz012345 https://user:pass@example.invalid \u{202e}"}],
            "content":[{"type":"reasoning_text","text":"raw chain of thought"}]
        }}});
        let activity =
            project_shared_activity("item/completed", &reasoning, &worker, &mut HashMap::new())
                .unwrap();
        let encoded = serde_json::to_string(&activity).unwrap();
        assert!(encoded.contains("[redacted]"));
        assert!(!encoded.contains("token=secret"));
        assert!(!encoded.contains("raw chain of thought"));
        assert!(!encoded.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!encoded.contains("ghp_"));
        assert!(!encoded.contains("example.invalid"));
        assert!(!encoded.contains("\\u202e"));
    }

    #[test]
    fn cancellation_fails_before_start_without_reporting_success() {
        let cancelled = AtomicBool::new(true);
        let result = run_hosted_turn(
            &HostedProcessConfig {
                executable: "does-not-run".into(),
                version: "0.144.0".into(),
                extra_arguments: vec![],
            },
            &HostedTurnRequest {
                project_path: std::env::temp_dir(),
                input: "safe".into(),
                settings: CodexTurnSettings::default(),
                previous_thread_id: None,
                timeout: Duration::from_secs(1),
            },
            &cancelled,
        );
        assert_ne!(
            result,
            Ok(HostedTurnResult {
                thread_id: "x".into(),
                assistant_message: "success".into()
            })
        );
    }

    #[test]
    fn proposal_timestamp_expiry_is_stable_and_fail_closed() {
        assert_eq!(
            unix_seconds_from_rfc3339("1970-01-01T00:00:00.000Z"),
            Some(0)
        );
        assert_eq!(
            unix_seconds_from_rfc3339("2026-07-19T12:00:00.000Z"),
            Some(1_784_462_400)
        );
        assert_eq!(unix_seconds_from_rfc3339("2026-02-30T00:00:00Z"), None);
        assert_eq!(unix_seconds_from_rfc3339("2026-07-19 12:00:00Z"), None);

        let now = 1_784_462_400;
        assert_eq!(
            proposal_expiry_from_rfc3339("2026-07-19T12:00:00.000Z", now),
            Ok(now + PROPOSAL_TTL_SECONDS)
        );
        assert_eq!(
            proposal_expiry_from_rfc3339("2026-07-19T12:00:01.000Z", now),
            Err(ProposalError::Invalid)
        );
        assert_eq!(
            proposal_expiry_from_rfc3339("2026-07-19T11:45:00.000Z", now),
            Err(ProposalError::Expired)
        );
        assert_eq!(
            proposal_expiry_from_rfc3339("malformed", now),
            Err(ProposalError::Invalid)
        );
    }

    #[cfg(unix)]
    #[test]
    fn real_compatible_app_server_fixture_runs_initialize_thread_and_turn_contract() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{"userAgent":"fixture"}}' ;;
    *\"method\":\"model/list\"*) printf '%s\n' '{"id":2,"result":{"data":[{"id":"fixture-model","isDefault":true,"defaultReasoningEffort":"high","supportedReasoningEfforts":[{"reasoningEffort":"high"}],"serviceTiers":[{"id":"fast"}],"defaultServiceTier":"fast"}]}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-fixture"}}}'
      printf '%s\n' '{"method":"item/agentMessage/delta","params":{"delta":"Fixture assistant response"}}'
      printf '%s\n' '{"method":"turn/completed","params":{"turn":{"status":"completed"}}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let config = HostedProcessConfig {
            executable: fixture.to_string_lossy().into_owned(),
            version: "0.144.0".into(),
            extra_arguments: vec![],
        };
        let settings = resolve_turn_settings(
            &config,
            &CodexTurnSettings::default(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(settings.model, "fixture-model");
        assert_eq!(settings.reasoning_effort, CodexReasoningEffort::High);
        assert_eq!(settings.speed, CodexSpeed::Fast);
        let result = run_hosted_turn(
            &config,
            &HostedTurnRequest {
                project_path: std::env::temp_dir(),
                input: "bounded input".into(),
                settings,
                previous_thread_id: None,
                timeout: Duration::from_secs(5),
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(result.thread_id, "thread-fixture");
        assert_eq!(result.assistant_message, "Fixture assistant response");
        let _ = std::fs::remove_file(fixture);
    }

    #[cfg(unix)]
    #[test]
    fn real_compatible_request_waits_for_the_exact_active_host_response() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-approval-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-fixture"}}}'
      printf '%s\n' '{"id":99,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-fixture","turnId":"turn-fixture","itemId":"command-1","command":"cargo test","reason":"verify"}}' ;;
    *\"id\":99*\"decision\":\"accept\"*)
      printf '%s\n' '{"method":"item/agentMessage/delta","params":{"delta":"Approved assistant response"}}'
      printf '%s\n' '{"method":"turn/completed","params":{"turn":{"status":"completed"}}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let config = HostedProcessConfig {
            executable: fixture.to_string_lossy().into_owned(),
            version: "0.144.0".into(),
            extra_arguments: vec![],
        };
        let (interaction, mut worker_interaction) =
            hosted_turn_interaction("room-1", "turn-1", "Host", "github:host").unwrap();
        let worker = std::thread::spawn(move || {
            run_hosted_turn_with_interaction(
                &config,
                &HostedTurnRequest {
                    project_path: std::env::temp_dir(),
                    input: "bounded input".into(),
                    settings: CodexTurnSettings::default(),
                    previous_thread_id: None,
                    timeout: Duration::from_secs(5),
                },
                &AtomicBool::new(false),
                &mut worker_interaction,
            )
        });
        let prompt = loop {
            match interaction.event_rx.recv_timeout(Duration::from_secs(2)) {
                Ok(HostedTurnEvent::PrivilegedRequest(prompt)) => break prompt,
                Ok(HostedTurnEvent::Activity(_)) => {}
                Err(error) => panic!("approval prompt not received: {error}"),
            }
        };
        assert_eq!(prompt.room_id, "room-1");
        assert_eq!(prompt.method, "item/commandExecution/requestApproval");
        let valid = prompt.response(PrivilegedDecision::Approve, true).unwrap();
        interaction
            .respond(PrivilegedResponse {
                room_id: "other-room".into(),
                ..valid.clone()
            })
            .unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert!(!worker.is_finished());
        interaction.respond(valid).unwrap();
        let result = worker.join().unwrap().unwrap();
        assert_eq!(result.thread_id, "thread-fixture");
        assert_eq!(result.assistant_message, "Approved assistant response");

        let (shutdown_interaction, mut shutdown_worker_interaction) =
            hosted_turn_interaction("room-1", "turn-2", "Host", "github:host").unwrap();
        let shutdown = Arc::new(AtomicBool::new(false));
        let worker_shutdown = shutdown.clone();
        let shutdown_config = HostedProcessConfig {
            executable: fixture.to_string_lossy().into_owned(),
            version: "0.144.0".into(),
            extra_arguments: vec![],
        };
        let shutdown_worker = std::thread::spawn(move || {
            run_hosted_turn_with_interaction(
                &shutdown_config,
                &HostedTurnRequest {
                    project_path: std::env::temp_dir(),
                    input: "bounded input".into(),
                    settings: CodexTurnSettings::default(),
                    previous_thread_id: None,
                    timeout: Duration::from_secs(5),
                },
                &worker_shutdown,
                &mut shutdown_worker_interaction,
            )
        });
        loop {
            match shutdown_interaction
                .event_rx
                .recv_timeout(Duration::from_secs(2))
            {
                Ok(HostedTurnEvent::PrivilegedRequest(_)) => break,
                Ok(HostedTurnEvent::Activity(_)) => {}
                Err(error) => panic!("shutdown prompt not received: {error}"),
            }
        }
        shutdown.store(true, Ordering::Release);
        assert_eq!(
            shutdown_worker.join().unwrap(),
            Err(HostedTurnError::Cancelled)
        );
        let _ = std::fs::remove_file(fixture);
    }

    #[test]
    fn interrupted_started_turn_is_terminal_after_restart_reconstruction() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        machine.observe(proposal(), 1_000).unwrap();
        machine.observe_started("room-1", "proposal-1").unwrap();
        assert_eq!(machine.phase(), ProposalPhase::Cancelled);
        assert!(!machine.observe(proposal(), 1_000).unwrap());
        assert!(!machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn authority_cancellation_interrupts_a_live_compatible_turn_and_never_succeeds() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-cancel-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*) printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-fixture"}}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let worker_flag = flag.clone();
        let worker_fixture = fixture.clone();
        let worker = std::thread::spawn(move || {
            run_hosted_turn(
                &HostedProcessConfig {
                    executable: worker_fixture.to_string_lossy().into_owned(),
                    version: "0.144.0".into(),
                    extra_arguments: vec![],
                },
                &HostedTurnRequest {
                    project_path: std::env::temp_dir(),
                    input: "bounded input".into(),
                    settings: CodexTurnSettings::default(),
                    previous_thread_id: None,
                    timeout: Duration::from_secs(5),
                },
                &worker_flag,
            )
        });
        std::thread::sleep(Duration::from_millis(150));
        flag.store(true, Ordering::Release);
        assert_eq!(worker.join().unwrap(), Err(HostedTurnError::Cancelled));
        let _ = std::fs::remove_file(fixture);
    }

    #[cfg(unix)]
    #[test]
    fn privileged_or_unknown_server_request_fails_closed_without_reflecting_payload() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-request-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*) printf '%s\n' '{"id":99,"method":"unknown/privileged","params":{"accessToken":"never-reflect-this"}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let error = run_hosted_turn(
            &HostedProcessConfig {
                executable: fixture.to_string_lossy().into_owned(),
                version: "0.144.0".into(),
                extra_arguments: vec![],
            },
            &HostedTurnRequest {
                project_path: std::env::temp_dir(),
                input: "bounded input".into(),
                settings: CodexTurnSettings::default(),
                previous_thread_id: None,
                timeout: Duration::from_secs(5),
            },
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(error, HostedTurnError::PrivilegedRequestUnsupported);
        assert!(!error.to_string().contains("never-reflect-this"));
        let _ = std::fs::remove_file(fixture);
    }
}
