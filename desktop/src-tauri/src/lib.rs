use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_window_state::StateFlags;

#[derive(Default)]
pub struct AppState {
    pub backend_child: Arc<Mutex<Option<Child>>>,
    pub port: Arc<Mutex<u16>>,
    pub downloads_dir: Arc<Mutex<PathBuf>>,
    pub app_data_dir: Arc<Mutex<PathBuf>>,
    /// Set once the sidecar answers /health and the main window is live.
    /// Links arriving before that are queued in `pending_link` instead.
    pub backend_ready: Arc<Mutex<bool>>,
    pub pending_link: Arc<Mutex<Option<String>>>,
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

/// Hosts we know how to resolve. Mirrors URL_PATTERNS in frontend/src/lib/api.ts —
/// a link the frontend can't open must never be forwarded to it.
const CATALOG_HOSTS: [&str; 6] = [
    "spotify.com",
    "deezer.com",
    "youtube.com",
    "youtu.be",
    "soundcloud.com",
    "music.apple.com",
];

/// Normalise anything that can arrive as "open this" into a catalog URL:
/// a bare Spotify/Deezer/… link, or our own `unstream://open?url=<encoded>`
/// scheme (registered via the deep-link plugin for "Open in app" flows).
fn extract_catalog_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(parsed) = url::Url::parse(raw) {
        if parsed.scheme() == "unstream" {
            for (key, value) in parsed.query_pairs() {
                if key == "url" && CATALOG_HOSTS.iter().any(|h| value.contains(h)) {
                    return Some(value.into_owned());
                }
            }
            return None;
        }
    }
    if CATALOG_HOSTS.iter().any(|h| raw.contains(h)) {
        return Some(raw.to_string());
    }
    None
}

/// Route an incoming link: straight to the live frontend, or queued for the
/// boot navigation when the sidecar isn't up yet. Returns whether it matched.
fn handle_incoming_url(app: &AppHandle, raw: &str) -> bool {
    let Some(catalog) = extract_catalog_url(raw) else {
        return false;
    };
    let state = app.state::<AppState>();
    if *state.backend_ready.lock().unwrap() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.emit("deep-link", catalog);
        }
    } else {
        *state.pending_link.lock().unwrap() = Some(catalog);
    }
    true
}

