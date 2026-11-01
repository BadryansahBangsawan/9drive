//! 9Drive desktop app: the web UI (frontend/, built with `--mode desktop`) in a Tauri window, plus
//! native uploads (uploader/) and downloads (download.rs) that stream to and from disk.

mod api;
mod download;
mod files;
mod uploader;

use tauri::{Emitter, Manager, WindowEvent};

pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // A second launch (or a ninedrive:// link on Windows/Linux) goes to the running window.
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // macOS registers the scheme from the bundle; Windows/Linux need it at runtime in dev.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            // Debug builds open the web inspector, to see console errors.
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let api = api::Api::new(app.handle().clone());
            let uploader = uploader::Uploader::load(app.handle().clone(), api.clone(), data_dir.join("uploads.json"));
            app.manage(api);
            app.manage(download::Downloads::default());
            app.manage(uploader.clone());
            uploader.start();
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing with uploads running asks first (the web side shows the dialog).
            if let WindowEvent::CloseRequested { api, .. } = event {
                let active = window.state::<uploader::Uploader>().active_count();
                if active > 0 {
                    api.prevent_close();
                    let _ = window.emit("app://close-requested", serde_json::json!({ "active": active }));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            uploader::uploader_configure,
            uploader::uploader_enqueue,
            uploader::uploader_list,
            uploader::uploader_pause,
            uploader::uploader_resume,
            uploader::uploader_cancel,
            uploader::uploader_clear_finished,
            download::download_start,
            download::download_cancel,
            files::inspect_paths,
            files::server_info,
            app_exit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 9Drive");
}

#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    app.exit(0);
}
