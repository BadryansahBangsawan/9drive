//! Upload queue. Items are kept in `uploads.json` in the app data folder, so uploads survive quitting,
//! crashes and reboots: on the next launch unfinished items are queued again and each transfer asks
//! Google/S3 how much it already has. Two files upload at a time; a temporary failure (offline,
//! 5xx, signed out) waits with growing pauses and retries forever, a permanent one stops the item.

mod transfer;

use crate::api::{Api, Auth, Failure};
use crate::files::modified_ms;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

const MAX_CONCURRENT: usize = 2;
const MAX_BACKOFF_SECS: u64 = 60;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Uploading,
    Waiting,
    Paused,
    Done,
    Error,
    Cancelled,
}

/// Where an item's bytes go, as agreed with the server at init.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Session {
    /// Google resumable session: chunks go straight to `upload_url`.
    #[serde(rename_all = "camelCase")]
    Google { session_id: String, upload_url: String },
    /// S3 multipart upload: parts go straight to presigned URLs.
    #[serde(rename_all = "camelCase")]
    S3 { session_id: String, part_size: u64, part_count: u32 },
    /// Through the server in one request (S3 bucket on a private network).
    #[serde(rename_all = "camelCase")]
    Server { account_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub mime_type: String,
    pub folder_id: Option<String>,
    pub target_account_id: Option<String>,
    pub status: Status,
    pub uploaded: u64,
    pub error: Option<String>,
    pub account_label: Option<String>,
    pub session: Option<Session>,
    /// Bytes per second while uploading (smoothed); not saved.
    #[serde(skip)]
    pub speed: u64,
}

/// What the web side sees of an item.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    id: String,
    name: String,
    size: u64,
    uploaded: u64,
    status: Status,
    error: Option<String>,
    account_label: Option<String>,
    speed: u64,
}

impl From<&Item> for View {
    fn from(item: &Item) -> Self {
        View {
            id: item.id.clone(),
            name: item.name.clone(),
            size: item.size,
            uploaded: item.uploaded,
            status: item.status,
            error: item.error.clone(),
            account_label: item.account_label.clone(),
            speed: if item.status == Status::Uploading { item.speed } else { 0 },
        }
    }
}

/// Upload speed over ~1 s windows, smoothed so the number doesn't jump around.
struct Rate {
    since: Instant,
    bytes: u64,
    bps: f64,
}

#[derive(Default)]
struct Queue {
    items: Vec<Item>,
    running: HashMap<String, CancellationToken>,
    last_progress: HashMap<String, Instant>,
    rates: HashMap<String, Rate>,
}

#[derive(Clone)]
pub struct Uploader {
    inner: Arc<Inner>,
}

struct Inner {
    app: AppHandle,
    api: Api,
    file: PathBuf,
    queue: Mutex<Queue>,
    wake: Notify,
    awake: Mutex<Option<keepawake::KeepAwake>>,
}

impl Uploader {
    pub fn load(app: AppHandle, api: Api, file: PathBuf) -> Self {
        let mut items: Vec<Item> = std::fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        // Whatever was running when the app stopped carries on.
        for item in &mut items {
            if matches!(item.status, Status::Uploading | Status::Waiting) {
                item.status = Status::Queued;
            }
        }
        Uploader {
            inner: Arc::new(Inner { app, api, file, queue: Mutex::new(Queue { items, ..Default::default() }), wake: Notify::new(), awake: Mutex::new(None) }),
        }
    }

    pub fn api(&self) -> &Api {
        &self.inner.api
    }

    pub fn active_count(&self) -> usize {
        let queue = self.inner.queue.lock().unwrap();
        queue.items.iter().filter(|i| matches!(i.status, Status::Queued | Status::Uploading | Status::Waiting)).count()
    }

