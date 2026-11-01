//! Downloads streamed straight to disk (`<dest>.part`, renamed when complete), so a large file never
//! sits in memory the way a browser blob download does.

use crate::api::{failure_from_response, Api, Failure};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct Downloads {
    running: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    id: String,
    /// API path, e.g. /files/<id>/download.
    path: String,
    dest: PathBuf,
    method: String,
    body: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEvent<'a> {
    id: &'a str,
    received: u64,
    total: Option<u64>,
    status: &'a str,
    error: Option<String>,
}

#[tauri::command]
pub fn download_start(request: DownloadRequest, app: AppHandle, api: State<'_, Api>, downloads: State<'_, Downloads>) -> Result<(), String> {
    if !request.path.starts_with('/') {
        return Err("Invalid download path".into());
    }
    let token = CancellationToken::new();
    downloads.running.lock().unwrap().insert(request.id.clone(), token.clone());
    let api = api.inner().clone();
    tauri::async_runtime::spawn(async move {
        let id = request.id.clone();
        let result = tokio::select! {
            result = download(&app, &api, &request) => result,
            _ = token.cancelled() => Err(Failure::Fatal("Cancelled".into())),
        };
        let part = part_path(&request.dest);
        let event = match result {
            Ok(received) => DownloadEvent { id: &id, received, total: Some(received), status: "done", error: None },
            Err(failure) => {
                let _ = tokio::fs::remove_file(&part).await;
                let cancelled = token.is_cancelled();
                DownloadEvent { id: &id, received: 0, total: None, status: if cancelled { "cancelled" } else { "error" }, error: Some(failure.message().to_string()) }
            }
        };
        let _ = app.emit("download://changed", event);
        app.state::<Downloads>().running.lock().unwrap().remove(&id);
    });
    Ok(())
}

#[tauri::command]
pub fn download_cancel(id: String, downloads: State<'_, Downloads>) {
    if let Some(token) = downloads.running.lock().unwrap().get(&id) {
        token.cancel();
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".part");
    dest.with_file_name(name)
}

async fn download(app: &AppHandle, api: &Api, request: &DownloadRequest) -> Result<u64, Failure> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| Failure::Fatal("Invalid method".into()))?;
    let response = api
        .send(|client, base, token| {
            let builder = client.request(method.clone(), format!("{base}{}", request.path)).bearer_auth(token);
            Ok(match &request.body {
                Some(body) => builder.json(body),
                None => builder,
            })
        })
        .await?;
    if !response.status().is_success() {
        return Err(failure_from_response(response).await);
    }
    let total = response.content_length();
    let part = part_path(&request.dest);
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| Failure::Fatal(format!("Can't write the file: {e}")))?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| Failure::Fatal(format!("The download was interrupted: {e}")))?;
        file.write_all(&chunk).await.map_err(|e| Failure::Fatal(format!("Can't write the file: {e}")))?;
        received += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(250) {
            last = Instant::now();
            let _ = app.emit("download://changed", DownloadEvent { id: &request.id, received, total, status: "downloading", error: None });
        }
    }
    file.flush().await.map_err(|e| Failure::Fatal(format!("Can't write the file: {e}")))?;
    drop(file);
    tokio::fs::rename(&part, &request.dest).await.map_err(|e| Failure::Fatal(format!("Can't save the file: {e}")))?;
    Ok(received)
}
