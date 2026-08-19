//! Startup arguments and renderer logging.
//!
//! Argument *parsing* stays in TypeScript (`src/shared/cli.ts`) so the launcher
//! grammar has one implementation and one test suite.

/// Everything after the executable name, in order.
#[tauri::command]
pub fn startup_args() -> Vec<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Also the webview's "I booted" signal, which is worth having in a log people send us.
    log::info!(
        "[Startup] Webview ready; forwarding {} argument(s)",
        args.len()
    );
    args
}

/// Diagnostics the webview forwards from `console.warn` / `console.error`.
/// Async so the log write happens off the main GTK thread.
#[tauri::command]
pub async fn log_message(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[Webview] {message}"),
        "warn" => log::warn!("[Webview] {message}"),
        _ => log::info!("[Webview] {message}"),
    }
}
