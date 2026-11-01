//! Downloads streamed straight to disk, never held in memory.
//!
//! When the server answers byte ranges (stored files do; exported Google documents and ZIPs don't),
//! a large file is fetched as 4 ranges at once into a preallocated `<dest>.part`. Progress per range
//! is saved next to it (`<dest>.part.json`), so a dropped connection retries just the missing bytes,
//! and downloading the same file to the same place later picks up where it stopped. Otherwise the
//! response streams in one piece.

use crate::api::{failure_from_response, Api, Failure};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

const PARALLEL: u64 = 4;
/// Below this, one connection is as fast as four.
const PARALLEL_MIN_BYTES: u64 = 32 * 1024 * 1024;
/// Consecutive failures of one range (without progress in between) before giving up.
const MAX_FAILURES: u32 = 8;

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

/// One byte range of the file: `next` is the first byte not yet written; done when next > end.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
struct Segment {
    start: u64,
    end: u64,
    next: u64,
}

#[derive(Serialize, Deserialize)]
struct Resume {
    /// The API path and size the partial file belongs to.
    path: String,
    total: u64,
    segments: Vec<Segment>,
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
        let event = match result {
            Ok(received) => DownloadEvent { id: &id, received, total: Some(received), status: "done", error: None },
            Err(failure) => {
                let cancelled = token.is_cancelled();
                if cancelled {
                    // A cancelled download isn't resumed: drop what it wrote.
                    let _ = tokio::fs::remove_file(part_path(&request.dest)).await;
                    let _ = tokio::fs::remove_file(resume_path(&request.dest)).await;
                }
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

fn with_suffix(dest: &Path, suffix: &str) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(suffix);
    dest.with_file_name(name)
}

fn part_path(dest: &Path) -> PathBuf {
    with_suffix(dest, ".part")
}

fn resume_path(dest: &Path) -> PathBuf {
    with_suffix(dest, ".part.json")
}

/// Total size from `Content-Range: bytes 0-0/12345`.
fn total_from_content_range(value: Option<&str>) -> Option<u64> {
    value?.rsplit('/').next()?.trim().parse().ok()
}

/// `count` contiguous ranges covering 0..total.
fn split(total: u64, count: u64) -> Vec<Segment> {
    let count = count.max(1).min(total.max(1));
    let size = total.div_ceil(count);
    (0..count)
        .map(|i| i * size)
        .take_while(|&start| start < total)
        .map(|start| Segment { start, end: (start + size).min(total) - 1, next: start })
        .collect()
}

struct Progress<'a> {
    app: &'a AppHandle,
    id: &'a str,
    total: Option<u64>,
    received: AtomicU64,
    last: Mutex<Instant>,
}

impl Progress<'_> {
    fn add(&self, bytes: u64) {
        let received = self.received.fetch_add(bytes, Ordering::Relaxed) + bytes;
        let mut last = self.last.lock().unwrap();
        if last.elapsed() >= Duration::from_millis(250) {
            *last = Instant::now();
            let _ = self.app.emit("download://changed", DownloadEvent { id: self.id, received, total: self.total, status: "downloading", error: None });
        }
    }
}

async fn download(app: &AppHandle, api: &Api, request: &DownloadRequest) -> Result<u64, Failure> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| Failure::Fatal("Invalid method".into()))?;
    // Ask for the first byte: a 206 says ranges work and gives the size.
    let probe = api
        .send(|client, base, token| {
            let builder = client.request(method.clone(), format!("{base}{}", request.path)).bearer_auth(token);
            Ok(match &request.body {
                Some(body) => builder.json(body),
                None => builder.header(reqwest::header::RANGE, "bytes=0-0"),
            })
        })
        .await?;
    if !probe.status().is_success() {
        return Err(failure_from_response(probe).await);
    }
    if probe.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        if let Some(total) = total_from_content_range(probe.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok())) {
            drop(probe);
            return ranged(app, api, request, total).await;
        }
    }
    single(app, request, probe).await
}

/// The whole response in one stream (no ranges): written to `.part`, renamed when complete.
async fn single(app: &AppHandle, request: &DownloadRequest, response: reqwest::Response) -> Result<u64, Failure> {
    let progress = Progress { app, id: &request.id, total: response.content_length(), received: AtomicU64::new(0), last: Mutex::new(Instant::now()) };
    let part = part_path(&request.dest);
    let mut file = tokio::fs::File::create(&part).await.map_err(write_failure)?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| Failure::Fatal(format!("The download was interrupted: {e}")))?;
        file.write_all(&chunk).await.map_err(write_failure)?;
        progress.add(chunk.len() as u64);
    }
    file.flush().await.map_err(write_failure)?;
    drop(file);
    tokio::fs::rename(&part, &request.dest).await.map_err(write_failure)?;
    Ok(progress.received.load(Ordering::Relaxed))
}

fn write_failure(error: std::io::Error) -> Failure {
    Failure::Fatal(format!("Can't write the file: {error}"))
}

