use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Url};

#[derive(Default)]
pub struct AppState {
    pub backend_child: Arc<Mutex<Option<Child>>>,
    pub port: Arc<Mutex<u16>>,
    pub downloads_dir: Arc<Mutex<PathBuf>>,
    pub app_data_dir: Arc<Mutex<PathBuf>>,
}

#[derive(Serialize, Deserialize, Default)]
struct SavedSettings {
    pub downloads_dir: Option<String>,
}

fn get_free_port() -> u16 {
    // In dev (debug) use fixed 8000 so Vite's /api proxy stays valid.
    // In release use a random free port to avoid collisions with other apps.
    if cfg!(debug_assertions) {
        return 8000;
    }
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8000)
}

fn get_default_downloads_dir() -> PathBuf {
    dirs::audio_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("Music"))
        .join("Unstream")
}

fn load_saved_settings(app_data_dir: &PathBuf) -> SavedSettings {
    let settings_file = app_data_dir.join("settings.json");
    if let Ok(content) = fs::read_to_string(settings_file) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        SavedSettings::default()
    }
}

fn save_settings(app_data_dir: &PathBuf, settings: &SavedSettings) -> Result<(), String> {
    let _ = fs::create_dir_all(app_data_dir);
    let settings_file = app_data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_file, json).map_err(|e| e.to_string())
}

fn find_backend_binary(app_handle: &AppHandle) -> PathBuf {
    let binary_name = if cfg!(windows) {
        "unstream-api.exe"
    } else {
        "unstream-api"
    };

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let bundled = resource_dir.join("unstream-api").join(binary_name);
        if bundled.exists() {
            return bundled;
        }
        let bundled_direct = resource_dir.join(binary_name);
        if bundled_direct.exists() {
            return bundled_direct;
        }
    }

    let candidates = [
        PathBuf::from("../../backend/dist/unstream-api").join(binary_name),
        PathBuf::from("backend/dist/unstream-api").join(binary_name),
        PathBuf::from("../backend/dist/unstream-api").join(binary_name),
    ];

    for candidate in candidates {
        if candidate.exists() {
            if let Ok(canon) = candidate.canonicalize() {
                return canon;
            }
            return candidate;
        }
    }

    PathBuf::from(binary_name)
}

fn find_bin_dir(app_handle: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let bundled_bin = resource_dir.join("bin");
        if bundled_bin.exists() {
            return bundled_bin;
        }
    }

    let candidates = [
        PathBuf::from("bin"),
        PathBuf::from("src-tauri/bin"),
        PathBuf::from("desktop/src-tauri/bin"),
        PathBuf::from("../desktop/src-tauri/bin"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            if let Ok(canon) = candidate.canonicalize() {
                return canon;
            }
            return candidate;
        }
    }

    PathBuf::from("bin")
}

fn find_static_dir(app_handle: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let bundled_dist = resource_dir.join("dist");
        if bundled_dist.exists() {
            return bundled_dist;
        }
    }

    let candidates = [
        PathBuf::from("../../frontend/dist"),
        PathBuf::from("frontend/dist"),
        PathBuf::from("../frontend/dist"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            if let Ok(canon) = candidate.canonicalize() {
                return canon;
            }
            return candidate;
        }
    }

    PathBuf::from("dist")
}

fn spawn_backend(
    app_handle: &AppHandle,
    state: &AppState,
    port: u16,
) -> Result<Child, String> {
    let backend_bin = find_backend_binary(app_handle);
    let bin_dir = find_bin_dir(app_handle);
    let static_dir = find_static_dir(app_handle);

    let app_data_dir = state.app_data_dir.lock().unwrap().clone();
    let app_cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Unstream");
    let downloads_dir = state.downloads_dir.lock().unwrap().clone();

    let _ = fs::create_dir_all(&app_data_dir);
    let _ = fs::create_dir_all(&app_cache_dir);
    let _ = fs::create_dir_all(&downloads_dir);

    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = if bin_dir.exists() {
        format!("{}{}{}", bin_dir.display(), path_sep, current_path)
    } else {
        current_path
    };

    println!("[Unstream Desktop] Spawning backend: {}", backend_bin.display());
    println!("[Unstream Desktop] Static dir: {}", static_dir.display());
    println!("[Unstream Desktop] Downloads dir: {}", downloads_dir.display());
    println!("[Unstream Desktop] Bin PATH prepend: {}", bin_dir.display());

    let mut cmd = std::process::Command::new(&backend_bin);
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("PATH", new_path)
        .env("UNSTREAM_HOST", "127.0.0.1")
        .env("UNSTREAM_PORT", port.to_string())
        .env(
            "UNSTREAM_STATIC_DIR",
            static_dir.to_str().unwrap_or_default(),
        )
        .env(
            "UNSTREAM_DOWNLOADS_DIR",
            downloads_dir.to_str().unwrap_or_default(),
        )
        .env("DOWNLOADS_TTL_HOURS", "0")
        .env("MAX_DOWNLOADS_GB", "0")
        .env("RATE_LIMITS_ENABLED", "false")
        .env("DOWNLOAD_WORKERS", "4")
        .env(
            "LYRICS_DB_PATH",
            app_data_dir
                .join("lyrics.db")
                .to_str()
                .unwrap_or_default(),
        )
        .env(
            "ANALYTICS_DB_PATH",
            app_data_dir
                .join("analytics.db")
                .to_str()
                .unwrap_or_default(),
        )
        .env(
            "YTDLP_CACHE_DIR",
            app_cache_dir.join("ytdlp").to_str().unwrap_or_default(),
        );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn backend binary '{}': {}",
            backend_bin.display(),
            e
        )
    })
}