/// The sidecar answers /health: point the main window at it, swap the splash
/// for the app, and flush any link that arrived during boot.
fn boot_ready(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.backend_ready.lock().unwrap() = true;
    let port = *state.port.lock().unwrap();
    let pending = state.pending_link.lock().unwrap().take();

    if let Some(window) = app.get_webview_window("main") {
        if !cfg!(debug_assertions) {
            let mut target = format!("http://127.0.0.1:{}/", port);
            if let Some(link) = pending {
                if let Ok(mut u) = Url::parse(&target) {
                    u.query_pairs_mut().append_pair("url", &link);
                    target = u.to_string();
                }
            }
            if let Ok(url) = Url::parse(&target) {
                let _ = window.navigate(url);
            }
        } else if let Some(link) = pending {
            // Dev loads Vite directly, so there is no boot navigation to
            // carry the link — the frontend is already mounted, emit it.
            let _ = window.emit("deep-link", link);
        }
        let _ = window.show();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
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
        // A desktop has one user, not strangers: the per-client job caps stay
        // on for servers, where they bound threads and memory per caller, and
        // are 0 (no limit) here. Same for the per-job track ceiling — a
        // discography is one job of several hundred tracks.
        .env("MAX_ACTIVE_JOBS_PER_CLIENT", "0")
        .env("MAX_TRACKS_PER_JOB", "0")
        // Queue a discography and the dock holds more jobs than a server's
        // poll cap allows; the overflow would just stop reporting progress.
        .env("MAX_POLL_IDS", "0")
        // Marks this process as the desktop shell: bot-check failures name
        // the Settings toggle instead of a server env var.
        .env("UNSTREAM_DESKTOP", "1")
        // Try the TV client before web: it survives bot checks the web
        // client no longer does, even on home connections.
        .env("YTDLP_PLAYER_CLIENTS", "tv,web")
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

/// Browsers actually installed here, as the ids `BROWSER_ALLOWLIST` in
/// `backend/app/ytdlp.py` accepts.
///
/// The settings picker used to list all eight unconditionally, so most of
/// what it offered could only ever fail: yt-dlp reads the browser's own
/// cookie store, and picking one that isn't installed is an error the
/// person only discovers mid-download. Detection is by application
/// presence rather than by profile directory — "the browsers I have" is
/// what the question means, and a browser that is installed but never
/// signed into YouTube is the person's call to make, not ours.
///
/// An empty answer is meaningful: the UI keeps its "off" option and says
/// it found nothing, rather than pretending the list is the whole story.
#[tauri::command]
fn list_installed_browsers() -> Vec<String> {
    let mut found: Vec<String> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        // (id, application bundle name)
        let apps = [
            ("chrome", "Google Chrome.app"),
            ("chromium", "Chromium.app"),
            ("brave", "Brave Browser.app"),
            ("edge", "Microsoft Edge.app"),
            ("firefox", "Firefox.app"),
            ("safari", "Safari.app"),
            ("opera", "Opera.app"),
            ("vivaldi", "Vivaldi.app"),
        ];
        // Both the system-wide folder and the per-user one; a browser
        // dragged to ~/Applications is just as installed.
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
        }
        for (id, bundle) in apps {
            if roots.iter().any(|root| root.join(bundle).exists()) {
                found.push(id.to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Relative to each of the roots below, so a per-user install (the
        // default for Chrome and Edge these days) counts too.
        let apps = [
            ("chrome", r"Google\Chrome\Application\chrome.exe"),
            ("chromium", r"Chromium\Application\chrome.exe"),
            ("brave", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
            ("edge", r"Microsoft\Edge\Application\msedge.exe"),
            ("firefox", r"Mozilla Firefox\firefox.exe"),
            ("opera", r"Opera\opera.exe"),
            ("vivaldi", r"Vivaldi\Application\vivaldi.exe"),
        ];
        let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
            .iter()
            .filter_map(|key| std::env::var(key).ok())
            .map(PathBuf::from)
            .collect();
        for (id, relative) in apps {
            if roots.iter().any(|root| root.join(relative).exists()) {
                found.push(id.to_string());
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // No bundles to look for, so fall back to what is runnable: the
        // same PATH walk `shutil.which` does on the Python side.
        let apps: [(&str, &[&str]); 7] = [
            ("chrome", &["google-chrome", "google-chrome-stable"]),
            ("chromium", &["chromium", "chromium-browser"]),
            ("brave", &["brave-browser", "brave"]),
            ("edge", &["microsoft-edge", "microsoft-edge-stable"]),
            ("firefox", &["firefox"]),
            ("opera", &["opera"]),
            ("vivaldi", &["vivaldi", "vivaldi-stable"]),
        ];
        let path = std::env::var("PATH").unwrap_or_default();
        let dirs_on_path: Vec<PathBuf> = std::env::split_paths(&path).collect();
        for (id, binaries) in apps {
            let present = binaries
                .iter()
                .any(|bin| dirs_on_path.iter().any(|dir| dir.join(bin).exists()));
            if present {
                found.push(id.to_string());
            }
        }
    }

    found
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

/// Splash-screen "try again": kill any half-started sidecar, respawn it, and
/// re-run the health poll. Success runs the normal boot swap.
#[tauri::command]
fn retry_backend(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    if let Some(mut child) = state.backend_child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let port = *state.port.lock().unwrap();
    let child = spawn_backend(&app, &state, port)?;
    *state.backend_child.lock().unwrap() = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if wait_for_health(port, 80).await {
            boot_ready(&handle);
        } else if let Some(splash) = handle.get_webview_window("splash") {
            let _ = splash.emit("backend-error", "Backend failed to start");
        }
    });
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    // RunEvent::Exit below stops the sidecar, so this never orphans it.
    app.exit(0);
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
            // Second instance: focus existing window and forward any URL arg.
            // On Windows/Linux the OS spawns a new process for scheme links
            // too, so this is also the deep-link path there — macOS/Linux
            // runtime events arrive via on_open_url in setup() instead.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                for arg in args.iter().skip(1) {
                    if handle_incoming_url(app, arg) {
                        break;
                    }
                }
            }
        }))
        // Visibility is ours, not the plugin's: main starts hidden behind the
        // splash and is shown by boot_ready(). Tracking VISIBLE would re-show
        // (and focus) a backend-less window on every second launch. The
        // splash is denylisted — fixed size, always centered.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .with_denylist(&["splash"])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .setup(|app| {
            let app_handle = app.handle().clone();

            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(true);
            }

            let state = app.state::<AppState>();
            let port = get_free_port();
            *state.port.lock().unwrap() = port;

            // Runtime deep-link events (macOS open-url, and forwarded
            // single-instance links with the plugin's deep-link feature).
            // Boot-time links queue into pending_link via handle_incoming_url.
            {
                let handle = app_handle.clone();
                app_handle.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_incoming_url(&handle, &url.to_string());
                    }
                });
            }
            if let Ok(Some(urls)) = app_handle.deep_link().get_current() {
                for url in urls {
                    handle_incoming_url(&app_handle, &url.to_string());
                }
            }

            // Launch args from a first start (or a second instance whose
            // window wasn't up yet) queue the same way.
            for arg in std::env::args().skip(1) {
                if handle_incoming_url(&app_handle, &arg) {
                    break;
                }
            }

            let child = spawn_backend(&app_handle, &state, port)
                .expect("Failed to spawn backend process");
            *state.backend_child.lock().unwrap() = Some(child);

            let handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if wait_for_health(port, 80).await {
                    boot_ready(&handle_clone);
                } else {
                    eprintln!("[Unstream Desktop] Backend failed to become healthy on port {}", port);
                    if let Some(splash) = handle_clone.get_webview_window("splash") {
                        let _ = splash.emit("backend-error", "Backend failed to start");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_downloads_dir,
            set_downloads_dir,
            get_desktop_info,
            list_installed_browsers,
            start_dragging,
            toggle_maximize,
            minimize_window,
            close_window,
            set_progress_bar,
            focus_window,
            retry_backend,
            quit_app,
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