/// Byte ranges in parallel into a preallocated `.part`, resumable through `.part.json`.
async fn ranged(app: &AppHandle, api: &Api, request: &DownloadRequest, total: u64) -> Result<u64, Failure> {
    let part = part_path(&request.dest);
    let resume_file = resume_path(&request.dest);

    // Pick up an earlier attempt at the same file and place, if its partial file is still intact.
    let previous: Option<Resume> = tokio::fs::read(&resume_file).await.ok().and_then(|b| serde_json::from_slice(&b).ok());
    let part_len = tokio::fs::metadata(&part).await.map(|m| m.len()).ok();
    let segments = match previous {
        Some(r) if r.path == request.path && r.total == total && part_len == Some(total) => r.segments,
        _ => {
            let file = tokio::fs::File::create(&part).await.map_err(write_failure)?;
            file.set_len(total).await.map_err(write_failure)?;
            split(total, if total >= PARALLEL_MIN_BYTES { PARALLEL } else { 1 })
        }
    };
    let already: u64 = segments.iter().map(|s| s.next - s.start).sum();
    let progress = Progress { app, id: &request.id, total: Some(total), received: AtomicU64::new(already), last: Mutex::new(Instant::now()) };
    let state = Arc::new(Mutex::new(Resume { path: request.path.clone(), total, segments }));
    save_resume(&resume_file, &state).await;

    let count = state.lock().unwrap().segments.len();
    let workers = (0..count).map(|index| fetch_segment(api, request, &part, &resume_file, &state, index, &progress));
    let results = futures_util::future::join_all(workers).await;
    save_resume(&resume_file, &state).await;
    if let Some(failure) = results.into_iter().find_map(Result::err) {
        return Err(failure);   // .part and .part.json stay, to resume next time
    }

    tokio::fs::rename(&part, &request.dest).await.map_err(write_failure)?;
    let _ = tokio::fs::remove_file(&resume_file).await;
    Ok(total)
}

async fn save_resume(path: &Path, state: &Arc<Mutex<Resume>>) {
    let bytes = serde_json::to_vec(&*state.lock().unwrap()).unwrap_or_default();
    let tmp = with_suffix(path, ".tmp");
    if tokio::fs::write(&tmp, bytes).await.is_ok() {
        let _ = tokio::fs::rename(&tmp, path).await;
    }
}

/// Downloads one range, retrying from the last written byte after a failure.
async fn fetch_segment(api: &Api, request: &DownloadRequest, part: &Path, resume_file: &Path, state: &Arc<Mutex<Resume>>, index: usize, progress: &Progress<'_>) -> Result<(), Failure> {
    let mut file = tokio::fs::OpenOptions::new().write(true).open(part).await.map_err(write_failure)?;
    let mut failures = 0u32;
    let mut last_save = Instant::now();
    loop {
        let Segment { end, next, .. } = state.lock().unwrap().segments[index].clone();
        if next > end {
            return Ok(());
        }
        let attempt = async {
            let response = api
                .send(|client, base, token| Ok(client.get(format!("{base}{}", request.path)).bearer_auth(token).header(reqwest::header::RANGE, format!("bytes={next}-{end}"))))
                .await?;
            if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(if response.status().is_success() { Failure::Fatal("The server stopped answering byte ranges".into()) } else { failure_from_response(response).await });
            }
            file.seek(SeekFrom::Start(next)).await.map_err(write_failure)?;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| Failure::Retry(format!("The download was interrupted: {e}")))?;
                let room = (end + 1).saturating_sub(state.lock().unwrap().segments[index].next);
                let chunk = &chunk[..chunk.len().min(room as usize)];
                file.write_all(chunk).await.map_err(write_failure)?;
                state.lock().unwrap().segments[index].next += chunk.len() as u64;
                progress.add(chunk.len() as u64);
                failures = 0;
                if last_save.elapsed() >= Duration::from_secs(2) {
                    last_save = Instant::now();
                    file.flush().await.map_err(write_failure)?;
                    save_resume(resume_file, state).await;
                }
            }
            file.flush().await.map_err(write_failure)?;
            Ok::<(), Failure>(())
        };
        match attempt.await {
            Ok(()) => {}
            Err(Failure::Fatal(message)) => return Err(Failure::Fatal(message)),
            Err(failure) => {
                failures += 1;
                if failures >= MAX_FAILURES {
                    return Err(Failure::Fatal(format!("{} (download it again to continue)", failure.message())));
                }
                tokio::time::sleep(Duration::from_secs(2u64.pow(failures.min(5)).min(30))).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_covers_every_byte_once() {
        for (total, count) in [(100u64, 4u64), (10, 4), (3, 4), (1, 4), (101, 4), (64 * 1024 * 1024 + 7, 4)] {
            let segments = split(total, count);
            assert_eq!(segments[0].start, 0);
            assert_eq!(segments.last().unwrap().end, total - 1);
            for pair in segments.windows(2) {
                assert_eq!(pair[0].end + 1, pair[1].start);
            }
            assert!(segments.iter().all(|s| s.next == s.start && s.start <= s.end));
        }
    }

    #[test]
    fn content_range_gives_total() {
        assert_eq!(total_from_content_range(Some("bytes 0-0/12345")), Some(12345));
        assert_eq!(total_from_content_range(Some("bytes 0-0/*")), None);
        assert_eq!(total_from_content_range(None), None);
    }
}
