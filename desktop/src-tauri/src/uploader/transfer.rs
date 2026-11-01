//! Moving one file's bytes. The server opens the session (`/uploads/resumable/init` with
//! `direct: true`) and records the file at the end; the bytes go straight from disk to Google Drive
//! (resumable session URI) or S3 (presigned part URLs), never through the 9Drive server.

use super::{Item, Session, Uploader};
use crate::api::{failure_from_response, network_failure, Failure};
use crate::files::modified_ms;
use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, ETAG};
use reqwest::{Body, Method};
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::io::SeekFrom;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

/// Google needs multiples of 256 KiB; 64 MiB keeps requests few without making a lost chunk costly.
const GOOGLE_CHUNK: u64 = 64 * 1024 * 1024;
const S3_URL_BATCH: usize = 20;

pub async fn upload(uploader: &Uploader, id: &str) -> Result<(), Failure> {
    let item = uploader.item(id).ok_or_else(|| Failure::Fatal("Upload not found".into()))?;
    let meta = tokio::fs::metadata(&item.path).await.map_err(|e| Failure::Fatal(format!("Can't read the file: {e}")))?;
    if meta.len() != item.size || modified_ms(&meta) != item.modified_ms {
        return Err(Failure::Fatal("The file changed since the upload started. Upload it again.".into()));
    }
    if !uploader.api().is_signed_in().await {
        return Err(Failure::Retry("Sign in to 9Drive to continue".into()));
    }

    let session = match item.session.clone() {
        Some(session) => session,
        None => {
            let (session, label) = init(uploader, &item).await?;
            uploader.update(id, |i| {
                i.session = Some(session.clone());
                i.account_label = label;
            });
            session
        }
    };
    match session {
        Session::Google { session_id, upload_url } => google(uploader, &item, &session_id, &upload_url).await,
        Session::S3 { session_id, part_size, part_count } => s3(uploader, &item, &session_id, part_size, part_count).await,
        Session::Server { account_id } => through_server(uploader, &item, &account_id).await,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitResponse {
    provider: String,
    direct: Option<bool>,
    session_id: Option<String>,
    upload_url: Option<String>,
    part_size: Option<u64>,
    part_count: Option<u32>,
    account_id: Option<String>,
    account_label: Option<String>,
}

async fn init(uploader: &Uploader, item: &Item) -> Result<(Session, Option<String>), Failure> {
    let body = json!({
        "fileName": item.name,
        "mimeType": item.mime_type,
        "sizeBytes": item.size.to_string(),
        "folderId": item.folder_id,
        "targetAccountId": item.target_account_id,
        "direct": true,
    });
    let init: InitResponse = uploader.api().json(Method::POST, "/uploads/resumable/init", Some(body)).await?;
    let unexpected = || Failure::Fatal("The server is too old for desktop uploads. Update 9Drive in Settings.".into());
    let session = match (init.provider.as_str(), init.direct.unwrap_or(false)) {
        ("google_drive", true) => Session::Google { session_id: init.session_id.ok_or_else(unexpected)?, upload_url: init.upload_url.ok_or_else(unexpected)? },
        ("s3", true) => Session::S3 { session_id: init.session_id.ok_or_else(unexpected)?, part_size: init.part_size.ok_or_else(unexpected)?, part_count: init.part_count.ok_or_else(unexpected)? },
        ("s3", false) => Session::Server { account_id: init.account_id.ok_or_else(unexpected)? },
        _ => return Err(unexpected()),
    };
    Ok((session, init.account_label))
}

/// `len` bytes of the file from `start`, streamed from disk. Reports `base + bytes read` as progress.
async fn file_body(uploader: &Uploader, item: &Item, start: u64, len: u64, base: u64) -> Result<Body, Failure> {
    let mut file = tokio::fs::File::open(&item.path).await.map_err(|e| Failure::Fatal(format!("Can't read the file: {e}")))?;
    file.seek(SeekFrom::Start(start)).await.map_err(|e| Failure::Fatal(format!("Can't read the file: {e}")))?;
    let sent = Arc::new(AtomicU64::new(0));
    let (uploader, id) = (uploader.clone(), item.id.clone());
    let stream = ReaderStream::with_capacity(file.take(len), 256 * 1024).map(move |chunk| {
        if let Ok(bytes) = &chunk {
            let total = sent.fetch_add(bytes.len() as u64, Ordering::Relaxed) + bytes.len() as u64;
            uploader.progress(&id, base + total);
        }
        chunk
    });
    Ok(Body::wrap_stream(stream))
}

// ---- Google Drive: resumable session ----

/// Next byte Google wants, from the `Range: bytes=0-N` header of a 308 (none means nothing stored yet).
pub fn next_offset_from_range(range: Option<&str>) -> u64 {
    range
        .and_then(|r| r.trim().strip_prefix("bytes="))
        .and_then(|r| r.split('-').nth(1))
        .and_then(|end| end.trim().parse::<u64>().ok())
        .map_or(0, |end| end + 1)
}

/// Where the session stands: Some(next byte), or None when Google already has the whole file.
async fn google_offset(uploader: &Uploader, url: &str, size: u64) -> Result<Option<u64>, Failure> {
    let response = uploader.api().http().put(url).header(CONTENT_RANGE, format!("bytes */{size}")).header(CONTENT_LENGTH, 0).send().await.map_err(network_failure)?;
    google_answer(response.status().as_u16(), response.headers().get("range").and_then(|v| v.to_str().ok()))
}

fn google_answer(status: u16, range: Option<&str>) -> Result<Option<u64>, Failure> {
    match status {
        308 => Ok(Some(next_offset_from_range(range))),
        200 | 201 => Ok(None),
        404 | 410 => Err(Failure::Restart("The upload session expired; starting again".into())),
        429 | 500..=599 => Err(Failure::Retry(format!("Google Drive is busy ({status})"))),
        _ => Err(Failure::Fatal(format!("Google Drive refused the upload ({status})"))),
    }
}

async fn google(uploader: &Uploader, item: &Item, session_id: &str, url: &str) -> Result<(), Failure> {
    let mut offset = google_offset(uploader, url, item.size).await?;
    while let Some(start) = offset {
        uploader.progress(&item.id, start);
        let len = GOOGLE_CHUNK.min(item.size - start);
        let body = file_body(uploader, item, start, len, start).await?;
        let response = uploader
            .api()
            .http()
            .put(url)
            .header(CONTENT_RANGE, format!("bytes {}-{}/{}", start, start + len - 1, item.size))
            .header(CONTENT_LENGTH, len)
            .body(body)
            .send()
            .await
            .map_err(network_failure)?;
        offset = google_answer(response.status().as_u16(), response.headers().get("range").and_then(|v| v.to_str().ok()))?;
    }
    // Google has every byte; the server checks with Google and records the file.
    #[derive(Deserialize)]
    struct Status {
        status: String,
    }
    let status: Status = uploader.api().json(Method::GET, &format!("/uploads/resumable/status/{session_id}"), None).await?;
    match status.status.as_str() {
        "completed" => Ok(()),
        _ => Err(Failure::Retry("Waiting for 9Drive to record the file".into())),
    }
}

// ---- S3: multipart upload with presigned part URLs ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListedPart {
    part_number: u32,
    etag: String,
    size: u64,
}

pub fn part_len(size: u64, part_size: u64, part_number: u32) -> u64 {
    let start = (part_number as u64 - 1) * part_size;
    part_size.min(size.saturating_sub(start))
}

async fn s3(uploader: &Uploader, item: &Item, session_id: &str, part_size: u64, part_count: u32) -> Result<(), Failure> {
    let api = uploader.api();
    #[derive(Deserialize)]
    struct Parts {
        status: String,
        parts: Vec<ListedPart>,
    }
    let listed: Parts = match api.json(Method::GET, &format!("/uploads/s3/{session_id}/parts"), None).await {
        Err(Failure::Fatal(message)) => return Err(Failure::Restart(message)),   // session gone
        other => other?,
    };
    if listed.status == "completed" {
        return Ok(());
    }
    // Parts S3 already has in full (by part number), so a resumed upload skips them.
    let mut done: BTreeMap<u32, String> = listed
        .parts
        .into_iter()
        .filter(|p| p.part_number >= 1 && p.part_number <= part_count && p.size == part_len(item.size, part_size, p.part_number))
        .map(|p| (p.part_number, p.etag))
        .collect();
    let mut uploaded: u64 = done.keys().map(|&n| part_len(item.size, part_size, n)).sum();
    uploader.progress(&item.id, uploaded);

    let missing: Vec<u32> = (1..=part_count).filter(|n| !done.contains_key(n)).collect();
    for batch in missing.chunks(S3_URL_BATCH) {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct PartUrl {
            part_number: u32,
            url: String,
        }
        #[derive(Deserialize)]
        struct Urls {
            urls: Vec<PartUrl>,
        }
        let urls: Urls = api.json(Method::POST, &format!("/uploads/s3/{session_id}/part-urls"), Some(json!({ "partNumbers": batch }))).await?;
        for part in urls.urls {
            let start = (part.part_number as u64 - 1) * part_size;
            let len = part_len(item.size, part_size, part.part_number);
            let body = file_body(uploader, item, start, len, uploaded).await?;
            let response = api.http().put(&part.url).header(CONTENT_LENGTH, len).body(body).send().await.map_err(network_failure)?;
            let status = response.status().as_u16();
            match status {
                200..=299 => {
                    let etag = response.headers().get(ETAG).and_then(|v| v.to_str().ok()).map(str::to_string);
                    let Some(etag) = etag else {
                        return Err(Failure::Fatal("The bucket did not confirm the part (no ETag).".into()));
                    };
                    done.insert(part.part_number, etag);
                    uploaded += len;
                    uploader.progress(&item.id, uploaded);
                }
                403 => return Err(Failure::Retry("The upload link expired; getting a new one".into())),
                404 => return Err(Failure::Restart("The upload was aborted; starting again".into())),
                429 | 500..=599 => return Err(Failure::Retry(format!("The bucket is busy ({status})"))),
                _ => return Err(Failure::Fatal(format!("The bucket refused the upload ({status})"))),
            }
        }
    }

    let parts: Vec<_> = done.iter().map(|(n, etag)| json!({ "partNumber": n, "etag": etag })).collect();
    let response = api
        .send(|client, base, token| Ok(client.post(format!("{base}/uploads/s3/{session_id}/complete")).bearer_auth(token).json(&json!({ "parts": parts }))))
        .await?;
    match response.status().as_u16() {
        200 | 201 => Ok(()),
        409 => Err(Failure::Retry("Finishing the upload".into())),
        _ => Err(failure_from_response(response).await),
    }
}

// ---- Through the server (bucket only the server can reach) ----

async fn through_server(uploader: &Uploader, item: &Item, account_id: &str) -> Result<(), Failure> {
    let path = item.path.clone();
    let response = uploader
        .api()
        .send(|client, base, token| {
            let file = std::fs::File::open(Path::new(&path)).map_err(|e| Failure::Fatal(format!("Can't read the file: {e}")))?;
            let (progress, id, sent) = (uploader.clone(), item.id.clone(), Arc::new(AtomicU64::new(0)));
            let stream = ReaderStream::with_capacity(tokio::fs::File::from_std(file), 256 * 1024).map(move |chunk| {
                if let Ok(bytes) = &chunk {
                    progress.progress(&id, sent.fetch_add(bytes.len() as u64, Ordering::Relaxed) + bytes.len() as u64);
                }
                chunk
            });
            let part = reqwest::multipart::Part::stream_with_length(Body::wrap_stream(stream), item.size)
                .file_name(item.name.clone())
                .mime_str(&item.mime_type)
                .map_err(|e| Failure::Fatal(e.to_string()))?;
            let mut form = reqwest::multipart::Form::new()
                .text("sizeBytes", item.size.to_string())
                .text("fileName", item.name.clone())
                .text("mimeType", item.mime_type.clone())
                .text("targetAccountId", account_id.to_string());
            if let Some(folder_id) = &item.folder_id {
                form = form.text("folderId", folder_id.clone());
            }
            Ok(client.post(format!("{base}/uploads")).bearer_auth(token).multipart(form.part("file", part)))
        })
        .await?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(failure_from_response(response).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_header_gives_next_offset() {
        assert_eq!(next_offset_from_range(Some("bytes=0-262143")), 262144);
        assert_eq!(next_offset_from_range(Some("bytes=0-0")), 1);
        assert_eq!(next_offset_from_range(None), 0);
        assert_eq!(next_offset_from_range(Some("garbage")), 0);
    }

    #[test]
    fn google_statuses_map_to_actions() {
        assert!(matches!(google_answer(308, Some("bytes=0-9")), Ok(Some(10))));
        assert!(matches!(google_answer(200, None), Ok(None)));
        assert!(matches!(google_answer(404, None), Err(Failure::Restart(_))));
        assert!(matches!(google_answer(503, None), Err(Failure::Retry(_))));
        assert!(matches!(google_answer(400, None), Err(Failure::Fatal(_))));
    }

    #[test]
    fn last_part_is_the_remainder() {
        let mib = 1024 * 1024;
        assert_eq!(part_len(100 * mib, 64 * mib, 1), 64 * mib);
        assert_eq!(part_len(100 * mib, 64 * mib, 2), 36 * mib);
        assert_eq!(part_len(64 * mib, 64 * mib, 1), 64 * mib);
    }
}
