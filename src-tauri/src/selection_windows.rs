//! Windows-only primitives. No native operation is run by the unit tests below.
use super::{hide_bubble, publish, show_bubble, Inner};
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use windows::core::Interface;
use windows::Win32::Foundation::{
    GlobalFree, HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, POINT, WPARAM,
};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::DataExchange::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::UI::Accessibility::*;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

const CAPTURE_TIMEOUT: Duration = Duration::from_millis(700);
const SELECTION_LIFETIME: Duration = Duration::from_secs(5);
const MAX_CAPTURE_CHARS: usize = 100_000;
const MAX_CLIPBOARD_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug)]
struct Target {
    window: usize,
    process: u32,
    point: (i32, i32),
}

impl Target {
    fn current() -> Option<Self> {
        unsafe {
            let window = GetForegroundWindow();
            let process = window_process(window);
            if window.0.is_null() || process == std::process::id() || process == 0 {
                return None;
            }
            let mut point = POINT::default();
            GetCursorPos(&mut point).ok()?;
            Some(Self {
                window: window.0 as usize,
                process,
                point: (point.x, point.y),
            })
        }
    }
    fn focused(self) -> bool {
        unsafe {
            GetForegroundWindow().0 as usize == self.window
                && window_process(HWND(self.window as _)) == self.process
        }
    }
    fn at_point(point: POINT) -> Option<Self> {
        unsafe {
            let window = GetAncestor(WindowFromPoint(point), GA_ROOT);
            let process = window_process(window);
            if window.0.is_null() || process == 0 {
                return None;
            }
            Some(Self {
                window: window.0 as usize,
                process,
                point: (point.x, point.y),
            })
        }
    }
}

unsafe fn window_process(window: HWND) -> u32 {
    let mut pid = 0;
    GetWindowThreadProcessId(window, Some(&mut pid));
    pid
}

#[derive(Clone, Copy)]
enum Event {
    Mouse(MouseEvent),
    Down(Target, u32, u64),
    Up(Target, u32, u64),
    Clear,
    Shortcut(Target, u64),
    Activate(u64),
}

#[derive(Clone, Copy)]
struct MouseEvent {
    message: u32,
    point: (i32, i32),
    time: u32,
    revision: u64,
}

