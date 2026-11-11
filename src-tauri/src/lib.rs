#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, RunEvent};
mod gateway;
mod history_export;
mod selection;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            selection::show_main(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(gateway::GatewayState::default())
        .manage(selection::SelectionState::default())
        .invoke_handler(tauri::generate_handler![
            gateway::start_gateway,
            gateway::stop_gateway,
            gateway::gateway_session,
            history_export::save_history_export,
            selection::selection_configure,
            selection::selection_get_config,
            selection::selection_snapshot,
            selection::selection_activate,
            selection::selection_dismiss,
            selection::selection_set_busy,
            selection::selection_set_pinned,
            selection::selection_start_dragging,
            selection::selection_open_main,
            selection::selection_copy,
        ])
        .setup(|app| {
            selection::setup(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");
    app.run(|app, event| match event {
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            if selection::close_to_tray(app) {
                api.prevent_close();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            } else {
                app.exit(0);
            }
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "selection" || label == "selection-bubble" => {
            api.prevent_close();
            selection::dismiss(app);
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Focused(false),
            ..
        } if label == "selection" => {
            selection::on_focus_lost(app);
        }
        RunEvent::ExitRequested { api, .. } => gateway::request_exit(app, api),
        _ => {}
    });
}
