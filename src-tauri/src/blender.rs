use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdout, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

const RUNNER: &str = include_str!("../../server/blender/python-runner.py");
const SCRIPT_LIMIT: usize = 256 * 1024;
const LOG_LIMIT: usize = 1024 * 1024;
const ARTIFACT_LIMITS: [usize; 3] = [32 * 1024 * 1024, 20 * 1024 * 1024, 8 * 1024 * 1024];
const JOB_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(15);
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_CANCELLED_REQUESTS: usize = 256;

#[derive(serde::Serialize)]
pub(crate) struct BlenderExecutionProgress {
    stage: &'static str,
    message: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExecutionStage { Starting, Executing, Saving, Exporting, Rendering, Reading, Completed }

impl ExecutionStage {
    fn progress(self) -> BlenderExecutionProgress {
        let (stage, message) = match self {
            Self::Starting => ("starting", "正在启动 Blender"),
            Self::Executing => ("executing", "正在执行 Blender 脚本"),
            Self::Saving => ("saving", "正在保存 Blender 工程"),
            Self::Exporting => ("exporting", "正在导出 GLB 模型"),
            Self::Rendering => ("rendering", "正在渲染预览"),
            Self::Reading => ("reading", "正在读取并校验 Blender 产物"),
            Self::Completed => ("completed", "Blender 执行完成"),
        };
        BlenderExecutionProgress { stage, message }
    }
}

type ProgressCallback<'a> = Option<&'a dyn Fn(ExecutionStage)>;

fn report_progress(progress: ProgressCallback<'_>, stage: ExecutionStage) {
    if let Some(progress) = progress { progress(stage); }
}

struct StageParser {
    line: [u8; 64],
    length: usize,
}

impl Default for StageParser {
    fn default() -> Self { Self { line: [0; 64], length: 0 } }
}

impl StageParser {
    fn push(&mut self, bytes: &[u8], progress: ProgressCallback<'_>) {
        for &byte in bytes {
            if byte == b'\n' {
                if self.length <= self.line.len() {
                    let mut line = &self.line[..self.length];
                    if line.last() == Some(&b'\r') { line = &line[..line.len() - 1]; }
                    // Fixed phase telemetry only; never forward arbitrary script output.
                    let stage = match line {
                        b"@@SCENIVO_BLENDER_STAGE@@executing" => Some(ExecutionStage::Executing),
                        b"@@SCENIVO_BLENDER_STAGE@@saving" => Some(ExecutionStage::Saving),
                        b"@@SCENIVO_BLENDER_STAGE@@exporting" => Some(ExecutionStage::Exporting),
                        b"@@SCENIVO_BLENDER_STAGE@@rendering" => Some(ExecutionStage::Rendering),
                        _ => None,
                    };
                    if let Some(stage) = stage { report_progress(progress, stage); }
                }
                self.length = 0;
            } else if self.length < self.line.len() {
                self.line[self.length] = byte;
                self.length += 1;
            } else {
                self.length = self.line.len() + 1;
            }
        }
    }
}

#[derive(serde::Serialize)]
pub(crate) struct BlenderStatus {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl BlenderStatus {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self { available: false, reason: Some(reason.into()) }
    }

    fn ready() -> Self {
        Self { available: true, reason: None }
    }
}

#[derive(Default)]
struct Session {
    // Consent is deliberately in memory, never read from environment or configuration.
    consented_owner: Option<String>,
    executable: Option<PathBuf>,
    connecting: Option<Uuid>,
    active: Option<Arc<Job>>,
    cancelled_requests: HashSet<(String, Uuid)>,
    shutting_down: bool,
}

#[derive(Default)]
pub(crate) struct BlenderState(Arc<Mutex<Session>>);

struct Job {
    request_id: Uuid,
    owner: String,
    started: Instant,
    timeout: Duration,
    cancelled: AtomicBool,
    resources: Mutex<JobResources>,
}

#[derive(Default)]
struct JobResources {
    child: Option<ReapedChild>,
    directory: Option<JobDirectory>,
}

impl Job {
    fn new(request_id: Uuid, owner: &str) -> Self {
        Self {
            request_id,
            owner: owner.into(),
            started: Instant::now(),
            timeout: JOB_TIMEOUT,
            cancelled: AtomicBool::new(false),
            resources: Mutex::new(JobResources::default()),
        }
    }

    fn check_running(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("Blender 任务已取消".into())
        } else if self.started.elapsed() >= self.timeout {
            Err(format!("Blender 任务超过 {} 秒时限", self.timeout.as_secs()))
        } else {
            Ok(())
        }
    }

    fn stop(&self) {
        // Set before taking the process lock: cancellation also covers a reserved job
        // whose blocking worker has not started, or is just entering spawn().
        self.cancelled.store(true, Ordering::Release);
        self.cleanup();
    }

    fn cleanup(&self) {
        let mut resources = self.resources.lock().unwrap_or_else(|e| e.into_inner());
        // Reap before removing files, particularly important on Windows.
        resources.child.take();
        resources.directory.take();
    }
}