// Hooks only update counters and forward raw events. Window hit-testing can send
// synchronous messages to other threads and must stay on the coordinator.
static HOOK_QUEUE: OnceLock<SyncSender<Event>> = OnceLock::new();
static HOOK_INNER: OnceLock<Arc<Inner>> = OnceLock::new();
// Counters only: no key codes, characters, or input content are retained.
static INPUT_ACTIVITY: AtomicU64 = AtomicU64::new(0);
static CAPTURE_ACTIVITY: AtomicU64 = AtomicU64::new(0);
static HOOKS_READY: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && (*(lparam.0 as *const KBDLLHOOKSTRUCT)).flags.0 & LLKHF_INJECTED.0 == 0 {
        INPUT_ACTIVITY.fetch_add(1, Ordering::AcqRel);
        let key = (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode as u16;
        if matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN)
            && ![
                VK_CONTROL,
                VK_LCONTROL,
                VK_RCONTROL,
                VK_SHIFT,
                VK_LSHIFT,
                VK_RSHIFT,
                VK_MENU,
                VK_LMENU,
                VK_RMENU,
                VK_LWIN,
                VK_RWIN,
            ]
            .iter()
            .any(|modifier| modifier.0 == key)
        {
            CAPTURE_ACTIVITY.fetch_add(1, Ordering::AcqRel);
            if let Some(inner) = HOOK_INNER.get() {
                inner.generation.fetch_add(1, Ordering::AcqRel);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        if info.flags & LLMHF_INJECTED == 0 {
            let message = wparam.0 as u32;
            if matches!(
                message,
                WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_MOUSEWHEEL | WM_MOUSEHWHEEL
            ) {
                INPUT_ACTIVITY.fetch_add(1, Ordering::AcqRel);
                let revision = CAPTURE_ACTIVITY.fetch_add(1, Ordering::AcqRel) + 1;
                if let Some(queue) = HOOK_QUEUE.get() {
                    if queue
                        .try_send(Event::Mouse(MouseEvent {
                            message,
                            point: (info.pt.x, info.pt.y),
                            time: info.time,
                            revision,
                        }))
                        .is_err()
                    {
                        // Overflow invalidates old captures instead of using a stale
                        // selection after an interaction we could not forward.
                        if let Some(inner) = HOOK_INNER.get() {
                            inner.generation.fetch_add(1, Ordering::AcqRel);
                        }
                    }
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub struct Controller {
    queue: SyncSender<Event>,
    inner: Arc<Inner>,
    stopped: Arc<AtomicBool>,
    coordinator: JoinHandle<()>,
    hook: JoinHandle<()>,
}

impl Controller {
    pub fn new(app: tauri::AppHandle, inner: Arc<Inner>) -> Self {
        let (queue, events) = mpsc::sync_channel(16);
        let _ = HOOK_QUEUE.set(queue.clone());
        let _ = HOOK_INNER.set(inner.clone());
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let hook_inner = inner.clone();
        let hook_app = app.clone();
        let hook = thread::Builder::new()
            .name("lat-selection-mouse".into())
            .spawn(move || unsafe {
                let mut installed = None;
                let mut keyboard = None;
                let mut failed = false;
                while !stop.load(Ordering::Acquire) {
                    if hook_inner.active() && installed.is_none() && !failed {
                        let module = GetModuleHandleW(None).ok().map(|handle| handle.into());
                        match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), module, 0) {
                            Ok(handle) => {
                                match SetWindowsHookExW(
                                    WH_KEYBOARD_LL,
                                    Some(keyboard_hook),
                                    module,
                                    0,
                                ) {
                                    Ok(key_handle) => {
                                        installed = Some(handle);
                                        keyboard = Some(key_handle);
                                        HOOKS_READY.store(true, Ordering::Release);
                                    }
                                    Err(_) => {
                                        let _ = UnhookWindowsHookEx(handle);
                                        failed = true;
                                        let _ = hook_app.emit_to(
                                            "main",
                                            "selection-native-error",
                                            "输入活动检测不可用，请重新启用划词翻译。",
                                        );
                                    }
                                }
                            }
                            Err(_) => {
                                failed = true;
                                let _ = hook_app.emit_to(
                                    "main",
                                    "selection-native-error",
                                    "鼠标监听不可用，请尝试关闭后重新启用划词翻译。",
                                );
                            }
                        }
                    } else if !hook_inner.active() {
                        HOOKS_READY.store(false, Ordering::Release);
                        if let Some(handle) = installed.take() {
                            let _ = UnhookWindowsHookEx(handle);
                        }
                        if let Some(handle) = keyboard.take() {
                            let _ = UnhookWindowsHookEx(handle);
                        }
                        failed = false;
                    }
                    let mut message = MSG::default();
                    while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                    // Unlike sleep, this wakes immediately for sent hook messages.
                    let _ = MsgWaitForMultipleObjectsEx(None, 50, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
                }
                if let Some(handle) = installed {
                    HOOKS_READY.store(false, Ordering::Release);
                    let _ = UnhookWindowsHookEx(handle);
                }
                if let Some(handle) = keyboard {
                    let _ = UnhookWindowsHookEx(handle);
                }
            })
            .expect("selection mouse thread");
        let stop = stopped.clone();
        let controller_inner = inner.clone();
        let coordinator = thread::Builder::new()
            .name("lat-selection-controller".into())
            .spawn(move || {
                coordinate(app, inner, events, stop);
            })
            .expect("selection controller thread");
        Self {
            queue,
            inner: controller_inner,
            stopped,
            coordinator,
            hook,
        }
    }
    pub fn trigger(&self) {
        if !self.inner.can_capture() {
            return;
        }
        if let Some(target) = Target::current() {
            let _ = self.queue.try_send(Event::Shortcut(
                target,
                CAPTURE_ACTIVITY.load(Ordering::Acquire),
            ));
        }
    }
    pub fn activate(&self) -> Result<(), String> {
        self.queue
            .try_send(Event::Activate(CAPTURE_ACTIVITY.load(Ordering::Acquire)))
            .map_err(|_| "取词正在处理中，请重试".into())
    }
    pub fn stop(self) {
        self.stopped.store(true, Ordering::Release);
        self.inner.generation.fetch_add(1, Ordering::AcqRel);
        // Never join from Tauri's event loop: the controller may be waiting for a
        // window getter dispatched to that same loop. The reaper is best effort;
        // process exit also releases hooks. A stuck UIA provider is never joined.
        let _ = thread::Builder::new()
            .name("lat-selection-cleanup".into())
            .spawn(move || {
                let _ = self.hook.join();
                let _ = self.coordinator.join();
            });
    }
}

#[derive(Default)]
struct Capture {
    text: String,
    candidate: bool,
    known_empty: bool,
    error: Option<String>,
}
struct Query {
    target: Target,
    by_point: bool,
    reply: SyncSender<Capture>,
}
struct UiaWorker {
    queue: SyncSender<Query>,
    occupied: Arc<AtomicBool>,
}

impl UiaWorker {
    fn new() -> Self {
        let (queue, requests) = mpsc::sync_channel::<Query>(1);
        let occupied = Arc::new(AtomicBool::new(false));
        let flag = occupied.clone();
        thread::Builder::new()
            .name("lat-selection-uia-mta".into())
            .spawn(move || unsafe {
                let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
                let automation: Option<IUIAutomation> = if initialized {
                    CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).ok()
                } else {
                    None
                };
                if let Some(client) = &automation {
                    if let Ok(client2) = client.cast::<IUIAutomation2>() {
                        let _ = client2.SetConnectionTimeout(300);
                        let _ = client2.SetTransactionTimeout(500);
                    }
                }
                while let Ok(query) = requests.recv() {
                    let capture = match &automation {
                        Some(client) => capture_uia(client, query.target, query.by_point),
                        None => Capture {
                            error: Some("系统取词接口不可用，请手动复制到主窗口。".into()),
                            ..Default::default()
                        },
                    };
                    flag.store(false, Ordering::Release);
                    let _ = query.reply.try_send(capture);
                }
                drop(automation);
                if initialized {
                    CoUninitialize();
                }
            })
            .expect("selection UIA thread");
        Self { queue, occupied }
    }
    fn capture(&self, target: Target, by_point: bool) -> Capture {
        if self.occupied.swap(true, Ordering::AcqRel) {
            return Capture {
                error: Some("取词接口仍在等待当前程序响应，请稍后重试或手动复制。".into()),
                ..Default::default()
            };
        }
        let (reply, result) = mpsc::sync_channel(1);
        if self
            .queue
            .try_send(Query {
                target,
                by_point,
                reply,
            })
            .is_err()
        {
            self.occupied.store(false, Ordering::Release);
            return Capture {
                error: Some("取词接口不可用，请手动复制。".into()),
                ..Default::default()
            };
        }
        result
            .recv_timeout(CAPTURE_TIMEOUT)
            .unwrap_or_else(|_| Capture {
                error: Some("取词超时，请稍后重试或手动复制到主窗口。".into()),
                ..Default::default()
            })
    }
}

unsafe fn capture_uia(client: &IUIAutomation, target: Target, by_point: bool) -> Capture {
    if !target.focused() {
        return Capture {
            error: Some("原窗口已切换，请重新划选。".into()),
            ..Default::default()
        };
    }
    let focused = client.GetFocusedElement().ok();
    if let Some(element) = &focused {
        if element
            .CurrentIsPassword()
            .map(|value| value.as_bool())
            .unwrap_or(true)
        {
            return Capture {
                error: Some("密码输入框不支持划词翻译。".into()),
                ..Default::default()
            };
        }
    }
    let point = if by_point {
        client
            .ElementFromPoint(POINT {
                x: target.point.0,
                y: target.point.1,
            })
            .ok()
    } else {
        None
    };
    let walker = client.ControlViewWalker().ok();
    let mut result = Capture::default();
    for start in [point, focused].into_iter().flatten() {
        let mut current = Some(start);
        for _ in 0..6 {
            let Some(element) = current.take() else {
                break;
            };
            if element.CurrentProcessId().ok() != Some(target.process as i32) {
                break;
            }
            if element
                .CurrentIsPassword()
                .map(|value| value.as_bool())
                .unwrap_or(true)
            {
                return Capture {
                    error: Some("此控件不允许安全取词，请手动复制。".into()),
                    ..Default::default()
                };
            }
            let kind = element.CurrentControlType().ok();
            result.candidate |= kind == Some(UIA_TextControlTypeId)
                || kind == Some(UIA_DocumentControlTypeId)
                || kind == Some(UIA_EditControlTypeId);
            if let Ok(pattern) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                if let Ok(ranges) = pattern.GetSelection() {
                    let Ok(count) = ranges.Length() else {
                        return Capture {
                            error: Some("无法完整读取选区，请重新划选或手动复制。".into()),
                            ..Default::default()
                        };
                    };
                    if count > 32 {
                        return Capture {
                            error: Some("选区数量过多，请分次选择。".into()),
                            ..Default::default()
                        };
                    }
                    let mut parts = Vec::new();
                    for index in 0..count {
                        let Ok(range) = ranges.GetElement(index) else {
                            return Capture {
                                error: Some("无法完整读取选区，请重新划选或手动复制。".into()),
                                ..Default::default()
                            };
                        };
                        let Ok(text) = range.GetText((MAX_CAPTURE_CHARS * 2 + 1) as i32) else {
                            return Capture {
                                error: Some("部分选区无法读取，请重新划选或手动复制。".into()),
                                ..Default::default()
                            };
                        };
                        let text = text.to_string();
                        if !text.trim().is_empty() {
                            parts.push(text);
                        }
                    }
                    let text = parts.join("\n");
                    if text.chars().count() > MAX_CAPTURE_CHARS {
                        return Capture {
                            error: Some("所选文本超过 100,000 字符，请缩小选区后重试。".into()),
                            ..Default::default()
                        };
                    }
                    if !text.trim().is_empty() {
                        return Capture {
                            text,
                            ..Default::default()
                        };
                    }
                    result.known_empty = true;
                }
            }
            current = walker
                .as_ref()
                .and_then(|walker| walker.GetParentElement(&element).ok());
        }
    }
    // A known-empty TextPattern is authoritative. Ctrl+C in editors could otherwise
    // copy the current line without any selection.
    if result.known_empty {
        result.candidate = false;
    }
    result
}

struct Pending {
    target: Target,
    id: u64,
    created: Instant,
    capture: Capture,
}

fn route_mouse(
    mouse: MouseEvent,
    target: Option<Target>,
    bubble_window: usize,
    own_process: u32,
    bubble_pressed: &mut bool,
    inner: &Inner,
) -> Option<Event> {
    if target.is_some_and(|target| target.window == bubble_window) {
        match mouse.message {
            WM_LBUTTONDOWN => *bubble_pressed = true,
            WM_LBUTTONUP => {
                if std::mem::take(bubble_pressed) {
                    // WebView2 may not deliver the first DOM click in an inactive
                    // window. The native down/up pair is the activation authority.
                    return Some(Event::Activate(mouse.revision));
                }
            }
            _ => *bubble_pressed = false,
        }
        return None;
    }
    *bubble_pressed = false;
    match (
        mouse.message,
        target.filter(|target| target.process != own_process),
    ) {
        (WM_LBUTTONDOWN, Some(target)) => {
            let id = inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
            Some(Event::Down(target, mouse.time, id))
        }
        (WM_LBUTTONUP, Some(target)) => Some(Event::Up(target, mouse.time, mouse.revision)),
        _ => {
            inner.generation.fetch_add(1, Ordering::AcqRel);
            Some(Event::Clear)
        }
    }
}

fn capture_is_current(inner: &Inner, id: u64, revision: u64, observed_revision: u64) -> bool {
    inner.can_capture()
        && id == inner.generation.load(Ordering::Acquire)
        && revision == observed_revision
}

fn capture_after_gesture(
    mut is_current: impl FnMut() -> bool,
    mut capture: impl FnMut() -> Capture,
    mut wait: impl FnMut(Duration),
) -> Option<Capture> {
    // A browser can expose an empty TextPattern before its mouse-up selection
    // is committed. Retry once without copying, and never retry protected/errors.
    for attempt in 0..2 {
        wait(Duration::from_millis(if attempt == 0 { 70 } else { 100 }));
        if !is_current() {
            return None;
        }
        let result = capture();
        if !is_current() {
            return None;
        }
        if attempt == 1 || !result.text.trim().is_empty() || result.error.is_some() {
            return Some(result);
        }
    }
    unreachable!("the last attempt always returns")
}

fn start_shortcut(inner: &Inner, revision: u64, observed_revision: u64) -> Option<u64> {
    if !inner.can_capture() || revision != observed_revision {
        return None;
    }
    // Allocate after earlier queued mouse events have been routed. Otherwise an
    // earlier mouse-down can invalidate a newer shortcut when UIA is slow.
    Some(inner.generation.fetch_add(1, Ordering::AcqRel) + 1)
}

fn is_selection_gesture(
    start: Target,
    end: Target,
    previous: Option<(Target, u32)>,
    now: u32,
    double_click_ms: u32,
) -> bool {
    if start.window != end.window {
        return false;
    }
    let drag = (start.point.0 - end.point.0).abs() >= 6 || (start.point.1 - end.point.1).abs() >= 6;
    let double = previous.is_some_and(|(last, at)| {
        last.window == end.window
            && now.wrapping_sub(at) <= double_click_ms
            && (last.point.0 - end.point.0).abs() <= 4
            && (last.point.1 - end.point.1).abs() <= 4
    });
    drag || double
}

fn coordinate(
    app: tauri::AppHandle,
    inner: Arc<Inner>,
    events: Receiver<Event>,
    stopped: Arc<AtomicBool>,
) {
    let uia = UiaWorker::new();
    let mut down = None;
    let mut last_up = None;
    let mut pending: Option<Pending> = None;
    let mut verified_gesture: Option<(Target, Instant)> = None;
    let bubble_window = app
        .get_webview_window("selection-bubble")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as usize)
        .unwrap_or(0);
    let mut bubble_pressed = false;
    while !stopped.load(Ordering::Acquire) {
        if verified_gesture.is_some_and(|(target, created)| {
            !target.focused() || created.elapsed() > SELECTION_LIFETIME || !inner.can_capture()
        }) {
            verified_gesture = None;
        }
        if pending.as_ref().is_some_and(|p| {
            p.created.elapsed() > SELECTION_LIFETIME
                || !p.target.focused()
                || p.id != inner.generation.load(Ordering::Acquire)
                || !inner.can_capture()
        }) {
            pending = None;
            hide_bubble(&app);
        }
        let Ok(event) = events.recv_timeout(Duration::from_millis(50)) else {
            continue;
        };
        if !inner.can_capture() {
            down = None;
            pending = None;
            bubble_pressed = false;
            continue;
        }
        let event = if let Event::Mouse(mouse) = event {
            let target = Target::at_point(POINT {
                x: mouse.point.0,
                y: mouse.point.1,
            });
            let Some(event) = route_mouse(
                mouse,
                target,
                bubble_window,
                std::process::id(),
                &mut bubble_pressed,
                &inner,
            ) else {
                continue;
            };
            event
        } else {
            event
        };
        match event {
            Event::Clear => {
                pending = None;
                verified_gesture = None;
                down = None;
                hide_bubble(&app);
            }
            Event::Down(target, time, id) => {
                pending = None;
                verified_gesture = None;
                hide_bubble(&app);
                down = Some((target, time, id));
            }
            Event::Up(target, time, revision) => {
                let start = down.take();
                let gesture = start.is_some_and(|(start, _, id)| {
                    id == inner.generation.load(Ordering::Acquire)
                        && is_selection_gesture(start, target, last_up, time, unsafe {
                            GetDoubleClickTime()
                        })
                });
                last_up = Some((target, time));
                if !gesture || revision != CAPTURE_ACTIVITY.load(Ordering::Acquire) {
                    continue;
                }
                let id = start.unwrap().2;
                let Some(capture) = capture_after_gesture(
                    || {
                        target.focused()
                            && capture_is_current(
                                &inner,
                                id,
                                revision,
                                CAPTURE_ACTIVITY.load(Ordering::Acquire),
                            )
                    },
                    || uia.capture(target, true),
                    thread::sleep,
                ) else {
                    continue;
                };
                if !capture.text.is_empty() || (capture.candidate && capture.error.is_none()) {
                    if capture.candidate {
                        verified_gesture = Some((target, Instant::now()));
                    }
                    pending = Some(Pending {
                        target,
                        id,
                        created: Instant::now(),
                        capture,
                    });
                    if let Err(error) = show_bubble(&app, target.point) {
                        pending = None;
                        let _ = app.emit_to("main", "selection-native-error", error);
                    }
                }
            }
            Event::Shortcut(target, revision) => {
                if !target.focused() {
                    continue;
                }
                let Some(id) =
                    start_shortcut(&inner, revision, CAPTURE_ACTIVITY.load(Ordering::Acquire))
                else {
                    continue;
                };
                let capture = uia.capture(target, false);
                let recent_gesture = verified_gesture.is_some_and(|(previous, created)| {
                    previous.window == target.window && created.elapsed() <= SELECTION_LIFETIME
                });
                pending = None;
                finish_capture(&app, &inner, target, id, revision, capture, recent_gesture);
            }
            Event::Activate(revision) => {
                let Some(previous) = pending.take() else {
                    hide_bubble(&app);
                    continue;
                };
                if !previous.target.focused()
                    || !capture_is_current(
                        &inner,
                        previous.id,
                        revision,
                        CAPTURE_ACTIVITY.load(Ordering::Acquire),
                    )
                {
                    hide_bubble(&app);
                    continue;
                }
                // Re-read to detect cleared selections/password focus before any copy.
                let capture = uia.capture(previous.target, true);
                finish_capture(
                    &app,
                    &inner,
                    previous.target,
                    previous.id,
                    revision,
                    capture,
                    previous.capture.candidate,
                );
            }
            Event::Mouse(_) => unreachable!("raw mouse events are routed above"),
        }
    }
}

fn allows_clipboard_fallback(capture: &Capture, recent_gesture: bool, enabled: bool) -> bool {
    capture.text.is_empty()
        && capture.error.is_none()
        && capture.candidate
        && !capture.known_empty
        && recent_gesture
        && enabled
}

fn finish_capture(
    app: &tauri::AppHandle,
    inner: &Arc<Inner>,
    target: Target,
    id: u64,
    revision: u64,
    mut capture: Capture,
    recent_gesture: bool,
) {
    if !target.focused()
        || !capture_is_current(
            inner,
            id,
            revision,
            CAPTURE_ACTIVITY.load(Ordering::Acquire),
        )
    {
        hide_bubble(app);
        return;
    }
    let mut method = "uia";
    if allows_clipboard_fallback(
        &capture,
        recent_gesture,
        inner.config.lock().unwrap().clipboard_fallback,
    ) {
        let owner = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as usize);
        if let Some(owner) = owner {
            match copy_selection(target, owner, || {
                capture_is_current(
                    inner,
                    id,
                    revision,
                    CAPTURE_ACTIVITY.load(Ordering::Acquire),
                )
            }) {
                Ok(text) => {
                    capture.text = text;
                    method = "clipboard";
                }
                Err(error) => capture.error = Some(error),
            }
        }
    }
    if capture.text.trim().is_empty() && capture.error.is_none() {
        capture.error = Some(
            if capture.known_empty {
                "没有检测到选中的文字，请重新划选后重试。"
            } else {
                "无法安全读取此选区，请手动复制到主窗口。"
            }
            .into(),
        );
    }
    if !target.focused()
        || !capture_is_current(
            inner,
            id,
            revision,
            CAPTURE_ACTIVITY.load(Ordering::Acquire),
        )
    {
        hide_bubble(app);
        return;
    }
    publish(
        app,
        inner,
        id,
        capture.text,
        capture.error,
        method,
        target.point,
    );
}

pub fn make_nonactivating(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                style | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
            );
        }
    }
}

