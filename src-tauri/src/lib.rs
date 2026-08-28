#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct GatewayState(Mutex<Option<CommandChild>>);

fn gateway_response_is_ready(response: &str) -> bool {
    let status_ok = response
        .lines()
        .next()
        .is_some_and(|line| line.starts_with("HTTP/1.0 200") || line.starts_with("HTTP/1.1 200"));
    status_ok
        && (response.contains("lat-local-translator")
            || response.contains("hy-mt2-local-translator"))
}

fn gateway_is_ready() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:8787".parse().expect("valid gateway address"),
        Duration::from_millis(250),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nConnection: close\r\n\r\n");
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    gateway_response_is_ready(&response)
}

fn request_gateway_shutdown() {
    if let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:8787".parse().expect("valid gateway address"),
        Duration::from_millis(500),
    ) {
        let _ = stream.write_all(
            b"POST /admin/shutdown HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
    }
}

#[tauri::command]
fn start_gateway(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayState>,
) -> Result<(), String> {
    if gateway_is_ready() {
        return Ok(());
    }
    let mut guard = state.0.lock().map_err(|_| "网关状态锁不可用".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let sidecar = app
        .shell()
        .sidecar("hy-mt2-gateway")
        .map_err(|error| format!("找不到翻译网关 sidecar: {error}"))?;
    let (mut events, child) = sidecar
        .args(["serve"])
        .spawn()
        .map_err(|error| format!("启动翻译网关失败: {error}"))?;
    *guard = Some(child);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Error(error) => {
                    let _ = handle.emit("gateway-error", error);
                }
                CommandEvent::Terminated(payload) => {
                    if let Ok(mut guard) = handle.state::<GatewayState>().0.lock() {
                        *guard = None;
                    }
                    let _ = handle.emit("gateway-terminated", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_gateway_process(app: &tauri::AppHandle) {
    request_gateway_shutdown();
    std::thread::sleep(Duration::from_millis(750));
    if let Ok(mut guard) = app.state::<GatewayState>().0.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}

#[tauri::command]
fn stop_gateway(app: tauri::AppHandle) -> Result<(), String> {
    stop_gateway_process(&app);
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(GatewayState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_gateway, stop_gateway])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");
    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            stop_gateway_process(app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::gateway_response_is_ready;

    #[test]
    fn accepts_expected_gateway_health_response() {
        let response =
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"service\":\"lat-local-translator\"}";
        assert!(gateway_response_is_ready(response));
    }

    #[test]
    fn rejects_error_response_even_when_body_contains_200() {
        let response =
            "HTTP/1.1 503 Service Unavailable\r\n\r\n{\"service\":\"lat-local-translator\",\"retry\":200}";
        assert!(!gateway_response_is_ready(response));
    }
}
