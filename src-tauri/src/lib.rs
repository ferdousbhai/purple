mod gemini;
mod patterns;
mod secrets;
mod startup;

use tauri::{Emitter, Manager};

/// A second `riff …` invocation hands its arguments to the running window.
pub const STARTUP_ARGS_EVENT: &str = "riff://startup-args";

/// WebKitGTK's DMABUF renderer paints nothing on several Mesa drivers — the
/// window opens fully transparent — so Riff opts out by default. `RIFF_GPU=1`
/// asks for the accelerated path back.
#[cfg(target_os = "linux")]
fn prefer_a_renderer_that_paints() {
    let opted_in = std::env::var("RIFF_GPU")
        .is_ok_and(|value| matches!(value.trim(), "1" | "true" | "yes"));
    if opted_in || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    // Safe here: this runs before any window, plugin or thread exists.
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
}

pub fn run() {
    #[cfg(target_os = "linux")]
    prefer_a_renderer_that_paints();

    let mut builder = tauri::Builder::default();

    // The single-instance plugin has to be registered first to work reliably.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let forwarded: Vec<String> = args.into_iter().skip(1).collect();
            if let Err(error) = app.emit(STARTUP_ARGS_EVENT, forwarded) {
                log::warn!("[Startup] Could not forward arguments to the window: {error}");
            }
        }));
    }

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("riff".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(gemini::GeminiState::default())
        .setup(|_app| {
            secrets::migrate_legacy_file();
            log::info!("Riff started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            gemini::stream_pattern,
            gemini::abort_stream,
            gemini::generate_json,
            secrets::api_key_status,
            secrets::save_api_key,
            secrets::clear_api_key,
            patterns::save_pattern,
            startup::startup_args,
            startup::log_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Riff");
}