pub fn use_system_corners(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            // Windows 11 owns the radius and clipping. Older Windows versions
            // reject this optional attribute and retain their system geometry.
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &DWMWCP_ROUND as *const _ as _,
                size_of_val(&DWMWCP_ROUND) as u32,
            );
        }
    }
}

pub fn is_foreground(window: &tauri::WebviewWindow) -> Option<bool> {
    let hwnd = window.hwnd().ok()?;
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() {
            None
        } else {
            Some(GetAncestor(foreground, GA_ROOT) == hwnd)
        }
    }
}

struct ClipboardGuard;
impl ClipboardGuard {
    fn open(owner: usize) -> Result<Self, String> {
        for _ in 0..8 {
            if unsafe { OpenClipboard(Some(HWND(owner as _))) }.is_ok() {
                return Ok(Self);
            }
            thread::sleep(Duration::from_millis(15));
        }
        Err("剪贴板正被其他程序使用，请稍后重试。".into())
    }
}
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

struct Memory(HGLOBAL);
impl Memory {
    fn from_bytes(data: &[u8]) -> Result<Self, String> {
        unsafe {
            let memory =
                Self(GlobalAlloc(GMEM_MOVEABLE, data.len().max(1)).map_err(|_| "无法备份剪贴板")?);
            let pointer = GlobalLock(memory.0);
            if pointer.is_null() {
                return Err("无法锁定剪贴板数据".into());
            }
            std::ptr::copy_nonoverlapping(data.as_ptr(), pointer as *mut u8, data.len());
            let _ = GlobalUnlock(memory.0);
            Ok(memory)
        }
    }
    fn transfer(self, format: u32) -> Result<(), String> {
        unsafe {
            SetClipboardData(format, Some(HANDLE(self.0 .0))).map_err(|_| "无法写入剪贴板")?;
            std::mem::forget(self);
            Ok(())
        }
    }
}
impl Drop for Memory {
    fn drop(&mut self) {
        unsafe {
            let _ = GlobalFree(Some(self.0));
        }
    }
}

