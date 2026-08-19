//! Saving a pattern to disk through the native file chooser.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Mirrors the `SavePatternResult` union in `src/shared/types.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePatternResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancelled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl SavePatternResult {
    fn saved(path: String) -> Self {
        Self {
            ok: true,
            path: Some(path),
            cancelled: None,
            error: None,
        }
    }

    fn cancelled() -> Self {
        Self {
            ok: false,
            path: None,
            cancelled: Some(true),
            error: None,
        }
    }

    fn failed(error: String) -> Self {
        Self {
            ok: false,
            path: None,
            cancelled: Some(false),
            error: Some(error),
        }
    }
}

fn starting_directory() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let music = home.join("Music");
    Some(if music.is_dir() { music } else { home })
}

#[tauri::command]
pub async fn save_pattern(
    app: AppHandle,
    suggested_name: String,
    code: String,
) -> Result<SavePatternResult, String> {
    let code = code.trim().to_owned();
    if code.is_empty() {
        return Ok(SavePatternResult::failed(
            "Pattern code is required.".to_owned(),
        ));
    }

    let mut builder = app
        .dialog()
        .file()
        .set_title("Save pattern")
        .set_file_name(&suggested_name)
        .add_filter("Strudel pattern", &["strudel"]);
    if let Some(directory) = starting_directory() {
        builder = builder.set_directory(directory);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.save_file(move |path| {
        let _ = tx.send(path);
    });

    let Ok(picked) = rx.await else {
        return Ok(SavePatternResult::failed(
            "The save dialog closed unexpectedly.".to_owned(),
        ));
    };
    let Some(path) = picked else {
        return Ok(SavePatternResult::cancelled());
    };
    let path = match path.into_path() {
        Ok(path) => path,
        Err(error) => return Ok(SavePatternResult::failed(error.to_string())),
    };

    match std::fs::write(&path, format!("{code}\n")) {
        Ok(()) => {
            log::info!("[Pattern] Saved {}", path.display());
            Ok(SavePatternResult::saved(
                path.to_string_lossy().into_owned(),
            ))
        }
        Err(error) => Ok(SavePatternResult::failed(error.to_string())),
    }
}
