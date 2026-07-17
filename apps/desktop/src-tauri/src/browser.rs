use serde::{Deserialize, Serialize};
use std::collections::{hash_map::DefaultHasher, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use tauri::{
    webview::{DownloadEvent, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
};

use crate::validation::{ensure_room_id, validate_browser_url};

pub(crate) const ROOM_BROWSER_GUARD_SCRIPT: &str = include_str!("browser_guard.js");
const BROWSER_NAVIGATED_EVENT: &str = "browser://navigated";

#[derive(Default)]
pub(crate) struct BrowserState {
    operation: Mutex<()>,
    sessions: Mutex<HashMap<String, BrowserSession>>,
}

struct BrowserSession {
    navigation_id: String,
    tab_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserOpenRequest {
    room_id: String,
    project_path: Option<String>,
    navigation_id: String,
    tab_id: String,
    url: String,
    bounds: BrowserBounds,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserViewRequest {
    room_id: String,
    project_path: Option<String>,
    navigation_id: String,
    tab_id: String,
    bounds: Option<BrowserBounds>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserNavigationRequest {
    room_id: String,
    project_path: Option<String>,
    navigation_id: String,
    tab_id: String,
    action: BrowserNavigationAction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserSessionRequest {
    room_id: String,
    project_path: Option<String>,
    navigation_id: String,
    tab_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum BrowserNavigationAction {
    Back,
    Forward,
    Reload,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserNavigatedEvent {
    room_id: String,
    project_path: Option<String>,
    navigation_id: String,
    tab_id: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserViewStateResult {
    navigation_id: String,
    tab_id: String,
    url: String,
}

#[typed_tauri_command::command]
pub(crate) fn open_browser_view(
    app: AppHandle,
    parent: WebviewWindow,
    state: State<'_, BrowserState>,
    request: BrowserOpenRequest,
) -> crate::command_error::CommandResult<()> {
    let url = validate_browser_url(&request.url)?;
    ensure_browser_session_id("navigation", &request.navigation_id)?;
    ensure_browser_session_id("tab", &request.tab_id)?;
    let (position, size) = browser_geometry(&request.bounds)?;

    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "Browser operation lock is poisoned".to_string())?;
    if let Some(webview) = app.get_webview(&label) {
        webview
            .close()
            .map_err(|error| format!("Failed to close room browser before opening: {error}"))?;
    }
    state
        .sessions
        .lock()
        .map_err(|_| "Browser session lock is poisoned".to_string())?
        .remove(&label);

    let navigation_room_id = request.room_id.clone();
    let navigation_project_path = request.project_path.clone();
    let navigation_id = request.navigation_id.clone();
    let tab_id = request.tab_id.clone();
    let session_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url.clone()))
        .incognito(true)
        .disable_drag_drop_handler()
        .focused(true)
        .initialization_script_for_all_frames(ROOM_BROWSER_GUARD_SCRIPT)
        .on_navigation(browser_navigation_allowed)
        .on_page_load(move |webview, payload| {
            if payload.event() != PageLoadEvent::Started {
                return;
            }
            let state = webview.app_handle().state::<BrowserState>();
            let current = state.sessions.lock().ok().is_some_and(|sessions| {
                sessions.get(&session_label).is_some_and(|session| {
                    session.navigation_id == navigation_id && session.tab_id == tab_id
                })
            });
            if !current {
                return;
            }
            let event = BrowserNavigatedEvent {
                room_id: navigation_room_id.clone(),
                project_path: navigation_project_path.clone(),
                navigation_id: navigation_id.clone(),
                tab_id: tab_id.clone(),
                url: payload.url().to_string(),
            };
            if let Err(error) = webview
                .app_handle()
                .emit_to("main", BROWSER_NAVIGATED_EVENT, event)
            {
                eprintln!("Failed to report room browser navigation: {error}");
            }
        })
        .on_download(|_webview, event| match event {
            DownloadEvent::Requested { .. } => {
                eprintln!("Blocked a multAIplayer room browser download");
                false
            }
            DownloadEvent::Finished { .. } => true,
            _ => true,
        });
    parent
        .as_ref()
        .window()
        .add_child(builder, position, size)
        .map_err(|error| format!("Failed to open browser view: {error}"))?;
    state
        .sessions
        .lock()
        .map_err(|_| "Browser session lock is poisoned".to_string())?
        .insert(
            label,
            BrowserSession {
                navigation_id: request.navigation_id,
                tab_id: request.tab_id,
            },
        );

    Ok(())
}

#[typed_tauri_command::command]
pub(crate) fn navigate_browser_view(
    app: AppHandle,
    state: State<'_, BrowserState>,
    request: BrowserNavigationRequest,
) -> crate::command_error::CommandResult<()> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let _operation = lock_browser_operation(&state)?;
    ensure_current_browser_session(&state, &label, &request.navigation_id, &request.tab_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Room browser is not open".to_string())?;
    let script = match request.action {
        BrowserNavigationAction::Back => "window.history.back()",
        BrowserNavigationAction::Forward => "window.history.forward()",
        BrowserNavigationAction::Reload => {
            webview
                .reload()
                .map_err(|error| format!("Failed to reload room browser: {error}"))?;
            return Ok(());
        }
    };
    webview
        .eval(script)
        .map_err(|error| format!("Failed to navigate room browser: {error}"))?;
    Ok(())
}

#[typed_tauri_command::command]
pub(crate) fn browser_view_state(
    app: AppHandle,
    state: State<'_, BrowserState>,
    request: BrowserSessionRequest,
) -> crate::command_error::CommandResult<BrowserViewStateResult> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let _operation = lock_browser_operation(&state)?;
    ensure_current_browser_session(&state, &label, &request.navigation_id, &request.tab_id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Room browser is not open".to_string())?;
    let url = webview
        .url()
        .map_err(|error| format!("Failed to read room browser URL: {error}"))?;
    validate_browser_url(url.as_str())?;
    Ok(BrowserViewStateResult {
        navigation_id: request.navigation_id,
        tab_id: request.tab_id,
        url: url.to_string(),
    })
}

#[typed_tauri_command::command]
pub(crate) fn position_browser_view(
    app: AppHandle,
    state: State<'_, BrowserState>,
    request: BrowserViewRequest,
) -> crate::command_error::CommandResult<()> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let _operation = lock_browser_operation(&state)?;
    ensure_current_browser_session(&state, &label, &request.navigation_id, &request.tab_id)?;
    let bounds = request
        .bounds
        .as_ref()
        .ok_or_else(|| "Browser bounds are required".to_string())?;
    let (position, size) = browser_geometry(bounds)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Room browser is not open".to_string())?;
    webview
        .set_position(position)
        .map_err(|error| format!("Failed to position browser view: {error}"))?;
    webview
        .set_size(size)
        .map_err(|error| format!("Failed to resize browser view: {error}"))?;
    Ok(())
}

#[typed_tauri_command::command]
pub(crate) fn close_browser_view(
    app: AppHandle,
    state: State<'_, BrowserState>,
    request: BrowserViewRequest,
) -> crate::command_error::CommandResult<()> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let _operation = lock_browser_operation(&state)?;
    if ensure_current_browser_session(&state, &label, &request.navigation_id, &request.tab_id)
        .is_err()
    {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(&label) {
        webview
            .close()
            .map_err(|error| format!("Failed to close room browser: {error}"))?;
    }
    state
        .sessions
        .lock()
        .map_err(|_| "Browser session lock is poisoned".to_string())?
        .remove(&label);
    Ok(())
}

fn lock_browser_operation<'a>(
    state: &'a BrowserState,
) -> Result<std::sync::MutexGuard<'a, ()>, String> {
    state
        .operation
        .lock()
        .map_err(|_| "Browser operation lock is poisoned".to_string())
}

fn ensure_current_browser_session(
    state: &BrowserState,
    label: &str,
    navigation_id: &str,
    tab_id: &str,
) -> Result<(), String> {
    ensure_browser_session_id("navigation", navigation_id)?;
    ensure_browser_session_id("tab", tab_id)?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser session lock is poisoned".to_string())?;
    let current = sessions
        .get(label)
        .is_some_and(|session| session.navigation_id == navigation_id && session.tab_id == tab_id);
    if !current {
        return Err("Room browser session is no longer active".to_string());
    }
    Ok(())
}

fn browser_geometry(
    bounds: &BrowserBounds,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if values.iter().any(|value| !value.is_finite()) {
        return Err("Browser bounds must be finite numbers".to_string());
    }
    if bounds.x < 0.0 || bounds.y < 0.0 || bounds.x > 20_000.0 || bounds.y > 20_000.0 {
        return Err("Browser position is outside the supported range".to_string());
    }
    if bounds.width < 1.0
        || bounds.height < 1.0
        || bounds.width > 20_000.0
        || bounds.height > 20_000.0
    {
        return Err("Browser size is outside the supported range".to_string());
    }
    Ok((
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    ))
}

fn browser_navigation_allowed(url: &tauri::Url) -> bool {
    validate_browser_url(url.as_str()).is_ok()
}

fn ensure_browser_session_id(kind: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("Browser {kind} ID is invalid"));
    }
    Ok(())
}

pub(crate) fn sanitize_window_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

pub(crate) fn browser_window_label(
    room_id: &str,
    project_path: Option<&str>,
) -> Result<String, String> {
    Ok(format!(
        "room-browser-{}",
        browser_view_scope(room_id, project_path)?
    ))
}

pub(crate) fn browser_view_scope(
    room_id: &str,
    project_path: Option<&str>,
) -> Result<String, String> {
    ensure_room_id(room_id)?;
    let normalized_project = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("no-project");
    let mut hasher = DefaultHasher::new();
    normalized_project.hash(&mut hasher);
    let project_hash = hasher.finish();
    Ok(format!(
        "{}--project-{project_hash:016x}",
        sanitize_window_label(room_id)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_geometry_rejects_untrusted_or_unbounded_values() {
        let valid = BrowserBounds {
            x: 12.0,
            y: 24.0,
            width: 800.0,
            height: 600.0,
        };
        assert!(browser_geometry(&valid).is_ok());
        assert!(browser_geometry(&BrowserBounds {
            width: 0.0,
            ..valid.clone()
        })
        .is_err());
        assert!(browser_geometry(&BrowserBounds {
            x: f64::NAN,
            ..valid.clone()
        })
        .is_err());
        assert!(browser_geometry(&BrowserBounds {
            height: 20_001.0,
            ..valid
        })
        .is_err());
    }

    #[test]
    fn browser_navigation_allows_only_hosted_http_pages() {
        for allowed in ["https://example.com/redirect", "http://localhost:5173/"] {
            let url = allowed.parse().expect("valid test URL");
            assert!(browser_navigation_allowed(&url));
        }
        for blocked in [
            "file:///tmp/secret",
            "javascript:alert(1)",
            "data:text/html,secret",
        ] {
            let url = blocked.parse().expect("valid test URL");
            assert!(!browser_navigation_allowed(&url));
        }
        assert!(
            ensure_browser_session_id("navigation", "442cbe28-8214-4aad-b634-f1a50f558922").is_ok()
        );
        assert!(ensure_browser_session_id("tab", "../../other-view").is_err());
    }

    #[test]
    fn browser_commands_require_the_exact_navigation_and_tab_session() {
        let state = BrowserState::default();
        state.sessions.lock().unwrap().insert(
            "room-browser-test".to_string(),
            BrowserSession {
                navigation_id: "navigation-current".to_string(),
                tab_id: "tab-current".to_string(),
            },
        );

        assert!(ensure_current_browser_session(
            &state,
            "room-browser-test",
            "navigation-current",
            "tab-current"
        )
        .is_ok());
        assert!(ensure_current_browser_session(
            &state,
            "room-browser-test",
            "navigation-stale",
            "tab-current"
        )
        .is_err());
        assert!(ensure_current_browser_session(
            &state,
            "room-browser-test",
            "navigation-current",
            "tab-stale"
        )
        .is_err());
    }
}