    /// Starts the scheduler: keeps up to MAX_CONCURRENT queued items running.
    pub fn start(&self) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                this.schedule();
                this.update_keep_awake();
                let _ = tokio::time::timeout(Duration::from_secs(30), this.inner.wake.notified()).await;
            }
        });
    }

    fn schedule(&self) {
        let started: Vec<(String, CancellationToken)> = {
            let mut queue = self.inner.queue.lock().unwrap();
            let free = MAX_CONCURRENT.saturating_sub(queue.running.len());
            let ids: Vec<String> = queue.items.iter().filter(|i| i.status == Status::Queued && !queue.running.contains_key(&i.id)).take(free).map(|i| i.id.clone()).collect();
            ids.into_iter()
                .map(|id| {
                    let token = CancellationToken::new();
                    queue.running.insert(id.clone(), token.clone());
                    (id, token)
                })
                .collect()
        };
        for (id, token) in started {
            self.set_status(&id, Status::Uploading, None);
            let this = self.clone();
            tauri::async_runtime::spawn(async move {
                this.run(&id, token).await;
                this.inner.queue.lock().unwrap().running.remove(&id);
                this.inner.wake.notify_one();
            });
        }
    }

    async fn run(&self, id: &str, token: CancellationToken) {
        let mut attempt: u32 = 0;
        loop {
            let result = tokio::select! {
                result = transfer::upload(self, id) => result,
                _ = token.cancelled() => return,   // paused or cancelled: status already set
            };
            match result {
                Ok(()) => {
                    self.update(id, |item| {
                        item.status = Status::Done;
                        item.uploaded = item.size;
                        item.error = None;
                    });
                    return;
                }
                Err(Failure::Restart(message)) => {
                    // The session is gone: start over with a new one (no wait for the first restart).
                    self.update(id, |item| {
                        item.session = None;
                        item.uploaded = 0;
                    });
                    attempt += 1;
                    if attempt > 1 && !self.wait(id, &token, attempt, &message).await {
                        return;
                    }
                }
                Err(Failure::Retry(message)) => {
                    attempt += 1;
                    if !self.wait(id, &token, attempt, &message).await {
                        return;
                    }
                }
                Err(Failure::Fatal(message)) => {
                    if !token.is_cancelled() {
                        self.set_status(id, Status::Error, Some(message));
                    }
                    return;
                }
            }
        }
    }

    /// Shows "waiting", sleeps 2, 4, 8 … 60 s (or until stopped), then resumes. False if stopped.
    async fn wait(&self, id: &str, token: &CancellationToken, attempt: u32, message: &str) -> bool {
        if token.is_cancelled() {
            return false;
        }
        self.set_status(id, Status::Waiting, Some(message.to_string()));
        let delay = Duration::from_secs(2u64.saturating_pow(attempt.min(6)).min(MAX_BACKOFF_SECS));
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = token.cancelled() => return false,
        }
        self.set_status(id, Status::Uploading, None);
        true
    }

    fn update_keep_awake(&self) {
        let active = self.active_count() > 0;
        let mut awake = self.inner.awake.lock().unwrap();
        if active && awake.is_none() {
            *awake = keepawake::Builder::default().idle(true).reason("Uploading files").app_name("9Drive").app_reverse_domain("engineer.badry.ninedrive").create().ok();
        } else if !active {
            *awake = None;
        }
    }

    pub fn item(&self, id: &str) -> Option<Item> {
        self.inner.queue.lock().unwrap().items.iter().find(|i| i.id == id).cloned()
    }

    /// Changes an item, saves the queue and tells the web side.
    pub fn update(&self, id: &str, change: impl FnOnce(&mut Item)) {
        let view = {
            let mut queue = self.inner.queue.lock().unwrap();
            let Some(item) = queue.items.iter_mut().find(|i| i.id == id) else { return };
            change(item);
            let view = View::from(&*item);
            self.save(&queue.items);
            view
        };
        let _ = self.inner.app.emit("upload://changed", view);
    }

    fn set_status(&self, id: &str, status: Status, error: Option<String>) {
        if status != Status::Uploading {
            self.inner.queue.lock().unwrap().rates.remove(id);
        }
        self.update(id, |item| {
            item.status = status;
            item.error = error;
            if status != Status::Uploading {
                item.speed = 0;
            }
        });
    }

    /// Bytes the destination has (or is receiving). Throttled; not saved (resuming asks the destination).
    pub fn progress(&self, id: &str, uploaded: u64) {
        let view = {
            let mut queue = self.inner.queue.lock().unwrap();
            let now = Instant::now();
            let due = queue.last_progress.get(id).map_or(true, |last| now.duration_since(*last) >= PROGRESS_EVERY);
            let uploaded = uploaded.min(queue.items.iter().find(|i| i.id == id).map_or(0, |i| i.size));
            let rate = queue.rates.entry(id.to_string()).or_insert(Rate { since: now, bytes: uploaded, bps: 0.0 });
            let elapsed = now.duration_since(rate.since).as_secs_f64();
            if uploaded < rate.bytes {
                // Went back (a retry resumes from what the destination has): restart the window.
                *rate = Rate { since: now, bytes: uploaded, bps: rate.bps };
            } else if elapsed >= 1.0 {
                let current = (uploaded - rate.bytes) as f64 / elapsed;
                rate.bps = if rate.bps == 0.0 { current } else { rate.bps * 0.7 + current * 0.3 };
                rate.since = now;
                rate.bytes = uploaded;
            }
            let speed = rate.bps as u64;
            let Some(item) = queue.items.iter_mut().find(|i| i.id == id) else { return };
            item.uploaded = uploaded;
            item.speed = speed;
            if !due {
                return;
            }
            let view = View::from(&*item);
            queue.last_progress.insert(id.to_string(), now);
            view
        };
        let _ = self.inner.app.emit("upload://changed", view);
    }

    fn save(&self, items: &[Item]) {
        // Write then rename, so a crash mid-write never leaves a broken queue file.
        let Ok(bytes) = serde_json::to_vec(items) else { return };
        let tmp = self.inner.file.with_extension("json.tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &self.inner.file);
        }
    }

    fn views(&self) -> Vec<View> {
        self.inner.queue.lock().unwrap().items.iter().map(View::from).collect()
    }

    fn stop(&self, id: &str) {
        if let Some(token) = self.inner.queue.lock().unwrap().running.get(id) {
            token.cancel();
        }
    }
}

