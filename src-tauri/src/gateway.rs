use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

static EXIT_STARTED: AtomicBool = AtomicBool::new(false);
static EXIT_FINISHED: AtomicBool = AtomicBool::new(false);
const PROTOCOL: u32 = 2;
const ADDRESS: &str = "127.0.0.1:8787";

#[derive(Clone, Serialize)]
pub struct GatewaySession {
    url: String,
    token: String,
    instance_id: String,
    protocol_version: u32,
    owned: bool,
}

struct RunningGateway {
    session: GatewaySession,
    child: Option<CommandChild>,
    terminated: Arc<AtomicBool>,
    _job: Option<ProcessJob>,
}

#[derive(Default)]
pub struct GatewayState(Mutex<Option<RunningGateway>>);

#[derive(Deserialize)]
struct Health {
    service: String,
    protocol_version: u32,
    instance_id: String,
}

fn parse_health(response: &str) -> Result<Health, String> {
    let (headers, body) = response.split_once("\r\n\r\n").ok_or("网关响应不完整")?;
    if !headers
        .lines()
        .next()
        .is_some_and(|line| line.starts_with("HTTP/1.0 200 ") || line.starts_with("HTTP/1.1 200 "))
    {
        return Err("网关健康检查失败".into());
    }
    let health: Health = serde_json::from_str(body).map_err(|_| "该端口不是兼容的 LAT 网关")?;
    if health.service != "lat-local-translator"
        || health.protocol_version != PROTOCOL
        || health.instance_id.is_empty()
    {
        return Err("网关协议不兼容，请退出旧版或外部网关后重试".into());
    }
    Ok(health)
}

fn exchange(method: &str, path: &str, token: Option<&str>) -> Result<String, String> {
    let mut stream =
        TcpStream::connect_timeout(&ADDRESS.parse().unwrap(), Duration::from_millis(400))
            .map_err(|_| "本地网关未响应")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|e| e.to_string())?;
    let auth = token
        .map(|value| format!("Authorization: Bearer {value}\r\n"))
        .unwrap_or_default();
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: {ADDRESS}\r\n{auth}Content-Length: 0\r\nConnection: close\r\n\r\n")
        .map_err(|_| "发送网关请求失败")?;
    let mut response = String::new();
    stream
        .take(131072)
        .read_to_string(&mut response)
        .map_err(|_| "读取网关响应超时")?;
    Ok(response)
}

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此窗口无权管理翻译网关".into())
    }
}

#[tauri::command]
pub fn gateway_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<GatewaySession, String> {
    if !matches!(window.label(), "main" | "selection") {
        return Err("此窗口无权访问翻译网关".into());
    }
    app.state::<GatewayState>()
        .0
        .lock()
        .map_err(|_| "网关状态锁不可用")?
        .as_ref()
        .map(|running| running.session.clone())
        .ok_or("翻译网关尚未启动".into())
}

