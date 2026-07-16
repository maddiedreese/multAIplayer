use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{
    webview::{DownloadEvent, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
};

use crate::validation::{ensure_room_id, validate_browser_url};

pub(crate) const ROOM_BROWSER_GUARD_SCRIPT: &str = include_str!("browser_guard.js");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserOpenRequest {
    room_id: String,
    project_path: Option<String>,
    url: String,
    persistent: Option<bool>,
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
    bounds: Option<BrowserBounds>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserOpenResult {
    label: String,
    url: String,
    reused: bool,
    profile_path: String,
    persistent: bool,
    downloads_blocked: bool,
    page_guard_installed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserProfileRequest {
    room_id: String,
    project_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserProfileResult {
    room_id: String,
    profile_path: String,
    reset: bool,
}

#[typed_tauri_command::command]
pub(crate) async fn open_browser_view(
    app: AppHandle,
    parent: WebviewWindow,
    request: BrowserOpenRequest,
) -> crate::command_error::CommandResult<BrowserOpenResult> {
    let url = validate_browser_url(&request.url)?;
    let persistent = request.persistent.unwrap_or(true);
    let (position, size) = browser_geometry(&request.bounds)?;

    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let profile_dir = browser_profile_dir(&app, &request.room_id, request.project_path.as_deref())?;
    if !persistent {
        if let Some(webview) = app.get_webview(&label) {
            webview
                .close()
                .map_err(|error| format!("Failed to close room browser before refresh: {error}"))?;
        }
        if profile_dir.exists() {
            fs::remove_dir_all(&profile_dir)
                .map_err(|error| format!("Failed to refresh room browser profile: {error}"))?;
        }
    }
    fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("Failed to create room browser profile: {error}"))?;
    if persistent {
        if let Some(webview) = app.get_webview(&label) {
            webview
                .navigate(url.clone())
                .map_err(|error| format!("Failed to navigate browser view: {error}"))?;
            webview
                .set_position(position)
                .map_err(|error| format!("Failed to position browser view: {error}"))?;
            webview
                .set_size(size)
                .map_err(|error| format!("Failed to resize browser view: {error}"))?;
            webview
                .set_focus()
                .map_err(|error| format!("Failed to focus browser view: {error}"))?;
            return Ok(BrowserOpenResult {
                label,
                url: url.to_string(),
                reused: true,
                profile_path: profile_dir.to_string_lossy().to_string(),
                persistent,
                downloads_blocked: true,
                page_guard_installed: true,
            });
        }
    }

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url.clone()))
        .data_directory(profile_dir.clone())
        .disable_drag_drop_handler()
        .focused(true)
        .initialization_script_for_all_frames(ROOM_BROWSER_GUARD_SCRIPT)
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

    Ok(BrowserOpenResult {
        label,
        url: url.to_string(),
        reused: false,
        profile_path: profile_dir.to_string_lossy().to_string(),
        persistent,
        downloads_blocked: true,
        page_guard_installed: true,
    })
}

#[typed_tauri_command::command]
pub(crate) fn position_browser_view(
    app: AppHandle,
    request: BrowserViewRequest,
) -> crate::command_error::CommandResult<()> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
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
    request: BrowserViewRequest,
) -> crate::command_error::CommandResult<()> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    if let Some(webview) = app.get_webview(&label) {
        webview
            .close()
            .map_err(|error| format!("Failed to close room browser: {error}"))?;
    }
    Ok(())
}

#[typed_tauri_command::command]
pub(crate) fn reset_browser_profile(
    app: AppHandle,
    request: BrowserProfileRequest,
) -> crate::command_error::CommandResult<BrowserProfileResult> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    if let Some(webview) = app.get_webview(&label) {
        webview
            .close()
            .map_err(|error| format!("Failed to close room browser before reset: {error}"))?;
    }

    let profile_dir = browser_profile_dir(&app, &request.room_id, request.project_path.as_deref())?;
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir)
            .map_err(|error| format!("Failed to reset room browser profile: {error}"))?;
    }

    Ok(BrowserProfileResult {
        room_id: request.room_id,
        profile_path: profile_dir.to_string_lossy().to_string(),
        reset: true,
    })
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

fn browser_profile_dir(
    app: &AppHandle,
    room_id: &str,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    let scope = browser_profile_scope(room_id, project_path)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    Ok(base.join("browser-profiles").join(scope))
}

pub(crate) fn browser_window_label(
    room_id: &str,
    project_path: Option<&str>,
) -> Result<String, String> {
    Ok(format!(
        "room-browser-{}",
        browser_profile_scope(room_id, project_path)?
    ))
}

pub(crate) fn browser_profile_scope(
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
}