fn safe_format(format: u32, registered_name: &str) -> bool {
    matches!(format, 1 | 7 | 8 | 13 | 15 | 16 | 17)
        || (format >= 0xC000
            && matches!(
                registered_name,
                "HTML Format"
                    | "Rich Text Format"
                    | "Rich Text Format Without Objects"
                    | "PNG"
                    | "Preferred DropEffect"
            ))
}

unsafe fn read_bytes(format: u32) -> Result<Vec<u8>, String> {
    let handle = GetClipboardData(format).map_err(|_| "无法读取剪贴板格式")?;
    let global = HGLOBAL(handle.0);
    let size = GlobalSize(global);
    if size == 0 || size > MAX_CLIPBOARD_BYTES {
        return Err("剪贴板内容过大或格式无法安全备份，请手动复制。".into());
    }
    let pointer = GlobalLock(global);
    if pointer.is_null() {
        return Err("剪贴板格式无法安全备份，请手动复制。".into());
    }
    let bytes = std::slice::from_raw_parts(pointer as *const u8, size).to_vec();
    let _ = GlobalUnlock(global);
    Ok(bytes)
}

fn backup_clipboard(owner: usize) -> Result<(u32, Vec<(u32, Memory)>), String> {
    let _guard = ClipboardGuard::open(owner)?;
    let mut saved = Vec::new();
    let mut format = 0;
    let mut bytes = 0;
    loop {
        format = unsafe { EnumClipboardFormats(format) };
        if format == 0 {
            break;
        }
        let mut name = [0u16; 128];
        let length = unsafe { GetClipboardFormatNameW(format, &mut name) }.max(0) as usize;
        if !safe_format(format, &String::from_utf16_lossy(&name[..length])) {
            return Err("当前剪贴板包含无法完整恢复的格式，请手动复制到主窗口。".into());
        }
        let data = unsafe { read_bytes(format)? };
        bytes += data.len();
        if bytes > MAX_CLIPBOARD_BYTES || saved.len() >= 64 {
            return Err("剪贴板内容过多，无法安全备份，请手动复制。".into());
        }
        saved.push((format, Memory::from_bytes(&data)?));
    }
    Ok((unsafe { GetClipboardSequenceNumber() }, saved))
}

