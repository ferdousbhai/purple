//! MPRIS media-control bridge (Linux only).
//!
//! Rust only speaks D-Bus here: desktop media-key presses become
//! `purple://media-control` events for the webview, and the webview reports
//! playback status back through `set_playback_state`. What a "play" or "stop"
//! request *means* stays in TypeScript, next to the rest of the playback logic.

#[cfg(target_os = "linux")]
pub use linux::{init, MprisState};

/// The webview reports its playback status and pattern title here whenever
/// either changes. MPRIS is a Linux desktop protocol; elsewhere the command
/// accepts the report and does nothing, so the webview stays platform-agnostic.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn set_playback_state(
    status: String,
    title: String,
    state: tauri::State<'_, MprisState>,
) -> Result<(), String> {
    linux::apply_playback_state(&state, &status, title).await;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn set_playback_state(_status: String, _title: String) {}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::{Arc, Mutex, OnceLock};

    use crate::focus_main_window;
    use mpris_server::zbus::{self, fdo};
    use mpris_server::{
        LoopStatus, Metadata, PlaybackRate, PlaybackStatus, Property, Server, Time, TrackId, Volume,
    };
    use tauri::{AppHandle, Emitter, Manager};

    /// Emitted at the webview whenever a desktop media control asks for something.
    /// Payload: `"play"`, `"pause"`, `"play-pause"` or `"stop"`.
    pub const MEDIA_CONTROL_EVENT: &str = "purple://media-control";

    /// What the desktop sees, as last reported by the webview.
    struct Shared {
        status: PlaybackStatus,
        title: String,
    }

    #[derive(Clone)]
    pub struct MprisState {
        shared: Arc<Mutex<Shared>>,
        server: Arc<OnceLock<Server<PurplePlayer>>>,
    }

    impl Default for MprisState {
        fn default() -> Self {
            Self {
                shared: Arc::new(Mutex::new(Shared {
                    status: PlaybackStatus::Stopped,
                    title: String::new(),
                })),
                server: Arc::new(OnceLock::new()),
            }
        }
    }

    /// Map the webview's `PlaybackState` strings onto the three MPRIS statuses.
    /// "loading" and "transitioning" count as Playing - the player is engaged,
    /// the way a buffering media player still reports Playing.
    fn map_status(status: &str) -> PlaybackStatus {
        match status {
            "playing" | "transitioning" | "loading" => PlaybackStatus::Playing,
            "paused" => PlaybackStatus::Paused,
            _ => PlaybackStatus::Stopped,
        }
    }

    fn metadata_for(title: &str) -> Metadata {
        let mut builder = Metadata::builder();
        if !title.trim().is_empty() {
            builder = builder.title(title.trim());
        }
        builder.build()
    }

    /// Register `org.mpris.MediaPlayer2.Purple` on the session bus. Registration
    /// runs in the background; a desktop without D-Bus just logs and moves on.
    pub fn init(app: &AppHandle) {
        let state = app.state::<MprisState>();
        let shared = state.shared.clone();
        let cell = state.server.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match Server::new("Purple", PurplePlayer { app, shared }).await {
                Ok(server) => {
                    log::info!("[MPRIS] Registered as {}", server.bus_name());
                    let _ = cell.set(server);
                }
                Err(error) => {
                    log::warn!("[MPRIS] Media controls unavailable: {error}");
                }
            }
        });
    }

    /// Store the webview's latest playback report and signal the change on the bus.
    pub async fn apply_playback_state(state: &MprisState, status: &str, title: String) {
        let mapped = map_status(status);
        {
            let mut shared = state.shared.lock().expect("MPRIS state poisoned");
            shared.status = mapped;
            shared.title = title.clone();
        }

        if let Some(server) = state.server.get() {
            if let Err(error) = server
                .properties_changed([
                    Property::PlaybackStatus(mapped),
                    Property::Metadata(metadata_for(&title)),
                ])
                .await
            {
                log::warn!("[MPRIS] Could not signal properties change: {error}");
            }
        }
    }

    struct PurplePlayer {
        app: AppHandle,
        shared: Arc<Mutex<Shared>>,
    }

    impl PurplePlayer {
        fn request(&self, action: &str) -> fdo::Result<()> {
            log::info!("[MPRIS] Desktop requested {action}");
            self.app
                .emit(MEDIA_CONTROL_EVENT, action)
                .map_err(|error| fdo::Error::Failed(error.to_string()))
        }
    }

    impl mpris_server::RootInterface for PurplePlayer {
        async fn raise(&self) -> fdo::Result<()> {
            focus_main_window(&self.app);
            Ok(())
        }

        async fn quit(&self) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("Quit is not supported".into()))
        }

        async fn can_quit(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn fullscreen(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn set_fullscreen(&self, _fullscreen: bool) -> zbus::Result<()> {
            Ok(())
        }

        async fn can_set_fullscreen(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn can_raise(&self) -> fdo::Result<bool> {
            Ok(true)
        }

        async fn has_track_list(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn identity(&self) -> fdo::Result<String> {
            Ok("Purple".into())
        }

        async fn desktop_entry(&self) -> fdo::Result<String> {
            Ok("com.soundspurple.Purple".into())
        }

        async fn supported_uri_schemes(&self) -> fdo::Result<Vec<String>> {
            Ok(Vec::new())
        }

        async fn supported_mime_types(&self) -> fdo::Result<Vec<String>> {
            Ok(Vec::new())
        }
    }

    impl mpris_server::PlayerInterface for PurplePlayer {
        async fn next(&self) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("Next is not supported".into()))
        }

        async fn previous(&self) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("Previous is not supported".into()))
        }

        async fn pause(&self) -> fdo::Result<()> {
            self.request("pause")
        }

        async fn play_pause(&self) -> fdo::Result<()> {
            self.request("play-pause")
        }

        async fn stop(&self) -> fdo::Result<()> {
            self.request("stop")
        }

        async fn play(&self) -> fdo::Result<()> {
            self.request("play")
        }

        async fn seek(&self, _offset: Time) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("Seek is not supported".into()))
        }

        async fn set_position(&self, _track_id: TrackId, _position: Time) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported(
                "SetPosition is not supported".into(),
            ))
        }

        async fn open_uri(&self, _uri: String) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("OpenUri is not supported".into()))
        }

        async fn playback_status(&self) -> fdo::Result<PlaybackStatus> {
            Ok(self.shared.lock().expect("MPRIS state poisoned").status)
        }

        async fn loop_status(&self) -> fdo::Result<LoopStatus> {
            Ok(LoopStatus::None)
        }

        async fn set_loop_status(&self, _loop_status: LoopStatus) -> zbus::Result<()> {
            Ok(())
        }

        async fn rate(&self) -> fdo::Result<PlaybackRate> {
            Ok(1.0)
        }

        async fn set_rate(&self, _rate: PlaybackRate) -> zbus::Result<()> {
            Ok(())
        }

        async fn shuffle(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn set_shuffle(&self, _shuffle: bool) -> zbus::Result<()> {
            Ok(())
        }

        async fn metadata(&self) -> fdo::Result<Metadata> {
            let title = self
                .shared
                .lock()
                .expect("MPRIS state poisoned")
                .title
                .clone();
            Ok(metadata_for(&title))
        }

        async fn volume(&self) -> fdo::Result<Volume> {
            Ok(1.0)
        }

        async fn set_volume(&self, _volume: Volume) -> zbus::Result<()> {
            Ok(())
        }

        async fn position(&self) -> fdo::Result<Time> {
            Ok(Time::ZERO)
        }

        async fn minimum_rate(&self) -> fdo::Result<PlaybackRate> {
            Ok(1.0)
        }

        async fn maximum_rate(&self) -> fdo::Result<PlaybackRate> {
            Ok(1.0)
        }

        async fn can_go_next(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn can_go_previous(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn can_play(&self) -> fdo::Result<bool> {
            Ok(true)
        }

        async fn can_pause(&self) -> fdo::Result<bool> {
            Ok(true)
        }

        async fn can_seek(&self) -> fdo::Result<bool> {
            Ok(false)
        }

        async fn can_control(&self) -> fdo::Result<bool> {
            Ok(true)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn maps_webview_states_onto_mpris_statuses() {
            assert_eq!(map_status("playing"), PlaybackStatus::Playing);
            assert_eq!(map_status("transitioning"), PlaybackStatus::Playing);
            assert_eq!(map_status("loading"), PlaybackStatus::Playing);
            assert_eq!(map_status("paused"), PlaybackStatus::Paused);
            assert_eq!(map_status("stopped"), PlaybackStatus::Stopped);
            assert_eq!(map_status("error"), PlaybackStatus::Stopped);
            assert_eq!(map_status(""), PlaybackStatus::Stopped);
        }

        #[test]
        fn blank_titles_produce_empty_metadata() {
            assert_eq!(metadata_for("  ").title(), None);
            assert_eq!(metadata_for("Night Drive").title(), Some("Night Drive"));
        }
    }
}
