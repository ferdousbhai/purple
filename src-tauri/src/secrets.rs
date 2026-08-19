//! Gemini API key storage.
//!
//! The key lives in the OS credential store (Secret Service on Linux). Machines
//! without a running secret service fall back to a `0600` file under the config
//! directory, which is also where Riff <= 0.2.0 kept the key — startup migrates
//! that file into the keyring and deletes it.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use keyring::v1::{Entry, Error as KeyringError};
use serde::Serialize;

const SERVICE: &str = "dev.ferdous.riff";
const ACCOUNT: &str = "gemini-api-key";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub has_key: bool,
    /// "app" (stored by the user), "env" (GEMINI_API_KEY) or "missing".
    pub source: &'static str,
}

fn entry() -> Result<Entry, KeyringError> {
    Entry::new(SERVICE, ACCOUNT)
}

fn fallback_path() -> Option<PathBuf> {
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(config_home.join("riff").join("config.json"))
}

fn read_fallback() -> Option<String> {
    let path = fallback_path()?;
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let key = value.get("googleApiKey")?.as_str()?.trim().to_owned();
    (!key.is_empty()).then_some(key)
}

fn write_fallback(key: &str) -> Result<(), String> {
    let path = fallback_path().ok_or("Could not resolve a config directory.")?;
    let dir = path.parent().ok_or("Invalid config path.")?;
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    set_owner_only(dir, 0o700)?;

    let body = serde_json::json!({ "googleApiKey": key }).to_string();
    let temp = path.with_extension("json.tmp");
    // Created 0600 rather than chmodded afterwards: the umask default would
    // leave the key world-readable for the length of the write.
    let mut file = owner_only_file(&temp)?;
    file.write_all(body.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temp, &path).map_err(|error| error.to_string())?;
    Ok(())
}

fn clear_fallback() {
    if let Some(path) = fallback_path() {
        let _ = fs::remove_file(path);
    }
}

fn owner_only_file(path: &std::path::Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|error| error.to_string())
}

fn set_owner_only(path: impl AsRef<std::path::Path>, mode: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }
    Ok(())
}

/// The key the user saved in Riff, from the keyring or the fallback file.
pub fn stored_key() -> Option<String> {
    match entry().and_then(|entry| entry.get_password()) {
        Ok(key) => {
            let key = key.trim().to_owned();
            if key.is_empty() {
                read_fallback()
            } else {
                Some(key)
            }
        }
        Err(KeyringError::NoEntry) => read_fallback(),
        Err(error) => {
            log::warn!("[Secrets] Credential store unavailable: {error}");
            read_fallback()
        }
    }
}

pub fn env_key() -> Option<String> {
    let key = std::env::var("GEMINI_API_KEY").ok()?.trim().to_owned();
    (!key.is_empty()).then_some(key)
}

/// The key requests should use: an explicitly saved key wins over the environment.
pub fn effective_key() -> Option<String> {
    stored_key().or_else(env_key)
}

pub fn status() -> ApiKeyStatus {
    if stored_key().is_some() {
        ApiKeyStatus {
            has_key: true,
            source: "app",
        }
    } else if env_key().is_some() {
        ApiKeyStatus {
            has_key: true,
            source: "env",
        }
    } else {
        ApiKeyStatus {
            has_key: false,
            source: "missing",
        }
    }
}

pub fn save(key: &str) -> Result<ApiKeyStatus, String> {
    let key = key.trim();
    if key.is_empty() {
        return clear();
    }

    match entry().and_then(|entry| entry.set_password(key)) {
        Ok(()) => {
            clear_fallback();
        }
        Err(error) => {
            log::warn!("[Secrets] Could not use the credential store ({error}); storing the key in a 0600 file instead.");
            write_fallback(key)?;
        }
    }
    Ok(status())
}

pub fn clear() -> Result<ApiKeyStatus, String> {
    match entry().and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(KeyringError::NoEntry) => {}
        Err(error) => log::warn!("[Secrets] Could not delete the stored key: {error}"),
    }
    clear_fallback();
    Ok(status())
}

/// Move a pre-Tauri `config.json` key into the credential store, then delete the file.
pub fn migrate_legacy_file() {
    let Some(key) = read_fallback() else {
        return;
    };
    // A key already in the store is the newer one: the file is only written
    // when the store was unavailable.
    if entry().and_then(|entry| entry.get_password()).is_ok() {
        clear_fallback();
        return;
    }
    match entry().and_then(|entry| entry.set_password(&key)) {
        Ok(()) => {
            clear_fallback();
            log::info!("[Secrets] Migrated the saved API key into the OS credential store.");
        }
        Err(error) => {
            log::warn!("[Secrets] Keeping the key in the config file; credential store unavailable: {error}");
        }
    }
}

// The Secret Service is D-Bus, and a locked keyring blocks until the user
// answers the unlock prompt. Synchronous commands run on the main GTK thread,
// which would freeze the window, so every one of these hops onto a blocking
// worker instead.
async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("The credential store task failed: {error}"))
}

#[tauri::command]
pub async fn api_key_status() -> Result<ApiKeyStatus, String> {
    off_thread(status).await
}

#[tauri::command]
pub async fn save_api_key(api_key: String) -> Result<ApiKeyStatus, String> {
    off_thread(move || save(&api_key)).await?
}

#[tauri::command]
pub async fn clear_api_key() -> Result<ApiKeyStatus, String> {
    off_thread(clear).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Touches the real credential store, so it is opt-in:
    /// `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`
    #[test]
    #[ignore]
    fn round_trips_a_key_through_the_credential_store() {
        let entry = Entry::new(SERVICE, "test-account").expect("an entry");
        entry.set_password("test-value").expect("store the secret");
        assert_eq!(entry.get_password().expect("read it back"), "test-value");
        entry.delete_credential().expect("delete it");
        assert!(matches!(entry.get_password(), Err(KeyringError::NoEntry)));
    }
}