fn clipboard_matches(
    sequence: u32,
    current: u32,
    source_pid: u32,
    current_owner_pid: u32,
    activity: u64,
    current_activity: u64,
) -> bool {
    sequence == current
        && source_pid != 0
        && source_pid == current_owner_pid
        && activity == current_activity
}

fn modifiers_released() -> bool {
    [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .iter()
        .all(|key| unsafe { GetAsyncKeyState(key.0 as i32) >= 0 })
}

fn key_input(key: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                ..Default::default()
            },
        },
    }
}

fn decode_clipboard_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("复制的文本格式无效。".into());
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_ne_bytes([pair[0], pair[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
    let text = String::from_utf16(&units).map_err(|_| "复制的文本编码无效。")?;
    if text.chars().count() > MAX_CAPTURE_CHARS {
        return Err("所选文本超过 100,000 字符，请缩小选区。".into());
    }
    if text.trim().is_empty() {
        return Err("没有复制到选中的文字，请重新划选。".into());
    }
    Ok(text)
}

fn copy_selection(
    target: Target,
    owner: usize,
    still_current: impl Fn() -> bool,
) -> Result<String, String> {
    if !still_current() {
        return Err("取词请求已失效，请重新划选。".into());
    }
    if !HOOKS_READY.load(Ordering::Acquire) {
        return Err("输入活动检测尚未就绪，请稍后重试或手动复制。".into());
    }
    let deadline = Instant::now() + Duration::from_millis(650);
    while !modifiers_released() && Instant::now() < deadline && still_current() {
        thread::sleep(Duration::from_millis(15));
    }
    if !modifiers_released() || !target.focused() || !still_current() {
        return Err("请释放快捷键并保持原窗口在前台后重试。".into());
    }
    let activity = INPUT_ACTIVITY.load(Ordering::Acquire);
    let (before, backup) = backup_clipboard(owner)?;
    if !target.focused()
        || !still_current()
        || unsafe { GetClipboardSequenceNumber() } != before
        || INPUT_ACTIVITY.load(Ordering::Acquire) != activity
    {
        return Err("剪贴板或原窗口已变化，请重新划选。".into());
    }
    let inputs = [
        key_input(VK_CONTROL, false),
        key_input(VK_C, false),
        key_input(VK_C, true),
        key_input(VK_CONTROL, true),
    ];
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        if sent > 0 {
            unsafe {
                SendInput(
                    &[key_input(VK_C, true), key_input(VK_CONTROL, true)],
                    size_of::<INPUT>() as i32,
                );
            }
        }
        return Err("Windows 阻止了复制操作；管理员权限程序请手动复制。".into());
    }
    let deadline = Instant::now() + Duration::from_millis(650);
    let observed = loop {
        let sequence = unsafe { GetClipboardSequenceNumber() };
        if sequence != before
            || Instant::now() >= deadline
            || !target.focused()
            || INPUT_ACTIVITY.load(Ordering::Acquire) != activity
        {
            break sequence;
        }
        thread::sleep(Duration::from_millis(15));
    };
    if INPUT_ACTIVITY.load(Ordering::Acquire) != activity {
        return Err("复制期间检测到新的输入，已保留当前剪贴板，请重试。".into());
    }
    let _guard = ClipboardGuard::open(owner)?;
    let after = unsafe { GetClipboardSequenceNumber() };
    let owner_pid = unsafe {
        GetClipboardOwner()
            .map(|window| window_process(window))
            .unwrap_or(0)
    };
    if after == before {
        return Err("原程序没有复制选区，请手动复制；未读取旧剪贴板。".into());
    }
    if !target.focused()
        || !clipboard_matches(
            observed,
            after,
            target.process,
            owner_pid,
            activity,
            INPUT_ACTIVITY.load(Ordering::Acquire),
        )
    {
        return Err("复制期间窗口或剪贴板已变化，已保留新的剪贴板内容。".into());
    }
    let text = unsafe { read_bytes(13) }.and_then(|bytes| decode_clipboard_text(&bytes));
    let current_owner = unsafe {
        GetClipboardOwner()
            .map(|window| window_process(window))
            .unwrap_or(0)
    };
    if !target.focused()
        || !clipboard_matches(
            observed,
            unsafe { GetClipboardSequenceNumber() },
            target.process,
            current_owner,
            activity,
            INPUT_ACTIVITY.load(Ordering::Acquire),
        )
    {
        return Err("读取期间剪贴板已变化，已保留新的剪贴板内容。".into());
    }
    // Holding OpenClipboard excludes concurrent changes while restoring. The
    // clipboard is never emptied before all backup buffers have been allocated.
    unsafe {
        EmptyClipboard().map_err(|_| "无法恢复剪贴板，复制内容仍保留在剪贴板中。")?;
    }
    for (format, memory) in backup {
        memory.transfer(format)?;
    }
    text
}

pub fn copy_text(owner: usize, text: &str) -> Result<(), String> {
    let bytes: Vec<u8> = text
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_ne_bytes)
        .collect();
    let memory = Memory::from_bytes(&bytes)?;
    let _guard = ClipboardGuard::open(owner)?;
    unsafe {
        EmptyClipboard().map_err(|_| "无法写入剪贴板")?;
    }
    memory.transfer(13)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(point: (i32, i32)) -> Target {
        Target {
            window: 1,
            process: 100,
            point,
        }
    }

    fn mouse(message: u32, revision: u64) -> MouseEvent {
        MouseEvent {
            message,
            point: (10, 10),
            time: 100,
            revision,
        }
    }

    #[test]
    fn mouseup_selection_can_become_available_after_an_initial_empty_uia_read() {
        let mut reads = 0;
        let mut waits = Vec::new();
        let result = capture_after_gesture(
            || true,
            || {
                reads += 1;
                if reads == 1 {
                    Capture {
                        known_empty: true,
                        ..Default::default()
                    }
                } else {
                    Capture {
                        text: "Selected text".into(),
                        ..Default::default()
                    }
                }
            },
            |duration| waits.push(duration),
        )
        .unwrap();
        assert_eq!(result.text, "Selected text");
        assert_eq!(reads, 2);
        assert_eq!(
            waits,
            vec![Duration::from_millis(70), Duration::from_millis(100)]
        );
    }

    #[test]
    fn gestures_do_not_retry_password_errors_or_unresponsive_providers() {
        for error in ["password", "timeout"] {
            let mut reads = 0;
            let result = capture_after_gesture(
                || true,
                || {
                    reads += 1;
                    Capture {
                        error: Some(error.into()),
                        ..Default::default()
                    }
                },
                |_| {},
            )
            .unwrap();
            assert_eq!(reads, 1);
            assert_eq!(result.error.as_deref(), Some(error));
        }
    }

    #[test]
    fn gestures_stop_before_retry_when_input_or_focus_changes() {
        let valid = std::cell::Cell::new(true);
        let mut reads = 0;
        let mut waits = 0;
        let result = capture_after_gesture(
            || valid.get(),
            || {
                reads += 1;
                Capture::default()
            },
            |_| {
                waits += 1;
                if waits == 2 {
                    valid.set(false);
                }
            },
        );
        assert!(result.is_none());
        assert_eq!(reads, 1);
        // A change during the provider call also discards its text.
        valid.set(true);
        let result = capture_after_gesture(
            || valid.get(),
            || {
                valid.set(false);
                Capture {
                    text: "Stale selected text".into(),
                    ..Default::default()
                }
            },
            |_| {},
        );
        assert!(result.is_none());
    }

    #[test]
    fn first_native_bubble_click_activates_without_dom_click_or_invalidating_selection() {
        let state = super::super::SelectionState::default();
        state.0.generation.store(42, Ordering::Relaxed);
        let bubble = Target {
            window: 2,
            process: 200,
            point: (10, 10),
        };
        let mut pressed = false;
        assert!(route_mouse(
            mouse(WM_LBUTTONDOWN, 10),
            Some(bubble),
            2,
            200,
            &mut pressed,
            &state.0
        )
        .is_none());
        assert!(pressed);
        assert!(matches!(
            route_mouse(
                mouse(WM_LBUTTONUP, 11),
                Some(bubble),
                2,
                200,
                &mut pressed,
                &state.0
            ),
            Some(Event::Activate(11))
        ));
        assert!(!pressed);
        assert_eq!(state.0.generation.load(Ordering::Relaxed), 42);
        // A stray mouse-up cannot trigger a second translation.
        assert!(route_mouse(
            mouse(WM_LBUTTONUP, 12),
            Some(bubble),
            2,
            200,
            &mut pressed,
            &state.0
        )
        .is_none());
    }

    #[test]
    fn external_and_own_window_clicks_invalidate_bubble_without_activating_it() {
        let state = super::super::SelectionState::default();
        let mut pressed = true;
        assert!(matches!(
            route_mouse(
                mouse(WM_LBUTTONDOWN, 10),
                Some(target((10, 10))),
                2,
                200,
                &mut pressed,
                &state.0
            ),
            Some(Event::Down(_, 100, 1))
        ));
        assert!(!pressed);
        let own = Target {
            process: 200,
            ..target((10, 10))
        };
        assert!(matches!(
            route_mouse(
                mouse(WM_LBUTTONDOWN, 11),
                Some(own),
                2,
                200,
                &mut pressed,
                &state.0
            ),
            Some(Event::Clear)
        ));
        assert_eq!(state.0.generation.load(Ordering::Relaxed), 2);
        assert!(matches!(
            route_mouse(
                mouse(WM_MOUSEWHEEL, 12),
                None,
                2,
                200,
                &mut pressed,
                &state.0
            ),
            Some(Event::Clear)
        ));
        assert_eq!(state.0.generation.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn dragging_into_or_out_of_bubble_does_not_activate_it() {
        let state = super::super::SelectionState::default();
        let bubble = Target {
            window: 2,
            process: 200,
            ..target((10, 10))
        };
        let mut pressed = false;
        route_mouse(
            mouse(WM_LBUTTONDOWN, 1),
            Some(target((10, 10))),
            2,
            200,
            &mut pressed,
            &state.0,
        );
        assert!(route_mouse(
            mouse(WM_LBUTTONUP, 2),
            Some(bubble),
            2,
            200,
            &mut pressed,
            &state.0
        )
        .is_none());
        route_mouse(
            mouse(WM_LBUTTONDOWN, 3),
            Some(bubble),
            2,
            200,
            &mut pressed,
            &state.0,
        );
        assert!(matches!(
            route_mouse(
                mouse(WM_LBUTTONUP, 4),
                Some(target((10, 10))),
                2,
                200,
                &mut pressed,
                &state.0
            ),
            Some(Event::Up(_, _, 4))
        ));
        assert!(!pressed);
    }

    #[test]
    fn delayed_capture_rejects_new_pointer_input_before_coordinator_routes_it() {
        let state = super::super::SelectionState::default();
        state.0.enabled.store(true, Ordering::Relaxed);
        state.0.generation.store(42, Ordering::Relaxed);
        assert!(capture_is_current(&state.0, 42, 10, 10));
        // Hook counters advance immediately even when UIA blocks the coordinator.
        assert!(!capture_is_current(&state.0, 42, 10, 11));
        assert!(!capture_is_current(&state.0, 41, 10, 10));
        state.0.busy.store(true, Ordering::Relaxed);
        assert!(!capture_is_current(&state.0, 42, 10, 10));
        state.0.busy.store(false, Ordering::Relaxed);
        state.0.enabled.store(false, Ordering::Relaxed);
        assert!(!capture_is_current(&state.0, 42, 10, 10));
    }

    #[test]
    fn shortcut_after_queued_mouse_events_gets_a_fresh_id_but_rejects_later_input() {
        let state = super::super::SelectionState::default();
        state.0.enabled.store(true, Ordering::Relaxed);
        let mut pressed = false;
        route_mouse(
            mouse(WM_LBUTTONDOWN, 1),
            Some(target((10, 10))),
            2,
            200,
            &mut pressed,
            &state.0,
        );
        assert_eq!(start_shortcut(&state.0, 2, 2), Some(2));
        assert!(capture_is_current(&state.0, 2, 2, 2));
        assert_eq!(start_shortcut(&state.0, 2, 3), None);
        assert_eq!(state.0.generation.load(Ordering::Relaxed), 2);
        state.0.paused.store(true, Ordering::Relaxed);
        assert_eq!(start_shortcut(&state.0, 3, 3), None);
    }

    #[test]
    fn only_drag_and_double_click_are_selection_gestures() {
        let start = target((10, 10));
        assert!(!is_selection_gesture(
            start,
            target((12, 12)),
            None,
            100,
            500
        ));
        assert!(is_selection_gesture(
            start,
            target((50, 10)),
            None,
            100,
            500
        ));
        assert!(is_selection_gesture(
            start,
            start,
            Some((start, 100)),
            400,
            500
        ));
        assert!(!is_selection_gesture(
            start,
            start,
            Some((start, 100)),
            900,
            500
        ));
        let another = Target { window: 2, ..start };
        assert!(!is_selection_gesture(
            start,
            another,
            Some((start, 100)),
            400,
            500
        ));
    }

    #[test]
    fn copy_fallback_needs_verified_text_gesture_and_never_known_empty_or_protected() {
        let mut capture = Capture {
            candidate: true,
            ..Default::default()
        };
        assert!(allows_clipboard_fallback(&capture, true, true));
        assert!(!allows_clipboard_fallback(&capture, false, true));
        assert!(!allows_clipboard_fallback(&capture, true, false));
        capture.known_empty = true;
        assert!(!allows_clipboard_fallback(&capture, true, true));
        capture.known_empty = false;
        capture.error = Some("password".into());
        assert!(!allows_clipboard_fallback(&capture, true, true));
        capture.error = None;
        capture.text = "already selected".into();
        assert!(!allows_clipboard_fallback(&capture, true, true));
    }

    #[test]
    fn hung_provider_times_out_without_queuing_more_work_and_recovers() {
        let (queue, requests) = mpsc::sync_channel::<Query>(1);
        let occupied = Arc::new(AtomicBool::new(false));
        let worker = UiaWorker {
            queue,
            occupied: occupied.clone(),
        };
        let (release, released) = mpsc::sync_channel(1);
        let (returned, result_returned) = mpsc::sync_channel(1);
        let provider = thread::spawn(move || {
            let first = requests.recv().unwrap();
            released.recv().unwrap();
            occupied.store(false, Ordering::Release);
            let _ = first.reply.try_send(Capture::default());
            returned.send(()).unwrap();
            let second = requests.recv().unwrap();
            occupied.store(false, Ordering::Release);
            second
                .reply
                .send(Capture {
                    text: "recovered".into(),
                    ..Default::default()
                })
                .unwrap();
        });
        assert!(worker
            .capture(target((0, 0)), false)
            .error
            .unwrap()
            .contains("超时"));
        assert!(worker
            .capture(target((0, 0)), false)
            .error
            .unwrap()
            .contains("仍在等待"));
        release.send(()).unwrap();
        result_returned.recv().unwrap();
        assert_eq!(worker.capture(target((0, 0)), false).text, "recovered");
        provider.join().unwrap();
    }
    #[test]
    fn restore_only_safe_memory_formats_and_known_registered_formats() {
        for format in [1, 7, 8, 13, 15, 16, 17] {
            assert!(safe_format(format, ""));
        }
        for format in [2, 3, 9, 14] {
            assert!(!safe_format(format, ""));
        }
        assert!(safe_format(0xC001, "HTML Format"));
        assert!(!safe_format(0xC001, "Ole Private Data"));
        assert!(!safe_format(0xC001, "unknown"));
    }
    #[test]
    fn concurrent_clipboard_changes_never_pass_restore_guard() {
        assert!(clipboard_matches(10, 10, 50, 50, 3, 3));
        assert!(!clipboard_matches(10, 11, 50, 50, 3, 3));
        assert!(!clipboard_matches(10, 10, 50, 60, 3, 3));
        assert!(!clipboard_matches(10, 10, 0, 0, 3, 3));
        assert!(!clipboard_matches(10, 10, 50, 50, 3, 4));
    }
    #[test]
    fn clipboard_unicode_decoder_rejects_invalid_empty_and_oversized_data() {
        assert_eq!(
            decode_clipboard_text(&[0x2d, 0x4e, 0x87, 0x65, 0, 0]).unwrap(),
            "中文"
        );
        assert!(decode_clipboard_text(&[0]).is_err());
        assert!(decode_clipboard_text(&[0, 0]).is_err());
        assert!(decode_clipboard_text(&[0, 0xd8, 0, 0]).is_err());
        assert!(decode_clipboard_text(
            &"a".repeat(MAX_CAPTURE_CHARS + 1)
                .encode_utf16()
                .flat_map(u16::to_ne_bytes)
                .collect::<Vec<_>>()
        )
        .is_err());
    }
}