async fn wait_for_health(port: u16, max_retries: u32) -> bool {
    for i in 0..max_retries {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
            if stream
                .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .is_ok()
            {
                let mut buf = [0u8; 512];
                if let Ok(n) = stream.read(&mut buf) {
                    let resp = std::str::from_utf8(&buf[..n]).unwrap_or("");
                    if resp.contains("200") {
                        println!("[Unstream Desktop] Backend healthcheck passed on attempt {}", i + 1);
                        return true;
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

#[tauri::command]
fn get_downloads_dir(state: State<AppState>) -> String {
    state.downloads_dir.lock().unwrap().to_string_lossy().to_string()
}

#[tauri::command]
fn set_downloads_dir(
    path: String,
    state: State<AppState>,
) -> Result<(), String> {
    let new_path = PathBuf::from(&path);
    if !new_path.is_dir() {
        fs::create_dir_all(&new_path).map_err(|e| e.to_string())?;
    }
    *state.downloads_dir.lock().unwrap() = new_path;

    let app_data_dir = state.app_data_dir.lock().unwrap().clone();
    save_settings(
        &app_data_dir,
        &SavedSettings {
            downloads_dir: Some(path),
        },
    )
}

#[tauri::command]
fn get_desktop_info(state: State<AppState>) -> serde_json::Value {
    let port = *state.port.lock().unwrap();
    let downloads_dir = state.downloads_dir.lock().unwrap().to_string_lossy().to_string();
    serde_json::json!({
        "isDesktop": true,
        "port": port,
        "downloadsDir": downloads_dir,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

#[tauri::command]
fn start_dragging(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_maximize(window: tauri::Window) -> Result<(), String> {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_progress_bar(window: tauri::Window, progress: Option<f64>) -> Result<(), String> {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    if let Some(p) = progress {
        let clamped = p.clamp(0.0, 1.0);
        window
            .set_progress_bar(ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some((clamped * 100.0) as u64),
            })
            .map_err(|e| e.to_string())?;
    } else {
        window
            .set_progress_bar(ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn focus_window(window: tauri::Window) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let _ = window.unminimize();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::default();

    let app_data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Unstream");
    let saved_settings = load_saved_settings(&app_data_dir);
    let initial_downloads_dir = saved_settings
        .downloads_dir
        .map(PathBuf::from)
        .unwrap_or_else(get_default_downloads_dir);

    *app_state.app_data_dir.lock().unwrap() = app_data_dir;
    *app_state.downloads_dir.lock().unwrap() = initial_downloads_dir;

    let app_child_cleanup = app_state.backend_child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Second instance: focus existing window and forward any URL arg
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                // Forward Spotify/Deezer links if passed as CLI arg
                for arg in args.iter().skip(1) {
                    if arg.contains("spotify.com")
                        || arg.contains("deezer.com")
                        || arg.contains("youtube.com")
                        || arg.contains("youtu.be")
                        || arg.contains("soundcloud.com")
                        || arg.contains("music.apple.com")
                    {
                        let _ = window.emit("deep-link", arg.clone());
                        break;
                    }
                }
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            let port = get_free_port();
            *state.port.lock().unwrap() = port;

            // Restore deep-link from initial launch args as well
            let initial_url = std::env::args().skip(1).find(|a| {
                a.contains("spotify.com")
                    || a.contains("deezer.com")
                    || a.contains("youtube.com")
                    || a.contains("youtu.be")
                    || a.contains("soundcloud.com")
                    || a.contains("music.apple.com")
            });

            let child = spawn_backend(&app_handle, &state, port)
                .expect("Failed to spawn backend process");
            *state.backend_child.lock().unwrap() = Some(child);

            let is_dev = cfg!(debug_assertions);
            let handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let ok = wait_for_health(port, 80).await;
                if ok {
                    if is_dev {
                        // In dev, Tauri already loads Vite (devUrl). No navigate needed.
                        // Just forward deep-link via event so frontend can handle it.
                        if let Some(url_arg) = initial_url {
                            if let Some(window) = handle_clone.get_webview_window("main") {
                                let _ = window.emit("deep-link", url_arg);
                            }
                        }
                    } else if let Some(window) = handle_clone.get_webview_window("main") {
                        let target_url = if let Some(url_arg) = initial_url {
                            let mut u = Url::parse(&format!("http://127.0.0.1:{}/", port)).unwrap();
                            u.query_pairs_mut().append_pair("url", &url_arg);
                            u.to_string()
                        } else {
                            format!("http://127.0.0.1:{}/", port)
                        };
                        if let Ok(url) = Url::parse(&target_url) {
                            let _ = window.navigate(url);
                        }
                    }
                } else {
                    eprintln!("[Unstream Desktop] Backend failed to become healthy on port {}", port);
                    if let Some(window) = handle_clone.get_webview_window("main") {
                        let _ = window.emit("backend-error", "Backend failed to start");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_downloads_dir,
            set_downloads_dir,
            get_desktop_info,
            start_dragging,
            toggle_maximize,
            minimize_window,
            close_window,
            set_progress_bar,
            focus_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = app_child_cleanup.lock().unwrap().take() {
                    let pid = child.id();
                    println!("[Unstream Desktop] Stopping backend pid {}", pid);
                    let _ = child.kill();
                    // Give it a moment to flush DBs
                    std::thread::sleep(Duration::from_millis(300));
                    let _ = child.wait();
                }
            }
        });
}
