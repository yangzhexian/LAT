//! The native selection controller owns capture lifetime; webviews only render snapshots.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(windows)]
#[path = "selection_windows.rs"]
mod native;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SelectionConfig {
    pub enabled: bool,
    pub shortcut: String,
    pub clipboard_fallback: bool,
    pub close_to_tray: bool,
    pub theme: String,
    pub reduce_motion: bool,
    pub target_language: String,
}

impl Default for SelectionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            shortcut: "Ctrl+Alt+T".into(),
            clipboard_fallback: true,
            close_to_tray: false,
            theme: "light".into(),
            reduce_motion: false,
            target_language: "zh".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionSnapshot {
    pub request_id: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub method: String,
}

pub struct Inner {
    config: Mutex<SelectionConfig>,
    snapshot: Mutex<Option<SelectionSnapshot>>,
    enabled: AtomicBool,
    paused: AtomicBool,
    busy: AtomicBool,
    pinned: AtomicBool,
    quitting: AtomicBool,
    generation: AtomicU64,
    #[cfg(windows)]
    controller: Mutex<Option<native::Controller>>,
}

#[derive(Clone)]
pub struct SelectionState(pub Arc<Inner>);

impl Default for SelectionState {
    fn default() -> Self {
        Self(Arc::new(Inner {
            config: Mutex::new(SelectionConfig::default()),
            snapshot: Mutex::new(None),
            enabled: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            pinned: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            #[cfg(windows)]
            controller: Mutex::new(None),
        }))
    }
}

impl Inner {
    fn active(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
            && !self.paused.load(Ordering::Acquire)
            && !self.quitting.load(Ordering::Acquire)
    }

    fn can_capture(&self) -> bool {
        self.active() && !self.busy.load(Ordering::Acquire)
    }
}

fn allowed(window: &tauri::WebviewWindow, labels: &[&str]) -> Result<(), String> {
    if labels.contains(&window.label()) {
        Ok(())
    } else {
        Err("此窗口无权执行该操作".into())
    }
}

fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    let shortcut: Shortcut = value
        .parse()
        .map_err(|_| "快捷键格式无效，例如 Ctrl+Alt+T".to_string())?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT)
    {
        return Err("快捷键至少需要 Ctrl 或 Alt 修饰键".into());
    }
    Ok(shortcut)
}

pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(
        app,
        "selection-bubble",
        WebviewUrl::App("index.html?window=selection-bubble".into()),
    )
    .title("LAT 划词翻译")
    .inner_size(44.0, 44.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()?;
    WebviewWindowBuilder::new(
        app,
        "selection",
        WebviewUrl::App("index.html?window=selection".into()),
    )
    .title("LAT · 划词翻译")
    .inner_size(440.0, 360.0)
    .min_inner_size(340.0, 260.0)
    .resizable(true)
    .decorations(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(false)
    .visible(false)
    .build()?;
    #[cfg(windows)]
    {
        if let Some(bubble) = app.get_webview_window("selection-bubble") {
            native::make_nonactivating(&bubble);
        }
        if let Some(window) = app.get_webview_window("selection") {
            native::use_system_corners(&window);
        }
        let state = app.state::<SelectionState>();
        let controller = native::Controller::new(app.clone(), state.0.clone());
        *state.0.controller.lock().unwrap() = Some(controller);
    }
    install_tray(app)?;
    Ok(())
}

fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "打开 LAT", true, None::<&str>)?;
    let pause = MenuItem::with_id(
        app,
        "selection-pause",
        "暂停 / 恢复划词翻译",
        true,
        None::<&str>,
    )?;
    let exit = MenuItem::with_id(app, "exit", "退出 LAT", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &exit])?;
    let mut tray = TrayIconBuilder::with_id("lat-tray")
        .tooltip("LAT · Local AI Translator")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "selection-pause" => {
                let state = app.state::<SelectionState>();
                let paused = !state.0.paused.fetch_xor(true, Ordering::AcqRel);
                if paused {
                    hide_bubble(app);
                    state.0.generation.fetch_add(1, Ordering::AcqRel);
                }
                let _ = app.emit_to(
                    "main",
                    "selection-paused",
                    serde_json::json!({"paused": paused}),
                );
            }
            "exit" => {
                app.state::<SelectionState>()
                    .0
                    .quitting
                    .store(true, Ordering::Release);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn close_to_tray(app: &tauri::AppHandle) -> bool {
    let state = app.state::<SelectionState>();
    !state.0.quitting.load(Ordering::Acquire) && state.0.config.lock().unwrap().close_to_tray
}

fn should_dismiss_on_blur(
    pinned: bool,
    expected_request: &str,
    current_request: Option<&str>,
    foreground: Option<bool>,
) -> bool {
    !pinned && current_request == Some(expected_request) && foreground == Some(false)
}

fn popup_is_foreground(window: &tauri::WebviewWindow) -> Option<bool> {
    #[cfg(windows)]
    {
        native::is_foreground(window)
    }
    #[cfg(not(windows))]
    {
        window.is_focused().ok()
    }
}

pub fn on_focus_lost(app: &tauri::AppHandle) {
    let state = app.state::<SelectionState>();
    if state.0.pinned.load(Ordering::Acquire) {
        return;
    }
    let Some(request_id) = state
        .0
        .snapshot
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.request_id.clone())
    else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // WebView2 focus transfers and native dragging can emit Focused(false)
        // while this top-level window is still foreground. Allow activation to
        // settle, and retry a temporarily null foreground handle.
        for _ in 0..3 {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let Some(window) = app.get_webview_window("selection") else {
                return;
            };
            match popup_is_foreground(&window) {
                Some(true) => return,
                None => continue,
                Some(false) => {
                    let check_app = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let state = check_app.state::<SelectionState>();
                        let current = state
                            .0
                            .snapshot
                            .lock()
                            .unwrap()
                            .as_ref()
                            .map(|s| s.request_id.clone());
                        if should_dismiss_on_blur(
                            state.0.pinned.load(Ordering::Acquire),
                            &request_id,
                            current.as_deref(),
                            popup_is_foreground(&window),
                        ) {
                            dismiss(&check_app);
                        }
                    });
                    return;
                }
            }
        }
    });
}

pub fn dismiss(app: &tauri::AppHandle) {
    let state = app.state::<SelectionState>();
    state.0.generation.fetch_add(1, Ordering::AcqRel);
    *state.0.snapshot.lock().unwrap() = None;
    state.0.pinned.store(false, Ordering::Release);
    hide_bubble(app);
    if let Some(window) = app.get_webview_window("selection") {
        let _ = window.set_always_on_top(false);
        let _ = window.hide();
    }
    let _ = app.emit_to(
        "selection",
        "selection-pinned",
        serde_json::json!({"pinned": false}),
    );
    let _ = app.emit_to("selection", "selection-dismissed", ());
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<SelectionState>();
    state.0.quitting.store(true, Ordering::Release);
    let _ = app.global_shortcut().unregister_all();
    #[cfg(windows)]
    if let Some(controller) = state.0.controller.lock().unwrap().take() {
        controller.stop();
    };
}

fn hide_bubble(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("selection-bubble") {
        let _ = window.hide();
    }
}

fn clamped_position(
    point: (i32, i32),
    size: (u32, u32),
    origin: (i32, i32),
    area: (u32, u32),
    gap: i32,
) -> (i32, i32) {
    let right = origin
        .0
        .saturating_add(area.0 as i32)
        .saturating_sub(size.0 as i32)
        .max(origin.0);
    let bottom = origin
        .1
        .saturating_add(area.1 as i32)
        .saturating_sub(size.1 as i32)
        .max(origin.1);
    let x = point.0.saturating_add(gap).clamp(origin.0, right);
    let desired_y = if point.1.saturating_add(gap).saturating_add(size.1 as i32)
        > origin.1.saturating_add(area.1 as i32)
    {
        point.1.saturating_sub(size.1 as i32).saturating_sub(gap)
    } else {
        point.1.saturating_add(gap)
    };
    (x, desired_y.clamp(origin.1, bottom))
}