fn new_item(path: &Path, folder_id: Option<String>, target_account_id: Option<String>) -> Option<Item> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().into_owned();
    Some(Item {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_path_buf(),
        mime_type: mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string(),
        name,
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        folder_id,
        target_account_id,
        status: Status::Queued,
        uploaded: 0,
        error: None,
        account_label: None,
        session: None,
        speed: 0,
    })
}

// ---- Commands ----

#[tauri::command]
pub async fn uploader_configure(auth: Auth, uploader: State<'_, Uploader>) -> Result<(), String> {
    uploader.api().configure(auth).await;
    // Items waiting for a sign-in can go now.
    uploader.inner.wake.notify_one();
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRequest {
    paths: Vec<String>,
    folder_id: Option<String>,
    target_account_id: Option<String>,
}

#[tauri::command]
pub fn uploader_enqueue(request: EnqueueRequest, uploader: State<'_, Uploader>) -> Vec<View> {
    let added: Vec<Item> = request.paths.iter().filter_map(|p| new_item(Path::new(p), request.folder_id.clone(), request.target_account_id.clone())).collect();
    let views = added.iter().map(View::from).collect();
    {
        let mut queue = uploader.inner.queue.lock().unwrap();
        queue.items.extend(added);
        uploader.save(&queue.items);
    }
    uploader.inner.wake.notify_one();
    views
}

#[tauri::command]
pub fn uploader_list(uploader: State<'_, Uploader>) -> Vec<View> {
    uploader.views()
}

#[tauri::command]
pub fn uploader_pause(id: String, uploader: State<'_, Uploader>) {
    let Some(item) = uploader.item(&id) else { return };
    if matches!(item.status, Status::Queued | Status::Uploading | Status::Waiting) {
        uploader.set_status(&id, Status::Paused, None);
        uploader.stop(&id);
        uploader.inner.wake.notify_one();
    }
}

#[tauri::command]
pub fn uploader_resume(id: String, uploader: State<'_, Uploader>) {
    let Some(item) = uploader.item(&id) else { return };
    if matches!(item.status, Status::Paused | Status::Error) {
        uploader.set_status(&id, Status::Queued, None);
        uploader.inner.wake.notify_one();
    }
}

#[tauri::command]
pub fn uploader_cancel(id: String, uploader: State<'_, Uploader>) {
    let Some(item) = uploader.item(&id) else { return };
    if matches!(item.status, Status::Done | Status::Cancelled) {
        return;
    }
    uploader.set_status(&id, Status::Cancelled, None);
    uploader.stop(&id);
    uploader.inner.wake.notify_one();
    // Tell the server, which aborts the S3 upload or drops the Google session.
    let session_id = match item.session {
        Some(Session::Google { session_id, .. }) | Some(Session::S3 { session_id, .. }) => Some(session_id),
        _ => None,
    };
    if let Some(session_id) = session_id {
        let api = uploader.api().clone();
        tauri::async_runtime::spawn(async move {
            let _ = api.json::<serde_json::Value>(reqwest::Method::DELETE, &format!("/uploads/resumable/{session_id}"), None).await;
        });
    }
}

/// Drops finished and cancelled items from the list (failed ones stay, so they can be retried).
#[tauri::command]
pub fn uploader_clear_finished(uploader: State<'_, Uploader>) -> Vec<View> {
    let mut queue = uploader.inner.queue.lock().unwrap();
    queue.items.retain(|i| !matches!(i.status, Status::Done | Status::Cancelled));
    uploader.save(&queue.items);
    queue.items.iter().map(View::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_round_trips_through_json() {
        let item = Item {
            id: "1".into(),
            path: PathBuf::from("/tmp/a.bin"),
            name: "a.bin".into(),
            size: 10,
            modified_ms: Some(5),
            mime_type: "application/octet-stream".into(),
            folder_id: None,
            target_account_id: Some("acc".into()),
            status: Status::Waiting,
            uploaded: 4,
            error: Some("No connection".into()),
            account_label: None,
            session: Some(Session::S3 { session_id: "s".into(), part_size: 64, part_count: 1 }),
            speed: 9,
        };
        let json = serde_json::to_string(&vec![item]).unwrap();
        assert!(json.contains("\"kind\":\"s3\"") && json.contains("\"partSize\":64") && json.contains("\"status\":\"waiting\""));
        let back: Vec<Item> = serde_json::from_str(&json).unwrap();
        assert!(matches!(back[0].session, Some(Session::S3 { part_count: 1, .. })));
    }
}
