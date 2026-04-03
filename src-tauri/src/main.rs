#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;

use db::{Database, ImportResult};
use models::{Tag, Todo, TagTimeStat};
use std::sync::Arc;
use tauri::Manager;
use std::process::Command;
use tauri::{CustomMenuItem, SystemTrayMenu, SystemTrayMenuItem, SystemTray};

struct AppState {
    db: Arc<Database>,
}

fn build_tray_menu(db: &Database) -> SystemTrayMenu {
    let mut menu = SystemTrayMenu::new();

    // Running tasks
    if let Ok(todos) = db.get_todos(None, None) {
        let running: Vec<&Todo> = todos.iter().filter(|t| t.timer_status == "running").collect();
        if !running.is_empty() {
            for t in &running {
                let label = format!("▶ {}", t.title);
                menu = menu.add_item(
                    CustomMenuItem::new(format!("complete_{}", t.id), label)
                );
            }
            menu = menu.add_native_item(SystemTrayMenuItem::Separator);
            menu = menu.add_item(CustomMenuItem::new("complete_all", "✓ 完成所有任务"));
            menu = menu.add_item(CustomMenuItem::new("pause_all", "⏸ 暂停所有任务"));
        } else {
            menu = menu.add_item(CustomMenuItem::new("no_task", "暂无运行中的任务").disabled());
        }
    }

    menu = menu.add_native_item(SystemTrayMenuItem::Separator);
    menu = menu.add_item(CustomMenuItem::new("show", "显示窗口"));
    menu = menu.add_item(CustomMenuItem::new("quit", "退出"));
    menu
}

// ── Tag commands ──