impl BlenderState {
    fn reserve(&self, owner: &str, request_id: Uuid) -> Result<(Arc<Job>, PathBuf), String> {
        let mut session = self.0.lock().map_err(|e| e.to_string())?;
        if session.shutting_down || session.consented_owner.as_deref() != Some(owner) {
            return Err("请先点击连接 Blender，并在原生窗口中授权本次会话".into());
        }
        if session.cancelled_requests.len() >= MAX_CANCELLED_REQUESTS
            || session.cancelled_requests.contains(&(owner.into(), request_id)) {
            return Err("Blender 任务已取消；取消记录已满时请重新打开应用".into());
        }
        if session.active.is_some() {
            return Err("Blender 正在执行另一个任务".into());
        }
        let executable = session.executable.as_ref()
            .and_then(|path| executable_file(path))
            .ok_or("Blender 可执行文件已不可用，请重新连接")?;
        let job = Arc::new(Job::new(request_id, owner));
        session.active = Some(job.clone());
        Ok((job, executable))
    }

    fn cancel(&self, owner: &str, request_id: Uuid) {
        let job = {
            let mut session = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if session.cancelled_requests.len() < MAX_CANCELLED_REQUESTS {
                session.cancelled_requests.insert((owner.into(), request_id));
            }
            session.active.as_ref()
                .filter(|job| job.owner == owner && job.request_id == request_id).cloned()
        };
        if let Some(job) = job { job.stop(); }
    }

    pub(crate) fn remove_window(&self, owner: &str) {
        let job = {
            let mut session = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if session.consented_owner.as_deref() == Some(owner) {
                session.consented_owner = None;
            }
            // Only the main local window can start a connection attempt.
            if owner == "main" { session.connecting = None; }
            session.cancelled_requests.retain(|(window, _)| window != owner);
            session.active.as_ref().filter(|job| job.owner == owner).cloned()
        };
        if let Some(job) = job { job.stop(); }
    }

    pub(crate) fn shutdown(&self) {
        let job = {
            let mut session = self.0.lock().unwrap_or_else(|e| e.into_inner());
            session.shutting_down = true;
            session.consented_owner = None;
            session.connecting = None;
            session.cancelled_requests.clear();
            session.active.clone()
        };
        if let Some(job) = job { job.stop(); }
    }
}

impl Drop for BlenderState {
    fn drop(&mut self) { self.shutdown(); }
}

// std::process::Child does not kill on drop. Keep that guarantee explicit on
// cancellation, errors, panic unwinding, window destruction and application exit.
struct ReapedChild(Child);

impl Drop for ReapedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct JobDirectory(PathBuf);

impl JobDirectory {
    fn create() -> Result<Self, String> {
        let directory = std::env::temp_dir().join(format!("scenivo-blender-{}", Uuid::new_v4()));
        fs::create_dir(&directory).map_err(|e| format!("无法创建 Blender 临时目录: {e}"))?;
        Ok(Self(directory))
    }
}

impl Drop for JobDirectory {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

struct Reservation {
    state: Arc<Mutex<Session>>,
    job: Arc<Job>,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        self.job.cleanup();
        let mut session = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if session.active.as_ref().is_some_and(|active| Arc::ptr_eq(active, &self.job)) {
            session.active = None;
        }
    }
}

struct ConnectionAttempt {
    app: tauri::AppHandle,
    token: Uuid,
}

impl Drop for ConnectionAttempt {
    fn drop(&mut self) {
        let state = self.app.state::<BlenderState>();
        let mut session = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if session.connecting == Some(self.token) { session.connecting = None; }
    }
}

fn trusted_origin(url: &url::Url, development: bool) -> bool {
    if !url.username().is_empty() || url.password().is_some() { return false; }
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) => true,
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("http", Some("localhost"), Some(1420)) if development => true,
        _ => false,
    }
}

fn check_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main" || !trusted_origin(&url, cfg!(debug_assertions)) {
        return Err("Blender 仅允许本地主窗口调用".into());
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExecutableConfig {
    executable: PathBuf,
}

fn executable_file(path: &Path) -> Option<PathBuf> {
    let path = fs::canonicalize(path).ok()?;
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() { return None; }
    #[cfg(windows)]
    if !path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("exe")) {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 { return None; }
    }
    Some(path)
}

fn on_path(name: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .filter(|directory| directory.is_absolute())
            .find_map(|directory| executable_file(&directory.join(name)))
    })
}

