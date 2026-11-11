use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Json,
    Md,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Md => "md",
        }
    }
}

fn authorize(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("此窗口无权导出历史记录".into())
    }
}

// Only paths returned by the native save dialog reach this private function.
// Write beside the destination first, so a failed write preserves an existing export.
fn write_selected(path: Option<PathBuf>, content: &str) -> Result<Option<String>, String> {
    let Some(path) = path else { return Ok(None) };
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let temporary = path.with_file_name(format!(
        ".lat-export-{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("无法创建导出文件：{error}"))?;
    let written = file
        .write_all(content.as_bytes())
        .and_then(|()| file.sync_all());
    drop(file);
    let result = written.and_then(|()| fs::rename(&temporary, &path));
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法保存导出文件：{error}"));
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn save_history_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    format: ExportFormat,
    content: String,
) -> Result<Option<String>, String> {
    authorize(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let extension = format.extension();
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导出翻译历史")
            .add_filter(
                if extension == "json" {
                    "JSON"
                } else {
                    "Markdown"
                },
                &[extension],
            )
            .set_file_name(format!("LAT-history.{extension}"))
            .blocking_save_file();
        let path = selected
            .map(|file| {
                file.into_path()
                    .map_err(|error| format!("无法读取保存位置：{error}"))
            })
            .transpose()?;
        write_selected(path, &content)
    })
    .await
    .map_err(|error| format!("导出任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_main_window_can_export() {
        assert!(authorize("main").is_ok());
        for label in ["selection", "selection-bubble", "other", ""] {
            assert!(authorize(label).is_err());
        }
    }

    #[test]
    fn cancel_writes_nothing() {
        assert_eq!(write_selected(None, "不应写入").unwrap(), None);
    }

    #[test]
    fn saves_complete_utf8_and_reports_actual_path_and_errors() {
        let directory =
            std::env::temp_dir().join(format!("lat-export-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("翻译历史.json");
        let content = format!(
            "{{\"原文\":\"{}\",\"译文\":\"bonjour 🌍\"}}",
            "完整正文\n".repeat(20000)
        );
        assert_eq!(
            write_selected(Some(path.clone()), &content).unwrap(),
            Some(path.to_string_lossy().into_owned())
        );
        assert_eq!(fs::read(&path).unwrap(), content.as_bytes());
        #[cfg(windows)]
        {
            let original_permissions = fs::metadata(&path).unwrap().permissions();
            let mut readonly = original_permissions.clone();
            readonly.set_readonly(true);
            fs::set_permissions(&path, readonly).unwrap();
            let failed_replace = write_selected(Some(path.clone()), "不应覆盖原文件");
            fs::set_permissions(&path, original_permissions).unwrap();
            assert!(failed_replace.is_err());
            assert_eq!(
                fs::read(&path).unwrap(),
                content.as_bytes(),
                "failed replacement preserves the previous export byte for byte"
            );
            assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        }
        assert!(write_selected(Some(directory.join("missing").join("file.md")), "内容").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert!(write_selected(Some(directory.clone()), "不能覆盖目录").is_err());
        assert_eq!(
            fs::read_dir(&directory).unwrap().count(),
            1,
            "failed replacement leaves no temporary file"
        );
        write_selected(Some(path.clone()), "替换后的完整正文").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "替换后的完整正文");
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
