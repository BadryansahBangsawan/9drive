use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// Names and sizes of the given paths that are regular files (folders and unreadable paths are left out).
#[tauri::command]
pub fn inspect_paths(paths: Vec<String>) -> Vec<LocalFile> {
    paths
        .into_iter()
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            if !meta.is_file() {
                return None;
            }
            let name = Path::new(&path).file_name()?.to_string_lossy().into_owned();
            Some(LocalFile { path, name, size: meta.len() })
        })
        .collect()
}

/// Modification time in milliseconds, used to notice a file that changed under a paused upload.
pub fn modified_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

#[derive(Serialize)]
pub struct ServerInfo {
    pub status: Option<String>,
    pub version: Option<String>,
}

/// Asks a 9Drive server for /api/health from the native side, where CORS doesn't apply. The window
/// can then tell "not a 9Drive server / unreachable" apart from "server too old for the desktop app"
/// (reachable here, but its CORS refuses the app's window).
#[tauri::command]
pub async fn server_info(url: String) -> Result<ServerInfo, String> {
    #[derive(serde::Deserialize)]
    struct Health {
        status: Option<String>,
        version: Option<String>,
    }
    let response = reqwest::Client::new()
        .get(format!("{}/api/health", url.trim_end_matches('/')))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let health: Health = response.json().await.map_err(|e| e.to_string())?;
    Ok(ServerInfo { status: health.status, version: health.version })
}