fn discover_executable(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("BLENDER_EXECUTABLE") {
        let path = PathBuf::from(&configured);
        let executable = if path.is_absolute() || path.components().count() > 1 {
            executable_file(&path)
        } else {
            on_path(&configured)
        };
        if executable.is_some() { return executable; }
    }
    if let Ok(directory) = app.path().app_config_dir() {
        if let Ok(file) = File::open(directory.join("blender-executable.json")) {
            let mut contents = Vec::new();
            if file.take(16 * 1024).read_to_end(&mut contents).is_ok() {
                if let Ok(config) = serde_json::from_slice::<ExecutableConfig>(&contents) {
                    if let Some(path) = executable_file(&config.executable) { return Some(path); }
                }
            }
        }
    }
    let name = if cfg!(windows) { "blender.exe" } else { "blender" };
    if let Some(path) = on_path(std::ffi::OsStr::new(name)) { return Some(path); }
    #[cfg(windows)]
    for root in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(root) {
            if let Ok(entries) = fs::read_dir(PathBuf::from(root).join("Blender Foundation")) {
                let mut candidates: Vec<PathBuf> = entries.filter_map(Result::ok)
                    .map(|entry| entry.path().join("blender.exe")).collect();
                candidates.sort();
                for candidate in candidates.into_iter().rev() {
                    if let Some(path) = executable_file(&candidate) { return Some(path); }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(path) = executable_file(Path::new("/Applications/Blender.app/Contents/MacOS/Blender")) {
        return Some(path);
    }
    None
}

fn save_selected_executable(app: &tauri::AppHandle, executable: &Path) -> Result<(), String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let config = ExecutableConfig { executable: executable.to_owned() };
    let contents = serde_json::to_vec(&config).map_err(|e| e.to_string())?;
    fs::write(directory.join("blender-executable.json"), contents)
        .map_err(|e| format!("无法保存 Blender 可执行文件位置: {e}"))
}

#[tauri::command]
pub(crate) async fn desktop_blender_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<BlenderStatus, String> {
    check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        check_window(&window)?;
        let state = app.state::<BlenderState>();
        let session = state.0.lock().map_err(|e| e.to_string())?;
        if session.shutting_down { return Ok(BlenderStatus::unavailable("应用正在退出")); }
        let executable = session.executable.as_ref().and_then(|path| executable_file(path))
            .or_else(|| discover_executable(&app));
        if executable.is_none() {
            Ok(BlenderStatus::unavailable("未找到 Blender；点击连接以选择 Blender 可执行文件"))
        } else if session.consented_owner.as_deref() != Some(window.label())
            || session.executable.as_ref().and_then(|path| executable_file(path)).is_none() {
            Ok(BlenderStatus::unavailable("点击连接 Blender，并授权本次应用会话执行可信 Python"))
        } else {
            Ok(BlenderStatus::ready())
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn desktop_blender_connect(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<BlenderStatus, String> {
    check_window(&window)?;
    let token = Uuid::new_v4();
    {
        let state = app.state::<BlenderState>();
        let mut session = state.0.lock().map_err(|e| e.to_string())?;
        if session.shutting_down { return Err("应用正在退出".into()); }
        if session.connecting.is_some() { return Err("Blender 连接窗口已打开".into()); }
        if session.active.is_some() { return Err("Blender 正在执行另一个任务".into()); }
        session.connecting = Some(token);
    }
    let attempt = ConnectionAttempt { app: app.clone(), token };
    tauri::async_runtime::spawn_blocking(move || {
        let _attempt = attempt;
        check_window(&window)?;
        let consented = {
            let state = app.state::<BlenderState>();
            let session = state.0.lock().map_err(|e| e.to_string())?;
            if session.shutting_down || session.connecting != Some(token) {
                return Err("Blender 连接已取消".into());
            }
            session.consented_owner.as_deref() == Some(window.label())
        };
        if !consented {
            let allowed = app.dialog().message(
                "Blender 将在此电脑上执行生成的 Python。Python 可以读取、修改和删除您的文件，访问网络，启动其他进程，并拥有当前用户的权限。\n\n这不是操作系统沙箱。仅对您信任的模型、脚本和输入授权。授权仅在本次应用会话内有效，可关闭应用撤销。是否允许？"
            ).title("允许 Blender 执行可信 Python？")
                .parent(&window)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("允许本次会话".into(), "取消".into()))
                .blocking_show();
            check_window(&window)?;
            let state = app.state::<BlenderState>();
            let mut session = state.0.lock().map_err(|e| e.to_string())?;
            if session.shutting_down || session.connecting != Some(token) {
                return Err("Blender 连接已取消".into());
            }
            if !allowed { return Ok(BlenderStatus::unavailable("未授权 Blender Python 执行")); }
            session.consented_owner = Some(window.label().into());
        }
        let mut executable = {
            let state = app.state::<BlenderState>();
            let session = state.0.lock().map_err(|e| e.to_string())?;
            session.executable.as_ref().and_then(|path| executable_file(path))
        }.or_else(|| discover_executable(&app));
        if let Some(path) = executable.as_ref() {
            if probe_executable(&app, &window, token, path).is_err() { executable = None; }
        }
        if executable.is_none() {
            check_window(&window)?;
            {
                let state = app.state::<BlenderState>();
                let mut session = state.0.lock().map_err(|e| e.to_string())?;
                if session.shutting_down || session.connecting != Some(token) {
                    return Err("Blender 连接已取消".into());
                }
                session.executable = None;
            }
            let picker = app.dialog().file().set_parent(&window).set_title("选择 Blender 可执行文件");
            #[cfg(windows)]
            let picker = picker.add_filter("Blender 可执行文件", &["exe"]);
            let Some(selected) = picker.blocking_pick_file() else {
                return Ok(BlenderStatus::unavailable("未选择有效的 Blender 可执行文件"));
            };
            check_window(&window)?;
            let path = selected.into_path().map_err(|e| e.to_string())?;
            let path = executable_file(&path).ok_or("请选择存在且可执行的 Blender 程序")?;
            probe_executable(&app, &window, token, &path)?;
            // Persist only a successfully probed native picker selection, never consent.
            save_selected_executable(&app, &path)?;
            executable = Some(path);
        }
        check_window(&window)?;
        let state = app.state::<BlenderState>();
        let mut session = state.0.lock().map_err(|e| e.to_string())?;
        if session.shutting_down || session.connecting != Some(token)
            || session.consented_owner.as_deref() != Some(window.label()) {
            return Err("Blender 连接已取消".into());
        }
        session.executable = executable;
        Ok(BlenderStatus::ready())
    }).await.map_err(|e| e.to_string())?
}

fn validate_script(script: &str) -> Result<(), String> {
    if script.trim().is_empty() { return Err("Blender Python 脚本不能为空".into()); }
    if script.len() > SCRIPT_LIMIT { return Err("Blender Python 脚本超过 256 KiB".into()); }
    Ok(())
}

#[tauri::command]
pub(crate) async fn desktop_blender_run(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request_id: String,
    script: String,
    on_progress: tauri::ipc::Channel<BlenderExecutionProgress>,
) -> Result<tauri::ipc::Response, String> {
    check_window(&window)?;
    validate_script(&script)?;
    let request_id = Uuid::parse_str(&request_id).map_err(|_| "Blender requestId 必须是 UUID")?;
    // Reserve synchronously before spawn_blocking: cancel always sees queued work.
    let (job, executable) = app.state::<BlenderState>().reserve(window.label(), request_id)?;
    let reservation = Reservation { state: app.state::<BlenderState>().0.clone(), job };
    tauri::async_runtime::spawn_blocking(move || {
        let _reservation = reservation;
        check_window(&window)?;
        let progress = |stage: ExecutionStage| {
            // A closed UI channel must not interrupt actual modeling.
            let _ = on_progress.send(stage.progress());
        };
        execute(&_reservation.job, &executable, &script, Some(&progress)).map(tauri::ipc::Response::new)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn desktop_blender_cancel(
    state: tauri::State<'_, BlenderState>,
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    check_window(&window)?;
    let request_id = Uuid::parse_str(&request_id).map_err(|_| "Blender requestId 必须是 UUID")?;
    state.cancel(window.label(), request_id);
    Ok(())
}

fn write_new(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
    file.write_all(contents).map_err(|e| e.to_string())
}

fn configure_environment(command: &mut Command, executable: &Path, directory: &Path) {
    command.env_clear();
    // Do not forward Python/Blender startup hooks, proxy settings, cloud tokens,
    // credentials or the rest of the application environment into generated code.
    #[cfg(windows)]
    {
        for key in ["SystemRoot", "WINDIR"] {
            if let Some(value) = std::env::var_os(key) { command.env(key, value); }
        }
        let mut paths = Vec::new();
        if let Some(parent) = executable.parent() { paths.push(parent.to_owned()); }
        if let Some(root) = std::env::var_os("SystemRoot") { paths.push(PathBuf::from(root).join("System32")); }
        if let Ok(path) = std::env::join_paths(paths) { command.env("PATH", path); }
    }
    #[cfg(not(windows))]
    {
        let _ = executable;
        command.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        command.env("LANG", "C");
    }
    for key in ["TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
        command.env(key, directory);
    }
    command.env("BLENDER_USER_CONFIG", directory.join("config"))
        .env("BLENDER_USER_SCRIPTS", directory.join("scripts"))
        .env("BLENDER_USER_DATAFILES", directory.join("datafiles"))
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");
}

fn spawn_job(job: &Job, executable: &Path, script: Option<&str>) -> Result<(PathBuf, ChildStdout, ChildStderr), String> {
    let mut resources = job.resources.lock().map_err(|e| e.to_string())?;
    job.check_running()?;
    let directory = JobDirectory::create()?;
    let path = directory.0.clone();
    resources.directory = Some(directory);
    if let Some(script) = script {
        write_new(&path.join("user.py"), script.as_bytes())?;
        write_new(&path.join("runner.py"), RUNNER.as_bytes())?;
    }
    job.check_running()?;
    let mut command = Command::new(executable);
    if script.is_some() {
        command.args(["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", "runner.py"]);
    } else {
        command.arg("--version");
    }
    command.current_dir(&path)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    configure_environment(&mut command, executable, &path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    // Hold the resource lock across spawn and registration. A concurrent cancel
    // sets its atomic flag immediately, then kills/reaps this registered child.
    resources.child = Some(ReapedChild(command.spawn().map_err(|e| format!("无法启动 Blender: {e}"))?));
    let child = &mut resources.child.as_mut().unwrap().0;
    let stdout = child.stdout.take().ok_or("Blender stdout 未创建")?;
    let stderr = child.stderr.take().ok_or("Blender stderr 未创建")?;
    Ok((path, stdout, stderr))
}

// Drain in the supervising worker, without blocking reader threads or a join on
// EOF. Even a Python subprocess inheriting the pipes cannot keep this job alive.
#[cfg(windows)]
fn read_available<P: Read + std::os::windows::io::AsRawHandle>(pipe: &mut P, buffer: &mut [u8]) -> std::io::Result<usize> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn PeekNamedPipe(pipe: *mut c_void, buffer: *mut c_void, size: u32, read: *mut u32, available: *mut u32, left: *mut u32) -> i32;
    }
    let mut available = 0u32;
    let result = unsafe {
        PeekNamedPipe(pipe.as_raw_handle(), std::ptr::null_mut(), 0, std::ptr::null_mut(), &mut available, std::ptr::null_mut())
    };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        // Broken pipe means EOF; no process or descendant can hold up shutdown.
        if matches!(error.raw_os_error(), Some(109 | 232 | 233)) { return Ok(0); }
        return Err(error);
    }
    let length = buffer.len().min(available as usize);
    if length == 0 { return Ok(0); }
    pipe.read(&mut buffer[..length])
}

#[cfg(unix)]
fn read_available<P: Read + std::os::fd::AsRawFd>(pipe: &mut P, buffer: &mut [u8]) -> std::io::Result<usize> {
    use std::os::fd::AsRawFd;
    extern "C" { fn fcntl(fd: i32, command: i32, ...) -> i32; }
    #[cfg(target_os = "linux")]
    const NONBLOCK: i32 = 0x800;
    #[cfg(not(target_os = "linux"))]
    const NONBLOCK: i32 = 0x4;
    let fd = pipe.as_raw_fd();
    let flags = unsafe { fcntl(fd, 3) }; // F_GETFL
    if flags < 0 || unsafe { fcntl(fd, 4, flags | NONBLOCK) } < 0 { // F_SETFL
        return Err(std::io::Error::last_os_error());
    }
    match pipe.read(buffer) {
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(0),
        result => result,
    }
}

fn drain<P>(pipe: &mut P, logs: &mut Vec<u8>, parser: Option<&mut StageParser>, progress: ProgressCallback<'_>) -> Result<(), String>
where
    P: Read + PipeHandle,
{
    let mut buffer = [0u8; 8192];
    let mut parser = parser;
    // A finite per-tick budget prevents continuous output starving timeout/cancel.
    for _ in 0..8 {
        let count = read_available(pipe, &mut buffer).map_err(|e| format!("读取 Blender 日志失败: {e}"))?;
        if count == 0 { break; }
        if count > LOG_LIMIT - logs.len() { return Err("Blender 日志超过 1 MiB 上限".into()); }
        logs.extend_from_slice(&buffer[..count]);
        if let Some(parser) = parser.as_deref_mut() { parser.push(&buffer[..count], progress); }
    }
    Ok(())
}

#[cfg(windows)]
trait PipeHandle: std::os::windows::io::AsRawHandle {}
#[cfg(windows)]
impl<T: std::os::windows::io::AsRawHandle> PipeHandle for T {}
#[cfg(unix)]
trait PipeHandle: std::os::fd::AsRawFd {}
#[cfg(unix)]
impl<T: std::os::fd::AsRawFd> PipeHandle for T {}

fn wait_for_process(job: &Job, stdout: &mut ChildStdout, stderr: &mut ChildStderr, progress: ProgressCallback<'_>) -> Result<Vec<u8>, String> {
    let mut logs = Vec::new();
    let mut parser = StageParser::default();
    let status = loop {
        job.check_running()?;
        drain(stdout, &mut logs, Some(&mut parser), progress)?;
        drain(stderr, &mut logs, None, None)?;
        let status = {
            let mut resources = job.resources.lock().map_err(|e| e.to_string())?;
            job.check_running()?;
            resources.child.as_mut().ok_or("Blender 任务已取消")?.0.try_wait().map_err(|e| e.to_string())?
        };
        if let Some(status) = status { break status; }
        std::thread::sleep(POLL_INTERVAL);
    };
    // Do not wait for EOF: descendants may still own pipe handles. Each drain has
    // a fixed budget and combined captured output remains bounded by LOG_LIMIT.
    drain(stdout, &mut logs, Some(&mut parser), progress)?;
    drain(stderr, &mut logs, None, None)?;
    job.check_running()?;
    if !status.success() {
        let start = logs.len().saturating_sub(8192);
        return Err(format!("Blender 执行失败 ({status}): {}", String::from_utf8_lossy(&logs[start..])));
    }
    Ok(logs)
}

fn execute(job: &Job, executable: &Path, script: &str, progress: ProgressCallback<'_>) -> Result<Vec<u8>, String> {
    validate_script(script)?;
    job.check_running()?;
    report_progress(progress, ExecutionStage::Starting);
    let (directory, mut stdout, mut stderr) = spawn_job(job, executable, Some(script))?;
    wait_for_process(job, &mut stdout, &mut stderr, progress)?;
    report_progress(progress, ExecutionStage::Reading);
    let result = read_framed_artifacts(&directory)?;
    job.check_running()?;
    report_progress(progress, ExecutionStage::Completed);
    Ok(result)
}

fn probe_executable(app: &tauri::AppHandle, window: &tauri::WebviewWindow, token: Uuid, executable: &Path) -> Result<(), String> {
    check_window(window)?;
    let state = app.state::<BlenderState>();
    let job = {
        let mut session = state.0.lock().map_err(|e| e.to_string())?;
        if session.shutting_down || session.connecting != Some(token)
            || session.consented_owner.as_deref() != Some(window.label()) {
            return Err("Blender 连接已取消".into());
        }
        if session.active.is_some() { return Err("Blender 正在执行另一个任务".into()); }
        let mut job = Job::new(Uuid::new_v4(), window.label());
        job.timeout = PROBE_TIMEOUT;
        let job = Arc::new(job);
        session.active = Some(job.clone());
        job
    };
    let _reservation = Reservation { state: state.0.clone(), job: job.clone() };
    let (_, mut stdout, mut stderr) = spawn_job(&job, executable, None)?;
    let logs = wait_for_process(&job, &mut stdout, &mut stderr, None)?;
    if !String::from_utf8_lossy(&logs).lines().any(|line| line.trim_start().starts_with("Blender ")) {
        return Err("所选程序未返回 Blender 版本信息".into());
    }
    Ok(())
}

fn validate_artifact(index: usize, bytes: &[u8]) -> Result<(), String> {
    let valid = match index {
        0 => bytes.len() >= 12 && bytes.starts_with(b"BLENDER")
            && ((matches!(bytes[7], b'_' | b'-') && matches!(bytes[8], b'v' | b'V')
                && bytes[9..12].iter().all(u8::is_ascii_digit))
                || (bytes.len() >= 17 && &bytes[7..13] == b"17-01v"
                    && bytes[13..17].iter().all(u8::is_ascii_digit))),
        1 => bytes.len() >= 20 && bytes.starts_with(b"glTF")
            && u32::from_le_bytes(bytes[4..8].try_into().unwrap()) == 2
            && u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize == bytes.len(),
        2 => bytes.len() >= 33 && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            && bytes[8..12] == 13u32.to_be_bytes() && &bytes[12..16] == b"IHDR"
            && (1..=768).contains(&u32::from_be_bytes(bytes[16..20].try_into().unwrap()))
            && (1..=768).contains(&u32::from_be_bytes(bytes[20..24].try_into().unwrap())),
        _ => false,
    };
    if !valid || bytes.len() > ARTIFACT_LIMITS.get(index).copied().unwrap_or(0) {
        return Err(format!("Blender 输出文件无效或超过大小上限 ({index})"));
    }
    Ok(())
}

fn artifact_lengths(directory: &Path) -> Result<[usize; 3], String> {
    let mut lengths = [0; 3];
    for (index, filename) in ["result.blend", "result.glb", "render.png"].iter().enumerate() {
        let metadata = fs::symlink_metadata(directory.join(filename)).map_err(|e| format!("缺少 Blender 输出 {filename}: {e}"))?;
        if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > ARTIFACT_LIMITS[index] as u64 {
            return Err(format!("Blender 输出 {filename} 超过大小上限或不是普通文件"));
        }
        lengths[index] = metadata.len() as usize;
    }
    Ok(lengths)
}

fn frame_header(lengths: [usize; 3]) -> Result<[u8; 12], String> {
    let mut header = [0; 12];
    for (index, length) in lengths.into_iter().enumerate() {
        if length == 0 || length > ARTIFACT_LIMITS[index] { return Err("Blender 输出大小无效".into()); }
        header[index * 4..index * 4 + 4].copy_from_slice(&(length as u32).to_le_bytes());
    }
    Ok(header)
}

fn read_framed_artifacts(directory: &Path) -> Result<Vec<u8>, String> {
    let lengths = artifact_lengths(directory)?;
    let header = frame_header(lengths)?;
    // Allocate the final IPC frame once; artifacts are read directly into it.
    let mut frame = Vec::with_capacity(12 + lengths.iter().sum::<usize>());
    frame.extend_from_slice(&header);
    for (index, filename) in ["result.blend", "result.glb", "render.png"].iter().enumerate() {
        let start = frame.len();
        let file = File::open(directory.join(filename)).map_err(|e| e.to_string())?;
        // The extra byte detects a file changing after metadata without unbounded allocation.
        file.take(lengths[index] as u64 + 1).read_to_end(&mut frame).map_err(|e| e.to_string())?;
        if frame.len() - start != lengths[index] { return Err(format!("Blender 输出 {filename} 大小已变化")); }
        validate_artifact(index, &frame[start..])?;
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_parser_accepts_only_exact_markers_across_chunks() {
        let stages = Mutex::new(Vec::new());
        let collect = |stage| stages.lock().unwrap().push(stage);
        let mut parser = StageParser::default();
        for byte in b"@@SCENIVO_BLENDER_STAGE@@executing\r\n@@SCENIVO_BLENDER_STAGE@@saving\n" {
            parser.push(&[*byte], Some(&collect));
        }
        parser.push(b"prefix@@SCENIVO_BLENDER_STAGE@@rendering\n@@SCENIVO_BLENDER_STAGE@@completed\n@@SCENIVO_BLENDER_STAGE@@exporting extra\n", Some(&collect));
        parser.push(&[b'x'; 100], Some(&collect));
        parser.push(b"@@SCENIVO_BLENDER_STAGE@@rendering\n@@SCENIVO_BLENDER_STAGE@@export", Some(&collect));
        parser.push(b"ing\n@@SCENIVO_BLENDER_STAGE@@rendering\n@@SCENIVO_BLENDER_STAGE@@saving", Some(&collect));
        assert_eq!(*stages.lock().unwrap(), vec![ExecutionStage::Executing, ExecutionStage::Saving,
            ExecutionStage::Exporting, ExecutionStage::Rendering]);
    }

    #[test]
    fn unauthorized_and_precancelled_runs_cannot_reserve() {
        let state = BlenderState::default();
        assert!(state.reserve("main", Uuid::new_v4()).err().unwrap().contains("授权"));
        state.0.lock().unwrap().consented_owner = Some("main".into());
        let cancelled = Uuid::new_v4();
        state.cancel("main", cancelled);
        assert!(state.reserve("main", cancelled).err().unwrap().contains("取消"));
        for _ in 0..MAX_CANCELLED_REQUESTS + 1 { state.cancel("main", Uuid::new_v4()); }
        assert_eq!(state.0.lock().unwrap().cancelled_requests.len(), MAX_CANCELLED_REQUESTS);
        assert!(state.reserve("main", Uuid::new_v4()).err().unwrap().contains("取消"));
        state.remove_window("main");
        assert!(state.0.lock().unwrap().cancelled_requests.is_empty());
    }

    #[test]
    #[ignore = "Requires an explicitly supplied real Blender executable"]
    fn real_blender_generates_binary_artifacts_and_cancels_child() {
        let configured = std::env::var_os("SCENIVO_TEST_BLENDER_EXECUTABLE")
            .expect("Set SCENIVO_TEST_BLENDER_EXECUTABLE to a real Blender executable");
        let executable = executable_file(Path::new(&configured)).expect("Blender executable must exist");
        let state = BlenderState::default();
        assert!(state.reserve("main", Uuid::new_v4()).is_err());
        {
            // Explicit test authorization, not an application/environment bypass.
            let mut session = state.0.lock().unwrap();
            session.consented_owner = Some("main".into());
            session.executable = Some(executable.clone());
        }
        let (job, executable) = state.reserve("main", Uuid::new_v4()).unwrap();
        let guard = Reservation { state: state.0.clone(), job: job.clone() };
        assert!(state.reserve("main", Uuid::new_v4()).is_err());
        let stages = Mutex::new(Vec::new());
        let collect = |stage| stages.lock().unwrap().push(stage);
        let frame = execute(&job, &executable,
            "import bpy\nbpy.ops.mesh.primitive_cube_add()\nbpy.context.scene.render.resolution_x = 64\nbpy.context.scene.render.resolution_y = 64\n", Some(&collect)).unwrap();
        assert_eq!(*stages.lock().unwrap(), vec![ExecutionStage::Starting, ExecutionStage::Executing,
            ExecutionStage::Saving, ExecutionStage::Exporting, ExecutionStage::Rendering,
            ExecutionStage::Reading, ExecutionStage::Completed]);
        let mut offset = 12;
        for index in 0..3 {
            let length = u32::from_le_bytes(frame[index * 4..index * 4 + 4].try_into().unwrap()) as usize;
            assert!(length > 0);
            validate_artifact(index, &frame[offset..offset + length]).unwrap();
            println!("Real Blender artifact {index}: {length} bytes");
            offset += length;
        }
        assert_eq!(offset, frame.len());
        let directory = job.resources.lock().unwrap().directory.as_ref().unwrap().0.clone();
        drop(guard);
        assert!(!directory.exists());
        assert!(state.0.lock().unwrap().active.is_none());

        let request_id = Uuid::new_v4();
        let (job, executable) = state.reserve("main", request_id).unwrap();
        let thread_job = job.clone();
        let guard = Reservation { state: state.0.clone(), job: job.clone() };
        let worker = std::thread::spawn(move || {
            let _guard = guard;
            execute(&thread_job, &executable, "import time\ntime.sleep(120)\n", None)
        });
        let deadline = Instant::now() + Duration::from_secs(10);
        let directory = loop {
            let resources = job.resources.lock().unwrap();
            if resources.child.is_some() {
                break resources.directory.as_ref().unwrap().0.clone();
            }
            drop(resources);
            assert!(Instant::now() < deadline, "Real Blender child did not start");
            std::thread::sleep(POLL_INTERVAL);
        };
        assert!(state.reserve("main", Uuid::new_v4()).is_err());
        let cancelled_at = Instant::now();
        state.cancel("main", request_id);
        assert!(job.resources.lock().unwrap().child.is_none(), "Cancel must kill and reap synchronously");
        assert!(worker.join().unwrap().unwrap_err().contains("取消"));
        assert!(cancelled_at.elapsed() < Duration::from_secs(5));
        assert!(!directory.exists());
        assert!(state.0.lock().unwrap().active.is_none());
        let (next_job, _) = state.reserve("main", Uuid::new_v4()).unwrap();
        drop(Reservation { state: state.0.clone(), job: next_job });
        println!("Real Blender cancellation reaped child, removed temporary files, and released worker");
    }

    #[test]
    fn origin_boundary_excludes_remote_and_other_ports() {
        for origin in ["tauri://localhost/index.html", "http://tauri.localhost/", "https://tauri.localhost/"] {
            assert!(trusted_origin(&url::Url::parse(origin).unwrap(), false));
        }
        for origin in ["https://example.com/", "https://tauri.localhost.evil/", "file:///index.html", "http://localhost:1420/", "http://tauri.localhost:123/", "tauri://user@localhost/"] {
            assert!(!trusted_origin(&url::Url::parse(origin).unwrap(), false));
        }
        assert!(trusted_origin(&url::Url::parse("http://localhost:1420/").unwrap(), true));
        assert!(!trusted_origin(&url::Url::parse("http://localhost:1421/").unwrap(), true));
    }

    #[test]
    fn script_limit_counts_utf8_bytes() {
        assert!(validate_script(" \n\t").is_err());
        assert!(validate_script(&"a".repeat(SCRIPT_LIMIT)).is_ok());
        assert!(validate_script(&"a".repeat(SCRIPT_LIMIT + 1)).is_err());
        assert!(validate_script(&"中".repeat(SCRIPT_LIMIT / 3 + 1)).is_err());
    }

    #[test]
    fn cancellation_is_window_bound_and_covers_reserved_work() {
        let state = BlenderState::default();
        let id = Uuid::new_v4();
        let job = Arc::new(Job::new(id, "main"));
        state.0.lock().unwrap().active = Some(job.clone());
        state.cancel("other", id);
        assert!(job.check_running().is_ok());
        state.cancel("main", Uuid::new_v4());
        assert!(job.check_running().is_ok());
        state.cancel("main", id);
        assert!(job.check_running().is_err());
        state.cancel("main", id);
        assert!(job.resources.lock().unwrap().child.is_none());
    }

    #[test]
    fn shutdown_and_window_destruction_revoke_consent_and_cancel() {
        for shutdown in [false, true] {
            let state = BlenderState::default();
            let job = Arc::new(Job::new(Uuid::new_v4(), "main"));
            {
                let mut session = state.0.lock().unwrap();
                session.consented_owner = Some("main".into());
                session.connecting = Some(Uuid::new_v4());
                session.active = Some(job.clone());
            }
            if shutdown { state.shutdown(); } else { state.remove_window("main"); }
            assert!(job.check_running().is_err());
            let session = state.0.lock().unwrap();
            assert!(session.consented_owner.is_none());
            assert!(session.connecting.is_none());
            assert_eq!(session.shutting_down, shutdown);
        }
    }

    #[test]
    fn timeout_includes_queue_delay() {
        let mut job = Job::new(Uuid::new_v4(), "main");
        job.started = Instant::now() - JOB_TIMEOUT;
        assert!(job.check_running().unwrap_err().contains("60"));
    }

    #[test]
    fn framing_is_little_endian_and_enforces_all_three_limits() {
        let header = frame_header([0x1234, 0x5678, 0x9abc]).unwrap();
        assert_eq!(header, [0x34, 0x12, 0, 0, 0x78, 0x56, 0, 0, 0xbc, 0x9a, 0, 0]);
        assert!(frame_header(ARTIFACT_LIMITS).is_ok());
        for index in 0..3 {
            let mut lengths = ARTIFACT_LIMITS;
            lengths[index] += 1;
            assert!(frame_header(lengths).is_err());
            lengths[index] = 0;
            assert!(frame_header(lengths).is_err());
        }
    }

    #[test]
    fn artifact_headers_and_preview_dimensions_are_validated() {
        assert!(validate_artifact(0, b"BLENDER-v450").is_ok());
        assert!(validate_artifact(0, b"BLENDER17-01v0500").is_ok());
        assert!(validate_artifact(0, b"BLENDER17-01v05").is_err());
        assert!(validate_artifact(0, b"BLENDERxxxxx").is_err());
        let mut glb = vec![0; 20];
        glb[..4].copy_from_slice(b"glTF");
        glb[4..8].copy_from_slice(&2u32.to_le_bytes());
        glb[8..12].copy_from_slice(&20u32.to_le_bytes());
        assert!(validate_artifact(1, &glb).is_ok());
        glb[8] = 19;
        assert!(validate_artifact(1, &glb).is_err());
        let mut png = vec![0; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[8..12].copy_from_slice(&13u32.to_be_bytes());
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&768u32.to_be_bytes());
        png[20..24].copy_from_slice(&1u32.to_be_bytes());
        assert!(validate_artifact(2, &png).is_ok());
        for invalid in [0u32, 769] {
            png[16..20].copy_from_slice(&invalid.to_be_bytes());
            assert!(validate_artifact(2, &png).is_err());
        }
        assert!(validate_artifact(2, &png[..24]).is_err());
    }
}
