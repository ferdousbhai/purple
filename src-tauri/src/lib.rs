mod gemini;
mod mpris;
mod patterns;
mod secrets;
mod startup;
mod theme;

use tauri::{Emitter, Manager};

/// A second `purple-music …` invocation hands its arguments to the running window.
pub const STARTUP_ARGS_EVENT: &str = "purple://startup-args";

#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// WebKitGTK's DMABUF renderer paints nothing on some Mesa drivers. Keep the
/// accelerated default for unaffected systems, but offer a Purple-scoped
/// workaround instead of asking users to change their session globally.
#[cfg(target_os = "linux")]
fn configure_dmabuf_renderer() {
    if !environment_flag("PURPLE_DISABLE_DMABUF")
        || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
    {
        return;
    }
    // Safe here: this runs before any window, plugin or thread exists.
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
}

#[cfg(target_os = "linux")]
fn environment_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| environment_flag_value(&value))
}

#[cfg(target_os = "linux")]
fn environment_flag_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// WebKitGTK's audio runs in a child WebProcess that shows up in
/// PipeWire/PulseAudio as a generic WebKit client. libpulse (and PipeWire's
/// pulse compatibility layer) read `PULSE_PROP_*` from the environment, which
/// the WebProcess inherits, so mixers show "Purple" instead.
#[cfg(target_os = "linux")]
fn name_audio_streams() {
    for (key, value) in [
        ("PULSE_PROP_application.name", "Purple"),
        ("PULSE_PROP_application.id", "com.soundspurple.Purple"),
        (
            "PULSE_PROP_application.icon_name",
            "com.soundspurple.Purple",
        ),
        ("PULSE_PROP_media.name", "Purple"),
    ] {
        if std::env::var_os(key).is_none() {
            // Safe here: this runs before any window, plugin or thread exists.
            std::env::set_var(key, value);
        }
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    {
        configure_dmabuf_renderer();
        name_audio_streams();
    }

    let mut builder = tauri::Builder::default();

    // The single-instance plugin has to be registered first to work reliably.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);
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
                        file_name: Some("purple".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(gemini::GeminiState::default())
        .setup(|app| {
            secrets::migrate_legacy_file();
            #[cfg(target_os = "linux")]
            {
                app.manage(mpris::MprisState::default());
                mpris::init(app.handle());
            }
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            log::info!("Purple started");
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
            mpris::set_playback_state,
            theme::get_system_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Purple");
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::environment_flag_value;

    #[test]
    fn recognizes_explicit_environment_flags() {
        for enabled in ["1", "true", "TRUE", " yes ", "on"] {
            assert!(environment_flag_value(enabled));
        }
        for disabled in ["", "0", "false", "no", "enabled"] {
            assert!(!environment_flag_value(disabled));
        }
    }
}
