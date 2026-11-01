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
