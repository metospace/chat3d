use tauri::Manager;
use std::io::Write;
mod export_file;
mod atomic_export;
use export_file::{cancel_export_destination, commit_export_file, select_export_destination, PendingExports};
#[cfg(desktop)]
mod blender;
#[cfg(desktop)]
mod team_publish;

#[cfg(desktop)]
#[macro_use]
mod updater_mirror;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

mod support_json;
use support_json::check_support_size;
// Fixed-purpose exports only: no caller-supplied paths and no overwrites.
#[tauri::command]
async fn save_support_json(app: tauri::AppHandle, contents: String, kind: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let (prefix, format) = match kind.as_str() {
        "diagnostics" => ("scenivo-diagnostics", "chat3d-diagnostics-v1"),
        "workspace" => ("scenivo-workspace", "chat3d-workspace-backup"),
        _ => return Err("不支持的导出类型".into()),
    };
    check_support_size(&kind, contents.len())?;
    let value: serde_json::Value = serde_json::from_str(&contents).map_err(|_| "导出内容不是有效JSON")?;
    let actual_format = value.get("format").and_then(|v| v.as_str());
    if actual_format != Some(format) && !(kind == "diagnostics" && matches!(actual_format, Some("chat3d-full-diagnostics-v1" | "chat3d-diagnostics-v2"))) { return Err("导出格式不匹配".into()); }
    let directory = app.path().download_dir().map_err(|e| e.to_string())?.join("Scenivo");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
    for suffix in 0..100 {
        let path = directory.join(format!("{prefix}-{stamp}-{suffix}.json"));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(contents.as_bytes()).and_then(|_| file.sync_all()) {
                    drop(file); let _ = std::fs::remove_file(&path); return Err(e.to_string());
                }
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("未能创建唯一文件名，请稍后重试".into())
    }).await.map_err(|e| e.to_string())?
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingExports::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<PendingExports>().remove_window(window.label());
                #[cfg(desktop)]
                window.state::<blender::BlenderState>().remove_window(window.label());
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init());
    // Desktop updates are inactive until a release build supplies an https endpoint
    // and minisign public key. The private signing key stays in the build environment.
    #[cfg(desktop)]
    let builder = builder
        .manage(blender::BlenderState::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(desktop)]
    let builder = {
        use updater_mirror::{download_and_install_mirrored_update, update_download_url};
        use blender::{desktop_blender_cancel, desktop_blender_connect, desktop_blender_run, desktop_blender_status};
        use team_publish::desktop_team_publish;
        builder.invoke_handler(tauri::generate_handler![
            greet,
            save_support_json,
            select_export_destination,
            commit_export_file,
            cancel_export_destination,
            update_download_url,
            download_and_install_mirrored_update,
            desktop_team_publish,
            desktop_blender_status,
            desktop_blender_connect,
            desktop_blender_run,
            desktop_blender_cancel
        ])
    };
    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet, save_support_json, select_export_destination, commit_export_file, cancel_export_destination
    ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_app, event| {
        #[cfg(desktop)]
        if matches!(event, tauri::RunEvent::Exit) {
            _app.state::<blender::BlenderState>().shutdown();
        }
    });
}