#[tauri::command]
fn get_tags(state: tauri::State<AppState>) -> Result<Vec<Tag>, String> {
    state.db.get_tags().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_tag(state: tauri::State<AppState>, name: String, color: String, icon: Option<String>) -> Result<Tag, String> {
    state.db.create_tag(&name, &color, icon.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_tag(state: tauri::State<AppState>, id: i64, name: String, color: String, icon: Option<String>) -> Result<(), String> {
    state.db.update_tag(id, &name, &color, icon.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_tag(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_tag(id).map_err(|e| e.to_string())
}

// ── Todo commands ──

#[tauri::command]
fn get_todos(state: tauri::State<AppState>, status: Option<String>, today_start: Option<i64>) -> Result<Vec<Todo>, String> {
    state.db.get_todos(status.as_deref(), today_start).map_err(|e| e.to_string())
}

#[tauri::command]
fn archive_old_completed(state: tauri::State<AppState>, today_start: i64) -> Result<i64, String> {
    state.db.archive_old_completed(today_start).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_todo(state: tauri::State<AppState>, title: String, tag_ids: Vec<i64>) -> Result<Todo, String> {
    state.db.create_todo(&title, &tag_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_todo(state: tauri::State<AppState>, id: i64, title: String, tag_ids: Vec<i64>, elapsed_sec: Option<i64>) -> Result<(), String> {
    state.db.update_todo(id, &title, &tag_ids, elapsed_sec).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_todo(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_todo(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn complete_todo(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.complete_todo(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn archive_todo(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.archive_todo(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn reopen_todo(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.reopen_todo(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_timer(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.start_timer(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn pause_timer(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    state.db.pause_timer(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_todo_time(state: tauri::State<AppState>, id: i64, elapsed_sec: i64) -> Result<(), String> {
    state.db.update_todo_time(id, elapsed_sec).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_tag_stats(state: tauri::State<AppState>, start_ts: i64, end_ts: i64) -> Result<Vec<TagTimeStat>, String> {
    state.db.get_tag_stats(start_ts, end_ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_todos_by_date(state: tauri::State<AppState>, start_ts: i64, end_ts: i64) -> Result<Vec<Todo>, String> {
    state.db.get_todos_by_date(start_ts, end_ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_todo_dates(state: tauri::State<AppState>, start_ts: i64, end_ts: i64, tz_offset_sec: Option<i64>) -> Result<Vec<(i64, i64)>, String> {
    state.db.get_todo_dates(start_ts, end_ts, tz_offset_sec).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_todos(state: tauri::State<AppState>, query: String) -> Result<Vec<Todo>, String> {
    state.db.search_todos(&query).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_todos(state: tauri::State<AppState>, path: String) -> Result<(), String> {
    state.db.export_todos(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_todos(state: tauri::State<AppState>, path: String) -> Result<ImportResult, String> {
    state.db.import_todos(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_file(state: tauri::State<AppState>, path: String) -> Result<ImportResult, String> {
    state.db.import_file(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    let app_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let app_name = app_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("悬浮待办");
    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to get the name of every login item")
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains(app_name))
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    let app_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let app_bundle = app_path.parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| app_path.to_string_lossy().to_string());
    let app_name = app_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("悬浮待办");
    let script = if enabled {
        format!(
            "tell application \"System Events\" to make login item at end with properties {{path:\"{}\", hidden:false}}",
            app_bundle
        )
    } else {
        format!(
            "tell application \"System Events\" to delete login item \"{}\"",
            app_name
        )
    };
    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn complete_all_running(state: tauri::State<AppState>) -> Result<(), String> {
    let todos = state.db.get_todos(None, None).map_err(|e| e.to_string())?;
    for t in todos {
        if t.timer_status == "running" {
            state.db.complete_todo(t.id).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn main() {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("floating-todo");
    let db_path = data_dir.join("data.db");
    let db = Arc::new(Database::new(db_path).expect("Failed to initialize database"));

    let app_state = AppState { db };

    let tray_menu = build_tray_menu(&app_state.db);
    let tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::NSWindow;
                let win = app.get_window("main").unwrap();
                let ns_win = win.ns_window().unwrap() as cocoa::base::id;
                unsafe { ns_win.setHasShadow_(cocoa::base::NO); }
            }
            Ok(())
        })
        .system_tray(tray)
        .on_system_tray_event(|app, event| {
            match event {
                tauri::SystemTrayEvent::LeftClick { .. } => {
                    if let Some(window) = app.get_window("main") {
                        window.show().ok();
                        window.set_focus().ok();
                    }
                }
                tauri::SystemTrayEvent::MenuItemClick { id, .. } => {
                    let state: tauri::State<AppState> = app.state();
                    if id == "show" {
                        if let Some(window) = app.get_window("main") {
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    } else if id == "quit" {
                        std::process::exit(0);
                    } else if id == "complete_all" {
                        if let Ok(todos) = state.db.get_todos(None, None) {
                            for t in todos {
                                if t.timer_status == "running" {
                                    state.db.complete_todo(t.id).ok();
                                }
                            }
                        }
                    } else if id == "pause_all" {
                        if let Ok(todos) = state.db.get_todos(None, None) {
                            for t in todos {
                                if t.timer_status == "running" {
                                    state.db.pause_timer(t.id).ok();
                                }
                            }
                        }
                    } else if id.starts_with("complete_") {
                        if let Ok(tid) = id.trim_start_matches("complete_").parse::<i64>() {
                            state.db.complete_todo(tid).ok();
                        }
                    }
                    // Rebuild tray menu to reflect changes
                    let new_menu = build_tray_menu(&state.db);
                    app.tray_handle().set_menu(new_menu).ok();
                }
                _ => {}
            }
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                event.window().hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tags,
            create_tag,
            update_tag,
            delete_tag,
            get_todos,
            create_todo,
            update_todo,
            delete_todo,
            complete_todo,
            archive_todo,
            reopen_todo,
            start_timer,
            pause_timer,
            update_todo_time,
            get_tag_stats,
            export_todos,
            import_todos,
            get_autostart,
            set_autostart,
            complete_all_running,
            archive_old_completed,
            get_todos_by_date,
            get_todo_dates,
            search_todos,
            import_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
