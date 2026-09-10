use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
struct TimerState {
    generation: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
struct TimerFinishedPayload {
    task_name: String,
}

#[tauri::command]
fn schedule_timer(
    app: tauri::AppHandle,
    state: State<'_, TimerState>,
    duration_ms: u64,
    task_name: String,
    notify: bool,
) -> u64 {
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let generation_state = Arc::clone(&state.generation);

    thread::spawn(move || {
        let deadline = SystemTime::now() + Duration::from_millis(duration_ms);
        loop {
            if generation_state.load(Ordering::SeqCst) != generation {
                return;
            }

            match deadline.duration_since(SystemTime::now()) {
                Ok(remaining) => thread::sleep(remaining.min(Duration::from_secs(1))),
                Err(_) => break,
            }
        }

        if generation_state.load(Ordering::SeqCst) != generation {
            return;
        }

        if notify {
            let _ = app
                .notification()
                .builder()
                .title(task_name.clone())
                .body("Your timer has finished.")
                .show();
        }

        let _ = app.emit(
            "timer-finished",
            TimerFinishedPayload {
                task_name: task_name.clone(),
            },
        );
    });

    generation
}

#[tauri::command]
fn cancel_timer(state: State<'_, TimerState>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TimerState::default())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show Task Timer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Task Timer")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![schedule_timer, cancel_timer])
        .run(tauri::generate_context!())
        .expect("error while running Task Timer");
}
