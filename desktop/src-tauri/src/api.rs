//! Calls to the 9Drive backend with the user's session. The web side hands over the tokens
//! (`uploader_configure`); when the server answers 401 the access token is refreshed here and passed
//! back to the web side (`auth://token`), so both keep working with the same session.

use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

/// How a failed step should be handled by whoever drives the transfer.
#[derive(Debug, Clone)]
pub enum Failure {
    /// Temporary (offline, 5xx, 429, signed out): wait and try again.
    Retry(String),
    /// The upload session is gone (expired, aborted): start over with a new one.
    Restart(String),
    /// Retrying won't help (rejected, file changed): stop with this message.
    Fatal(String),
}

impl Failure {
    pub fn message(&self) -> &str {
        match self {
            Failure::Retry(m) | Failure::Restart(m) | Failure::Fatal(m) => m,
        }
    }
}

pub fn network_failure(error: reqwest::Error) -> Failure {
    Failure::Retry(if error.is_connect() || error.is_timeout() { "No connection".into() } else { format!("Network error: {error}") })
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    pub api_url: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

#[derive(Clone)]
pub struct Api {
    inner: Arc<Inner>,
}

struct Inner {
    app: AppHandle,
    http: Client,
    auth: RwLock<Auth>,
    refreshing: Mutex<()>,
}

#[derive(Deserialize)]
struct ErrorBody {
    message: Option<String>,
}

impl Api {
    pub fn new(app: AppHandle) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .tcp_keepalive(Duration::from_secs(60))
            .user_agent(concat!("9Drive-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        Api { inner: Arc::new(Inner { app, http, auth: RwLock::new(Auth::default()), refreshing: Mutex::new(()) }) }
    }

    /// For requests that carry no 9Drive session (Google session URIs, S3 presigned URLs).
    pub fn http(&self) -> &Client {
        &self.inner.http
    }

    pub async fn configure(&self, auth: Auth) {
        *self.inner.auth.write().await = auth;
    }

    pub async fn is_signed_in(&self) -> bool {
        let auth = self.inner.auth.read().await;
        !auth.api_url.is_empty() && auth.access_token.is_some()
    }

    /// Sends a request built by `build(client, api_url, access_token)`, refreshing the access token
    /// once on 401. `build` runs again for the retry, so it must create a fresh request (and body).
    pub async fn send<F>(&self, build: F) -> Result<Response, Failure>
    where
        F: Fn(&Client, &str, &str) -> Result<RequestBuilder, Failure>,
    {
        let (api_url, token) = {
            let auth = self.inner.auth.read().await;
            match (&auth.access_token, auth.api_url.is_empty()) {
                (Some(token), false) => (auth.api_url.clone(), token.clone()),
                _ => return Err(Failure::Retry("Sign in to 9Drive to continue".into())),
            }
        };
        let response = build(&self.inner.http, &api_url, &token)?.send().await.map_err(network_failure)?;
        if response.status() != StatusCode::UNAUTHORIZED {
            return Ok(response);
        }
        let token = self.refresh(&token).await?;
        let response = build(&self.inner.http, &api_url, &token)?.send().await.map_err(network_failure)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(Failure::Retry("Sign in to 9Drive again to continue".into()));
        }
        Ok(response)
    }

    /// A JSON request; a non-2xx answer becomes a Failure with the server's message.
    pub async fn json<T: DeserializeOwned>(&self, method: reqwest::Method, path: &str, body: Option<serde_json::Value>) -> Result<T, Failure> {
        let response = self
            .send(|client, base, token| {
                let request = client.request(method.clone(), format!("{base}{path}")).bearer_auth(token);
                Ok(match &body {
                    Some(body) => request.json(body),
                    None => request,
                })
            })
            .await?;
        let status = response.status();
        if status.is_success() {
            return response.json::<T>().await.map_err(|e| Failure::Retry(format!("Unexpected answer from 9Drive: {e}")));
        }
        Err(failure_from_response(response).await)
    }

    async fn refresh(&self, stale_token: &str) -> Result<String, Failure> {
        let _guard = self.inner.refreshing.lock().await;
        // Someone else refreshed while we waited.
        {
            let auth = self.inner.auth.read().await;
            if let Some(current) = &auth.access_token {
                if current != stale_token {
                    return Ok(current.clone());
                }
            }
        }
        let (api_url, refresh_token) = {
            let auth = self.inner.auth.read().await;
            match &auth.refresh_token {
                Some(refresh) => (auth.api_url.clone(), refresh.clone()),
                None => return Err(Failure::Retry("Sign in to 9Drive again to continue".into())),
            }
        };
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Refreshed {
            access_token: String,
        }
        let response = self
            .inner
            .http
            .post(format!("{api_url}/auth/refresh"))
            .json(&serde_json::json!({ "refreshToken": refresh_token }))
            .send()
            .await
            .map_err(network_failure)?;
        if !response.status().is_success() {
            return Err(Failure::Retry("Sign in to 9Drive again to continue".into()));
        }
        let refreshed: Refreshed = response.json().await.map_err(|e| Failure::Retry(format!("Unexpected answer from 9Drive: {e}")))?;
        self.inner.auth.write().await.access_token = Some(refreshed.access_token.clone());
        let _ = self.inner.app.emit("auth://token", serde_json::json!({ "accessToken": refreshed.access_token }));
        Ok(refreshed.access_token)
    }
}

/// Maps a backend error response to a Failure: 5xx/429 are temporary, the rest are final.
pub async fn failure_from_response(response: Response) -> Failure {
    let status = response.status();
    let message = response
        .json::<ErrorBody>()
        .await
        .ok()
        .and_then(|b| b.message)
        .unwrap_or_else(|| format!("9Drive answered {status}"));
    if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
        Failure::Retry(message)
    } else {
        Failure::Fatal(message)
    }
}
