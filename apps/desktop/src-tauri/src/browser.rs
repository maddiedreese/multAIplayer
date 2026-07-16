use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{webview::DownloadEvent, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::validation::{ensure_room_id, validate_browser_url};

pub(crate) const ROOM_BROWSER_GUARD_SCRIPT: &str = r#"
(() => {
  const blocked = () => Promise.reject(new DOMException("multAIplayer blocks room browser clipboard access by default.", "NotAllowedError"));
  try {
    if (navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: false,
        enumerable: true,
        value: Object.freeze({
          read: blocked,
          readText: blocked,
          write: blocked,
          writeText: blocked
        })
      });
    }
  } catch (_) {}

  const isFileInput = (target) => {
    if (!target || !target.closest) return false;
    const input = target.closest("input[type=file]");
    return Boolean(input);
  };
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("click", (event) => {
    if (isFileInput(event.target)) block(event);
  }, true);
  window.addEventListener("change", (event) => {
    if (isFileInput(event.target)) {
      try { event.target.value = ""; } catch (_) {}
      block(event);
    }
  }, true);
  window.addEventListener("drop", block, true);
  window.addEventListener("dragover", block, true);
})();
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserOpenRequest {
    room_id: String,
    project_path: Option<String>,
    url: String,
    title: Option<String>,
    persistent: Option<bool>,
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
    clipboard_blocked: bool,
    file_uploads_blocked: bool,
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
pub(crate) fn open_browser_view(
    app: AppHandle,
    request: BrowserOpenRequest,
) -> crate::command_error::CommandResult<BrowserOpenResult> {
    let url = validate_browser_url(&request.url)?;
    let persistent = request.persistent.unwrap_or(true);

    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let profile_dir = browser_profile_dir(&app, &request.room_id, request.project_path.as_deref())?;
    if !persistent {
        if let Some(window) = app.get_webview_window(&label) {
            window
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
    let title = request
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "multAIplayer Browser - {}",
                url.host_str().unwrap_or("approved page")
            )
        });

    if persistent {
        if let Some(window) = app.get_webview_window(&label) {
            window
                .navigate(url.clone())
                .map_err(|error| format!("Failed to navigate browser view: {error}"))?;
            window
                .set_title(&title)
                .map_err(|error| format!("Failed to retitle browser view: {error}"))?;
            window
                .set_focus()
                .map_err(|error| format!("Failed to focus browser view: {error}"))?;
            return Ok(BrowserOpenResult {
                label,
                url: url.to_string(),
                reused: true,
                profile_path: profile_dir.to_string_lossy().to_string(),
                persistent,
                downloads_blocked: true,
                clipboard_blocked: true,
                file_uploads_blocked: true,
            });
        }
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.clone()))
        .title(&title)
        .inner_size(1120.0, 820.0)
        .min_inner_size(720.0, 520.0)
        .data_directory(profile_dir.clone())
        .initialization_script_for_all_frames(ROOM_BROWSER_GUARD_SCRIPT)
        .on_download(|_webview, event| match event {
            DownloadEvent::Requested { .. } => {
                eprintln!("Blocked a multAIplayer room browser download");
                false
            }
            DownloadEvent::Finished { .. } => true,
            _ => true,
        })
        .build()
        .map_err(|error| format!("Failed to open browser view: {error}"))?;

    Ok(BrowserOpenResult {
        label,
        url: url.to_string(),
        reused: false,
        profile_path: profile_dir.to_string_lossy().to_string(),
        persistent,
        downloads_blocked: true,
        clipboard_blocked: true,
        file_uploads_blocked: true,
    })
}

#[typed_tauri_command::command]
pub(crate) fn reset_browser_profile(
    app: AppHandle,
    request: BrowserProfileRequest,
) -> crate::command_error::CommandResult<BrowserProfileResult> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    if let Some(window) = app.get_webview_window(&label) {
        window
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