#[tauri::command]
pub async fn start_gateway(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<GatewaySession, String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || start(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn start(app: &tauri::AppHandle) -> Result<GatewaySession, String> {
    let state = app.state::<GatewayState>();
    let mut guard = state.0.lock().map_err(|_| "网关状态锁不可用")?;
    if let Some(running) = guard.as_ref() {
        return Ok(running.session.clone());
    }
    if let Ok(response) = exchange("GET", "/health", None) {
        let health = parse_health(&response)?;
        let token = std::env::var("LAT_ADMIN_TOKEN")
            .map_err(|_| "检测到外部网关，请配置相同 LAT_ADMIN_TOKEN，或退出外部网关后重试")?;
        if !valid_token(&token) {
            return Err("LAT_ADMIN_TOKEN 应为 32 至 512 位 ASCII 字母、数字或 -_.".into());
        }
        let authorized = exchange("GET", "/admin/status", Some(&token))?;
        if !authorized.starts_with("HTTP/1.0 200 ") && !authorized.starts_with("HTTP/1.1 200 ") {
            return Err("外部网关会话密钥不匹配".into());
        }
        let session = GatewaySession {
            url: format!("http://{ADDRESS}"),
            token,
            instance_id: health.instance_id,
            protocol_version: PROTOCOL,
            owned: false,
        };
        *guard = Some(RunningGateway {
            session: session.clone(),
            child: None,
            terminated: Arc::new(AtomicBool::new(false)),
            _job: None,
        });
        return Ok(session);
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let instance_id = uuid::Uuid::new_v4().to_string();
    let session = GatewaySession {
        url: format!("http://{ADDRESS}"),
        token: token.clone(),
        instance_id: instance_id.clone(),
        protocol_version: PROTOCOL,
        owned: true,
    };
    let (mut events, child) = app
        .shell()
        .sidecar("hy-mt2-gateway")
        .map_err(|e| e.to_string())?
        .args(["serve"])
        .env("LAT_ADMIN_TOKEN", token)
        .env("LAT_GATEWAY_INSTANCE_ID", &instance_id)
        .env("LLM_TRANSLATOR_HOST", "127.0.0.1")
        .env("LLM_TRANSLATOR_PORT", "8787")
        .spawn()
        .map_err(|e| format!("启动翻译网关失败: {e}"))?;
    let job = match ProcessJob::attach(child.pid()) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let terminated = Arc::new(AtomicBool::new(false));
    *guard = Some(RunningGateway {
        session: session.clone(),
        child: Some(child),
        terminated: terminated.clone(),
        _job: Some(job),
    });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Error(error) => {
                    let _ = handle.emit("gateway-error", error);
                }
                CommandEvent::Terminated(payload) => {
                    terminated.store(true, Ordering::Release);
                    if let Ok(mut guard) = handle.state::<GatewayState>().0.lock() {
                        if guard
                            .as_ref()
                            .is_some_and(|running| running.session.instance_id == instance_id)
                        {
                            *guard = None;
                        }
                    }
                    let _ = handle.emit("gateway-terminated", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(session)
}

fn valid_token(value: &str) -> bool {
    (32..=512).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
}

fn owns_health(session: &GatewaySession, response: &str) -> bool {
    session.owned
        && parse_health(response).is_ok_and(|health| health.instance_id == session.instance_id)
}

pub fn stop_gateway_process(app: &tauri::AppHandle) {
    let running = app
        .state::<GatewayState>()
        .0
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    let Some(mut running) = running else {
        return;
    };
    if !running.session.owned {
        return;
    }
    if exchange("GET", "/health", None)
        .is_ok_and(|response| owns_health(&running.session, &response))
    {
        let _ = exchange("POST", "/admin/shutdown", Some(&running.session.token));
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while !running.terminated.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    if !running.terminated.load(Ordering::Acquire) {
        if let Some(child) = running.child.take() {
            let _ = child.kill();
        }
    }
    // Dropping the owned Windows job also reaps any surviving model descendants.
}

#[tauri::command]
pub async fn stop_gateway(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || stop_gateway_process(&app))
        .await
        .map_err(|e| e.to_string())
}

struct ProcessJob(isize);
impl ProcessJob {
    #[cfg(windows)]
    fn attach(pid: u32) -> Result<Self, String> {
        use windows::Win32::{
            Foundation::CloseHandle,
            System::{JobObjects::*, Threading::*},
        };
        unsafe {
            let handle = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            );
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid);
            let result = match (configured, process) {
                (Ok(()), Ok(process)) => {
                    let result = AssignProcessToJobObject(handle, process);
                    let _ = CloseHandle(process);
                    result
                }
                (Err(error), Ok(process)) => {
                    let _ = CloseHandle(process);
                    Err(error)
                }
                (_, Err(error)) => Err(error),
            };
            match result {
                Ok(()) => Ok(Self(handle.0 as isize)),
                Err(error) => {
                    let _ = CloseHandle(handle);
                    Err(format!("无法管理网关进程组: {error}"))
                }
            }
        }
    }
    #[cfg(not(windows))]
    fn attach(_pid: u32) -> Result<Self, String> {
        Ok(Self(0))
    }
}
impl Drop for ProcessJob {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(
                self.0 as *mut _,
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn response(instance: &str) -> String {
        format!("HTTP/1.0 200 OK\r\n\r\n{{\"service\":\"lat-local-translator\",\"protocol_version\":2,\"instance_id\":\"{instance}\"}}")
    }
    #[test]
    fn handshake_checks_protocol_and_real_http_status() {
        assert!(parse_health(&response("one")).is_ok());
        assert!(parse_health(&response("one").replace("200 OK", "503 Error")).is_err());
        assert!(parse_health(&response("one").replace("version\":2", "version\":1")).is_err());
    }
    #[test]
    fn shutdown_requires_ownership_and_instance_match() {
        let mut session = GatewaySession {
            url: String::new(),
            token: String::new(),
            instance_id: "one".into(),
            protocol_version: PROTOCOL,
            owned: true,
        };
        assert!(owns_health(&session, &response("one")));
        assert!(!owns_health(&session, &response("two")));
        session.owned = false;
        assert!(!owns_health(&session, &response("one")));
    }
    #[test]
    fn external_credentials_cannot_inject_headers() {
        assert!(valid_token(&"a".repeat(64)));
        assert!(!valid_token(&format!("{}\r\nX: y", "a".repeat(64))));
    }
}

// Keep the event loop responsive while waiting for the owned process tree.
pub fn request_exit(app: &tauri::AppHandle, api: tauri::ExitRequestApi) {
    if EXIT_FINISHED.load(Ordering::Acquire) {
        return;
    }
    api.prevent_exit();
    if EXIT_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    crate::selection::shutdown(app);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        stop_gateway_process(&handle);
        EXIT_FINISHED.store(true, Ordering::Release);
        handle.exit(0);
    });
}