fn position_window(window: &tauri::WebviewWindow, point: (i32, i32), bubble: bool) {
    if let Ok(Some(monitor)) = window.monitor_from_point(point.0 as f64, point.1 as f64) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let size = if bubble {
            let logical = tauri::LogicalSize::new(44.0, 44.0);
            let _ = window.set_size(logical);
            logical.to_physical::<u32>(scale)
        } else {
            let current_scale = window.scale_factor().unwrap_or(scale);
            let logical = window
                .outer_size()
                .unwrap_or(tauri::PhysicalSize::new(440, 360))
                .to_logical::<f64>(current_scale);
            let fitted = tauri::LogicalSize::new(
                logical.width.min(area.size.width as f64 / scale),
                logical.height.min(area.size.height as f64 / scale),
            );
            let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                340.0_f64.min(fitted.width),
                260.0_f64.min(fitted.height),
            )));
            let _ = window.set_size(fitted);
            fitted.to_physical::<u32>(scale)
        };
        let p = clamped_position(
            point,
            (size.width, size.height),
            (area.position.x, area.position.y),
            (area.size.width, area.size.height),
            (12.0 * scale) as i32,
        );
        let _ = window.set_position(tauri::PhysicalPosition::new(p.0, p.1));
    }
}

fn show_bubble(app: &tauri::AppHandle, point: (i32, i32)) -> Result<(), String> {
    let window = app
        .get_webview_window("selection-bubble")
        .ok_or_else(|| "划词浮标尚未初始化，请重新启用划词翻译。".to_string())?;
    position_window(&window, point, true);
    // Keep Tauri's visibility flags synchronized with Windows. This window is
    // built unfocused and non-focusable, so showing it preserves source focus.
    window
        .show()
        .map_err(|error| format!("划词浮标无法显示：{error}"))
}

fn publish(
    app: &tauri::AppHandle,
    inner: &Arc<Inner>,
    id: u64,
    text: String,
    error: Option<String>,
    method: &str,
    point: (i32, i32),
) {
    if !inner.can_capture() || id != inner.generation.load(Ordering::Acquire) {
        return;
    }
    let snapshot = SelectionSnapshot {
        request_id: id.to_string(),
        text,
        error,
        method: method.into(),
    };
    *inner.snapshot.lock().unwrap() = Some(snapshot.clone());
    hide_bubble(app);
    if let Some(window) = app.get_webview_window("selection") {
        position_window(&window, point, false);
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("selection", "selection-ready", snapshot);
}

#[tauri::command]
pub fn selection_configure(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    config: SelectionConfig,
) -> Result<SelectionConfig, String> {
    allowed(&window, &["main"])?;
    if !["light", "dark", "system"].contains(&config.theme.as_str()) {
        return Err("无效主题".into());
    }
    let shortcut = parse_shortcut(&config.shortcut)?;
    let state = app.state::<SelectionState>();
    let previous = state.0.config.lock().unwrap().clone();
    if config.enabled && (!previous.enabled || previous.shortcut != config.shortcut) {
        app.global_shortcut()
            .on_shortcut(shortcut, |app, _, event| {
                if event.state() == ShortcutState::Pressed {
                    #[cfg(windows)]
                    if let Some(controller) = app
                        .state::<SelectionState>()
                        .0
                        .controller
                        .lock()
                        .unwrap()
                        .as_ref()
                    {
                        controller.trigger();
                    }
                }
            })
            .map_err(|e| format!("快捷键被占用或无法注册：{e}"))?;
    }
    if previous.enabled && (!config.enabled || previous.shortcut != config.shortcut) {
        let _ = app.global_shortcut().unregister(previous.shortcut.as_str());
    }
    *state.0.config.lock().unwrap() = config.clone();
    state.0.enabled.store(config.enabled, Ordering::Release);
    if !config.enabled {
        state.0.paused.store(false, Ordering::Release);
        dismiss(&app);
    }
    for label in ["selection", "selection-bubble"] {
        let _ = app.emit_to(label, "selection-config", &config);
    }
    Ok(config)
}

#[tauri::command]
pub fn selection_get_config(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SelectionState>,
) -> Result<SelectionConfig, String> {
    allowed(&window, &["main", "selection", "selection-bubble"])?;
    Ok(state.0.config.lock().unwrap().clone())
}

#[tauri::command]
pub fn selection_snapshot(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SelectionState>,
) -> Result<Option<SelectionSnapshot>, String> {
    allowed(&window, &["selection", "selection-bubble"])?;
    Ok(state.0.snapshot.lock().unwrap().clone())
}

#[tauri::command]
pub fn selection_activate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    allowed(&window, &["selection-bubble"])?;
    #[cfg(windows)]
    if let Some(controller) = app
        .state::<SelectionState>()
        .0
        .controller
        .lock()
        .unwrap()
        .as_ref()
    {
        return controller.activate();
    }
    Err("当前平台不支持划词翻译".into())
}

