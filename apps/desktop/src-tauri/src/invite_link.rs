use serde::Serialize;
use std::sync::Mutex;
#[cfg(any(target_os = "macos", test))]
use tauri::Url;
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(target_os = "macos")]
const INVITE_AVAILABLE_EVENT: &str = "native-invite://available";
#[cfg(any(target_os = "macos", test))]
const MAX_INVITE_URL_CHARS: usize = 12_288;
#[cfg(any(target_os = "macos", test))]
const MAX_INVITE_ID_CHARS: usize = 160;
#[cfg(any(target_os = "macos", test))]
const ALLOWED_HOSTS: [&str; 2] = ["multaiplayer.com", "open.multaiplayer.com"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInvitePayload {
    invite_id: String,
    encoded_invite: String,
}

#[derive(Default)]
pub struct NativeInviteState {
    // Deliberately one-shot and bounded: a newer OS link replaces an unopened
    // one, and the webview can consume it exactly once. Nothing is persisted.
    pending: Mutex<Option<NativeInvitePayload>>,
}

impl NativeInviteState {
    #[cfg(any(target_os = "macos", test))]
    fn replace(&self, invite: NativeInvitePayload) -> Result<(), ()> {
        self.pending.lock().map_err(|_| ())?.replace(invite);
        Ok(())
    }

    fn take(&self) -> Result<Option<NativeInvitePayload>, ()> {
        Ok(self.pending.lock().map_err(|_| ())?.take())
    }
}

#[tauri::command]
pub fn take_pending_native_invite(
    state: tauri::State<'_, NativeInviteState>,
) -> crate::command_error::CommandResult<Option<NativeInvitePayload>> {
    state.take().map_err(|()| {
        crate::command_error::CommandError::unavailable(
            "Native invite intake is temporarily unavailable.",
        )
    })
}

/// Accept an OS-delivered link without ever emitting or logging its bearer
/// fragment. A batch is rejected as ambiguous; macOS normally supplies one URL.
#[cfg(target_os = "macos")]
pub fn handle_opened_invite_urls<R: Runtime>(app: &AppHandle<R>, urls: &[Url]) {
    let [url] = urls else {
        return;
    };
    let Ok(invite) = parse_invite_url(url) else {
        return;
    };
    let state = app.state::<NativeInviteState>();
    if state.replace(invite).is_err() {
        return;
    }

    // The event discloses only availability. The capability remains behind a
    // one-shot command until the frontend is ready to consume it.
    let _ = app.emit(INVITE_AVAILABLE_EVENT, ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(any(target_os = "macos", test))]
fn parse_invite_url(url: &Url) -> Result<NativeInvitePayload, InviteUrlError> {
    if url.as_str().len() > MAX_INVITE_URL_CHARS {
        return Err(InviteUrlError::Invalid);
    }
    if url.scheme() != "https"
        || !ALLOWED_HOSTS.contains(&url.host_str().unwrap_or_default())
        || !matches!(url.path(), "/invite" | "/invite/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
    {
        return Err(InviteUrlError::Invalid);
    }

    let fragment = url.fragment().ok_or(InviteUrlError::Invalid)?;
    let mut invite_id = None;
    let mut encoded_invite = None;
    let mut approval = None;
    let mut count = 0;
    for part in fragment.split('&') {
        count += 1;
        let (key, value) = part.split_once('=').ok_or(InviteUrlError::Invalid)?;
        if value.is_empty() {
            return Err(InviteUrlError::Invalid);
        }
        match key {
            "invite" if invite_id.is_none() => invite_id = Some(value),
            "multaiplayerJoin" if encoded_invite.is_none() => encoded_invite = Some(value),
            "approval" if approval.is_none() => approval = Some(value),
            _ => return Err(InviteUrlError::Invalid),
        }
    }
    if count != 3 || approval != Some("request") {
        return Err(InviteUrlError::Invalid);
    }

    let invite_id = invite_id.ok_or(InviteUrlError::Invalid)?;
    let encoded_invite = encoded_invite.ok_or(InviteUrlError::Invalid)?;
    if !bounded_base64url(invite_id, MAX_INVITE_ID_CHARS)
        || !bounded_base64url(encoded_invite, MAX_INVITE_URL_CHARS)
    {
        return Err(InviteUrlError::Invalid);
    }

    Ok(NativeInvitePayload {
        invite_id: invite_id.to_string(),
        encoded_invite: encoded_invite.to_string(),
    })
}

#[cfg(any(target_os = "macos", test))]
fn bounded_base64url(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[derive(Debug)]
#[cfg(any(target_os = "macos", test))]
enum InviteUrlError {
    Invalid,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str) -> Result<NativeInvitePayload, InviteUrlError> {
        parse_invite_url(&Url::parse(raw).expect("test URL should parse"))
    }

    #[test]
    fn accepts_only_canonical_verified_https_invites() {
        for host in ALLOWED_HOSTS {
            for path in ["/invite", "/invite/"] {
                let parsed = parse(&format!(
                    "https://{host}{path}#approval=request&multaiplayerJoin=encoded_ABC-123&invite=invite_123"
                ))
                .expect("canonical invite");
                assert_eq!(parsed.invite_id, "invite_123");
                assert_eq!(parsed.encoded_invite, "encoded_ABC-123");
            }
        }
    }

    #[test]
    fn rejects_noncanonical_authorities_paths_and_query_data() {
        for raw in [
            "http://open.multaiplayer.com/invite/#invite=a&multaiplayerJoin=b&approval=request",
            "https://evil.example/invite/#invite=a&multaiplayerJoin=b&approval=request",
            "https://multaiplayer.com.evil.example/invite/#invite=a&multaiplayerJoin=b&approval=request",
            "https://user@multaiplayer.com/invite/#invite=a&multaiplayerJoin=b&approval=request",
            "https://multaiplayer.com:444/invite/#invite=a&multaiplayerJoin=b&approval=request",
            "https://multaiplayer.com/other/#invite=a&multaiplayerJoin=b&approval=request",
            "https://multaiplayer.com/invite/?invite=a#invite=a&multaiplayerJoin=b&approval=request",
        ] {
            assert!(parse(raw).is_err(), "accepted {raw}");
        }
    }

    #[test]
    fn rejects_ambiguous_legacy_malformed_and_oversize_fragments() {
        let long = "a".repeat(MAX_INVITE_URL_CHARS + 1);
        for raw in [
            "https://multaiplayer.com/invite/",
            "https://multaiplayer.com/invite/#invite=a&multaiplayerJoin=b",
            "https://multaiplayer.com/invite/#invite=a&multaiplayerJoin=b&approval=other",
            "https://multaiplayer.com/invite/#invite=a&invite=c&multaiplayerJoin=b&approval=request",
            "https://multaiplayer.com/invite/#invite=a&multaiplayerJoin=b&approval=request&extra=c",
            "https://multaiplayer.com/invite/#invite=a&multaiplayerInvite=roomkey&approval=request",
            "https://multaiplayer.com/invite/#invite=a%2Fb&multaiplayerJoin=b&approval=request",
        ] {
            assert!(parse(raw).is_err(), "accepted {raw}");
        }
        assert!(parse(&format!(
            "https://multaiplayer.com/invite/#invite=a&multaiplayerJoin={long}&approval=request"
        ))
        .is_err());
    }

    #[test]
    fn pending_state_is_memory_only_replacing_and_one_shot() {
        let state = NativeInviteState::default();
        state
            .replace(NativeInvitePayload {
                invite_id: "old".into(),
                encoded_invite: "old-capability".into(),
            })
            .expect("replace old");
        state
            .replace(NativeInvitePayload {
                invite_id: "new".into(),
                encoded_invite: "new-capability".into(),
            })
            .expect("replace new");

        let taken = state.take().expect("take").expect("pending invite");
        assert_eq!(taken.invite_id, "new");
        assert!(state.take().expect("second take").is_none());
    }
}
