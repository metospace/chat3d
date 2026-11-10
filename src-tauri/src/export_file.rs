use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const DESTINATION_LIFETIME: Duration = Duration::from_secs(10 * 60);
const MAX_PENDING_DESTINATIONS: usize = 16;

struct Destination {
    owner: String,
    path: PathBuf,
    selected_at: Instant,
}

#[derive(Default)]
pub(crate) struct PendingExports(Mutex<HashMap<Uuid, Destination>>);

impl PendingExports {
    fn insert(&self, owner: &str, path: PathBuf) -> Result<String, String> {
        let mut pending = self.0.lock().map_err(|e| e.to_string())?;
        pending.retain(|_, entry| entry.selected_at.elapsed() < DESTINATION_LIFETIME);
        if pending.len() >= MAX_PENDING_DESTINATIONS {
            return Err("待保存的导出过多，请先完成或取消已有导出".into());
        }
        let token = Uuid::new_v4();
        pending.insert(token, Destination { owner: owner.into(), path, selected_at: Instant::now() });
        Ok(token.to_string())
    }

    fn take(&self, owner: &str, token: &str) -> Result<PathBuf, String> {
        let token = Uuid::parse_str(token).map_err(|_| "导出目标无效或已过期")?;
        let mut pending = self.0.lock().map_err(|e| e.to_string())?;
        pending.retain(|_, entry| entry.selected_at.elapsed() < DESTINATION_LIFETIME);
        if !pending.get(&token).is_some_and(|entry| entry.owner == owner) {
            return Err("导出目标无效或已过期".into());
        }
        Ok(pending.remove(&token).unwrap().path)
    }

    fn cancel(&self, owner: &str, token: &str) -> Result<(), String> {
        // Idempotent: a failed commit has already consumed its destination.
        let token = Uuid::parse_str(token).map_err(|_| "导出目标无效")?;
        let mut pending = self.0.lock().map_err(|e| e.to_string())?;
        pending.retain(|key, entry| {
            entry.selected_at.elapsed() < DESTINATION_LIFETIME && !(*key == token && entry.owner == owner)
        });
        Ok(())
    }

    pub(crate) fn remove_window(&self, owner: &str) {
        if let Ok(mut pending) = self.0.lock() {
            pending.retain(|_, entry| entry.owner != owner && entry.selected_at.elapsed() < DESTINATION_LIFETIME);
        }
    }
}

fn export_filter(kind: &str, filename: &str) -> Result<(&'static str, &'static str), String> {
    let filter = match kind {
        "html" => ("HTML", "html"),
        "glb" => ("GLB", "glb"),
        "json" => ("JSON", "json"),
        "zip" => ("ZIP", "zip"),
        _ => return Err("不支持的导出类型".into()),
    };
    if filename.trim().is_empty()
        || filename == "."
        || filename == ".."
        || filename.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err("导出文件名必须是不含路径的有效文件名".into());
    }
    Ok(filter)
}

// Only the native picker can grant a destination. The frontend receives no writable path.
#[tauri::command]
pub(crate) async fn select_export_destination(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
    filename: String,
) -> Result<Option<String>, String> {
    let (label, extension) = export_filter(&kind, &filename)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        #[cfg(desktop)]
        let dialog = dialog.set_parent(&window);
        let selected = dialog.add_filter(label, &[extension])
            .set_file_name(filename)
            .blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        use tauri::Manager;
        app.state::<PendingExports>().insert(window.label(), path).map(Some)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_export_destination(
    window: tauri::WebviewWindow,
    pending: tauri::State<'_, PendingExports>,
    token: String,
) -> Result<(), String> {
    pending.cancel(window.label(), &token)
}

// Async commands run on Tauri's async runtime, not the UI event loop. Borrowing the raw
// request here avoids cloning a potentially huge HTML/GLB buffer just to dispatch a write.
#[tauri::command]
pub(crate) async fn commit_export_file(
    window: tauri::WebviewWindow,
    pending: tauri::State<'_, PendingExports>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let token = request.headers().get("x-export-token")
        .and_then(|value| value.to_str().ok())
        .ok_or("缺少导出目标凭据")?;
    // Consume before payload validation or IO: even a failed write cannot reuse authority.
    let path = pending.take(window.label(), token)?;
    let tauri::ipc::InvokeBody::Raw(contents) = request.body() else {
        return Err("导出内容必须使用原始字节传输".into());
    };
    write_export(&path, contents)?;
    Ok(path.to_string_lossy().into_owned())
}

fn write_export(path: &std::path::Path, contents: &[u8]) -> Result<(), String> {
    crate::atomic_export::write_export(path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destinations_are_window_bound_and_one_shot() {
        let pending = PendingExports::default();
        let token = pending.insert("main", PathBuf::from("selected.html")).unwrap();
        assert!(pending.take("other", &token).is_err());
        assert_eq!(pending.take("main", &token).unwrap(), PathBuf::from("selected.html"));
        assert!(pending.take("main", &token).is_err());
        assert!(pending.take("main", "C:\\arbitrary.html").is_err());
    }

    #[test]
    fn cancelled_expired_and_closed_destinations_cannot_write() {
        let pending = PendingExports::default();
        let cancelled = pending.insert("main", PathBuf::from("cancelled.html")).unwrap();
        pending.cancel("other", &cancelled).unwrap();
        assert_eq!(pending.0.lock().unwrap().len(), 1);
        pending.cancel("main", &cancelled).unwrap();
        pending.cancel("main", &cancelled).unwrap();
        assert!(pending.take("main", &cancelled).is_err());
        let expired = pending.insert("main", PathBuf::from("expired.html")).unwrap();
        pending.0.lock().unwrap().get_mut(&Uuid::parse_str(&expired).unwrap()).unwrap().selected_at = Instant::now() - DESTINATION_LIFETIME;
        assert!(pending.take("main", &expired).is_err());
        let closed = pending.insert("main", PathBuf::from("closed.html")).unwrap();
        pending.remove_window("main");
        assert!(pending.take("main", &closed).is_err());
        assert!(pending.0.lock().unwrap().is_empty());
    }

    #[test]
    fn only_supported_kinds_and_basenames_reach_the_picker() {
        assert!(export_filter("html", "模型.html").is_ok());
        assert!(export_filter("glb", "model.glb").is_ok());
        assert!(export_filter("json", "model.chat3d.json").is_ok());
        assert!(export_filter("exe", "model.exe").is_err());
        for filename in ["", " ", ".", "..", "../model.html", "C:\\model.html", "model\0.html", "model?.html"] {
            assert!(export_filter("html", filename).is_err());
        }
    }

    #[test]
    fn writes_preserve_utf8_and_binary_bytes_and_report_io_errors() {
        let path = std::env::temp_dir().join(format!("scenivo-export-test-{}", Uuid::new_v4()));
        let html = "<html>中文</html>".as_bytes();
        write_export(&path, html).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), html);
        write_export(&path, &[0, 255, 1]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), [0, 255, 1]);
        std::fs::remove_file(&path).unwrap();
        assert!(write_export(&path.join("missing").join("file.html"), html).is_err());
    }
}