#[tauri::command]
pub fn selection_dismiss(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    allowed(&window, &["main", "selection", "selection-bubble"])?;
    dismiss(&app);
    Ok(())
}

#[tauri::command]
pub fn selection_set_busy(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SelectionState>,
    busy: bool,
) -> Result<(), String> {
    allowed(&window, &["selection"])?;
    state.0.busy.store(busy, Ordering::Release);
    let _ = app.emit_to("main", "selection-busy", serde_json::json!({"busy": busy}));
    Ok(())
}

#[tauri::command]
pub fn selection_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    allowed(&window, &["selection"])?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn selection_set_pinned(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    pinned: bool,
) -> Result<(), String> {
    allowed(&window, &["selection"])?;
    app.state::<SelectionState>()
        .0
        .pinned
        .store(pinned, Ordering::Release);
    window
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())?;
    let _ = app.emit_to(
        "selection",
        "selection-pinned",
        serde_json::json!({"pinned": pinned}),
    );
    Ok(())
}

#[tauri::command]
pub fn selection_open_main(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    text: Option<String>,
) -> Result<(), String> {
    allowed(&window, &["selection"])?;
    // Keep the popup snapshot until main has accepted or rejected replacing its input.
    app.state::<SelectionState>()
        .0
        .pinned
        .store(true, Ordering::Release);
    let _ = window.set_always_on_top(true);
    let _ = app.emit_to(
        "selection",
        "selection-pinned",
        serde_json::json!({"pinned": true}),
    );
    show_main(&app);
    app.emit_to(
        "main",
        "selection-open-main",
        serde_json::json!({ "text": text }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn selection_copy(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    allowed(&window, &["selection"])?;
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || native::copy_text(hwnd, &text))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    Err("当前平台不支持此操作".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blur_only_dismisses_the_same_unpinned_popup_after_external_activation() {
        assert!(should_dismiss_on_blur(false, "42", Some("42"), Some(false)));
        assert!(!should_dismiss_on_blur(false, "42", Some("42"), Some(true)));
        assert!(!should_dismiss_on_blur(false, "42", Some("42"), None));
        assert!(!should_dismiss_on_blur(true, "42", Some("42"), Some(false)));
        assert!(!should_dismiss_on_blur(
            false,
            "42",
            Some("43"),
            Some(false)
        ));
        assert!(!should_dismiss_on_blur(false, "42", None, Some(false)));
    }

    #[test]
    fn positions_stay_in_work_area_with_negative_monitor_origin() {
        assert_eq!(
            clamped_position((-10, 1070), (440, 360), (-1920, 0), (1920, 1080), 12),
            (-440, 698)
        );
        assert_eq!(
            clamped_position((-2100, -40), (44, 44), (-1920, 0), (1920, 1080), 12),
            (-1920, 0)
        );
        assert_eq!(
            clamped_position((10, 10), (440, 360), (0, 0), (300, 200), 12),
            (0, 0)
        );
    }
    #[test]
    fn disabled_paused_and_busy_states_do_not_capture() {
        let state = SelectionState::default();
        assert!(!state.0.can_capture());
        state.0.enabled.store(true, Ordering::Relaxed);
        assert!(state.0.can_capture());
        state.0.busy.store(true, Ordering::Relaxed);
        assert!(!state.0.can_capture());
        state.0.busy.store(false, Ordering::Relaxed);
        state.0.paused.store(true, Ordering::Relaxed);
        assert!(!state.0.can_capture());
    }

    #[test]
    fn shortcuts_require_control_or_alt_and_a_valid_key() {
        assert!(parse_shortcut("Ctrl+Alt+T").is_ok());
        assert!(parse_shortcut("Ctrl+Shift+X").is_ok());
        assert!(parse_shortcut("Alt+F8").is_ok());
        assert!(parse_shortcut("Shift+A").is_err());
        assert!(parse_shortcut("A").is_err());
        assert!(parse_shortcut("Ctrl+unknown-key").is_err());
    }
}
