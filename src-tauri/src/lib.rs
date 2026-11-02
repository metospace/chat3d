use tauri::Manager;
use std::io::Write;
mod export_file;
use export_file::{cancel_export_destination, commit_export_file, select_export_destination, PendingExports};

#[cfg(desktop)]
#[macro_use]
mod updater_mirror;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Fixed-purpose exports only: no caller-supplied paths and no overwrites.
#[tauri::command]
fn save_support_json(app: tauri::AppHandle, contents: String, kind: String) -> Result<String, String> {
    let (prefix, format) = match kind.as_str() {
        "diagnostics" => ("scenivo-diagnostics", "chat3d-diagnostics-v1"),
        "workspace" => ("scenivo-workspace", "chat3d-workspace-backup"),
        _ => return Err("不支持的导出类型".into()),
    };
    if contents.len() > 50 * 1024 * 1024 { return Err("导出文件超过50MB".into()); }
    let value: serde_json::Value = serde_json::from_str(&contents).map_err(|_| "导出内容不是有效JSON")?;
    if value.get("format").and_then(|v| v.as_str()) != Some(format) { return Err("导出格式不匹配".into()); }
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
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingExports::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<PendingExports>().remove_window(window.label());
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init());
    // Desktop updates are inactive until a release build supplies an https endpoint
    // and minisign public key. The private signing key stays in the build environment.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(desktop)]
    let builder = {
        use updater_mirror::{download_and_install_mirrored_update, update_download_url};
        builder.invoke_handler(tauri::generate_handler![
            greet,
            save_support_json,
            select_export_destination,
            commit_export_file,
            cancel_export_destination,
            update_download_url,
            download_and_install_mirrored_update
        ])
    };
    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet, save_support_json, select_export_destination, commit_export_file, cancel_export_destination
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
