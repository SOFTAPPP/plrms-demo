// STRATA desktop shell.
//
// In development (`pnpm dev`) the Tauri CLI starts the Node server itself and the window opens on
// http://127.0.0.1:5180. In the installed app this file starts the bundled engine
// (resources/backend: a Node runtime, the API + simulator and the UI), keeps its database in the
// user's app-data folder, shows a splash screen until the engine answers, and stops it on exit.
//
// Start-up, in two windows so that nothing on screen ever blinks:
//   - "splash": a small frameless window, shown at once on a double-click, with the logo and a progress bar.
//   - "main": created hidden and maximised; it loads the app out of sight and is shown exactly once, already
//     maximised, when the app's page has loaded. The splash then closes.
// The main window used to be revealed on a timer with the splash page inside it, then navigated to the engine and
// re-maximised while visible; on Windows that made it blink off and on again for about half a second.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::{Manager, RunEvent, WindowEvent};

struct Backend(Mutex<Option<std::process::Child>>);

// set once the main window has been shown, so the splash closing after that does not end the app
static REVEALED: AtomicBool = AtomicBool::new(false);

// Start-up timings, written to startup.log in the data folder (beside engine.log): one line per step, in ms since
// launch. Cheap, and the first thing to look at when someone reports a slow start.
static STARTED: OnceLock<Instant> = OnceLock::new();
static TRACE: Mutex<Option<std::fs::File>> = Mutex::new(None);

fn trace(step: &str) {
    let ms = STARTED.get_or_init(Instant::now).elapsed().as_millis();
    if let Ok(mut file) = TRACE.lock() {
        if let Some(f) = file.as_mut() {
            let _ = writeln!(f, "{ms:>6} ms  {step}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    STARTED.get_or_init(Instant::now);
    tauri::Builder::default()
        // a second launch focuses the running window instead of starting another engine
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let label = if REVEALED.load(Ordering::SeqCst) {
                "main"
            } else {
                "splash"
            };
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                *TRACE.lock().unwrap() = std::fs::File::create(dir.join("startup.log")).ok();
            }
            trace("shell started");
            // in development the app addresses resolve to the dev server, so there is no splash page to show
            #[cfg(not(debug_assertions))]
            create_splash_window(app.handle())?;
            trace("splash window created");
            create_main_window(app.handle())?;
            trace("main window created (hidden)");
            #[cfg(not(debug_assertions))]
            if let Err(err) = engine::start(app.handle().clone()) {
                engine::show_error(
                    app.handle(),
                    &format!("Could not start the STRATA engine: {err}"),
                );
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the splash before the app is up (Alt+F4, or the taskbar) quits, rather than leaving a hidden
            // window and the engine running with nothing on screen.
            if let WindowEvent::CloseRequested { .. } = event {
                if window.label() == "splash" && !REVEALED.load(Ordering::SeqCst) {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while starting STRATA")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Backend>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}

/// Shows the main window once — it was built maximised, so it appears at full size in one step — then closes the
/// splash. Safe to call from any thread and more than once.
fn reveal(app: &tauri::AppHandle) {
    if REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }
    trace("main window shown");
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    // The splash is covered by the maximised window from here on. It is closed a moment later rather than at once:
    // tearing down its web view in the same instant made the new window drop its text for one frame.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2000));
        if let Some(s) = app.get_webview_window("splash") {
            let _ = s.close();
            trace("splash closed");
        }
    });
}

/// The start-up window: small, frameless and centred, in the app's colours. Visible from the first frame.
#[cfg_attr(debug_assertions, allow(dead_code))]
fn create_splash_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::window::Color;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html".into()))
        .title("STRATA")
        .inner_size(520.0, 320.0)
        .center()
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .shadow(true)
        .background_color(Color(19, 19, 19, 255))
        .focused(true)
        .build()?;
    Ok(())
}

/// The main window. Built here rather than in tauri.conf.json so that file downloads
/// (CSV, PDF, snapshots, recorded clips) are saved to the user's Downloads folder.
fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::webview::{DownloadEvent, PageLoadEvent};
    use tauri::window::Color;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let downloads = app.path().download_dir().ok();
    let handle = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("STRATA · Mine Operations")
        .inner_size(1600.0, 960.0)
        .min_inner_size(1180.0, 720.0)
        .center()
        .maximized(true)
        // hidden and painted in the app's own background colour: no white flash, no blank frame between pages
        .visible(false)
        // focus moves to it when it is shown; while hidden, the splash keeps it
        .focused(false)
        .background_color(Color(19, 19, 19, 255))
        .on_page_load(move |_window, payload| {
            trace(&format!("page {:?}: {}", payload.event(), payload.url()));
            // The app itself (served by the engine on 127.0.0.1, also in development) has loaded. A short pause lets
            // it paint its first screen, so the window opens on the sign-in page rather than on a blank frame.
            if payload.event() == PageLoadEvent::Finished
                && payload.url().host_str() == Some("127.0.0.1")
            {
                let handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    reveal(&handle);
                });
            }
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { destination, .. } = event {
                if let Some(dir) = &downloads {
                    let name = destination
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .filter(|n| !n.is_empty())
                        .unwrap_or_else(|| "strata-download".into());
                    *destination = unique_path(dir, &name);
                }
            }
            true
        })
        .build()?;
    Ok(())
}

/// `report.pdf`, then `report (1).pdf`, `report (2).pdf`… so nothing is overwritten.
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..1000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(candidate)
}

#[cfg_attr(debug_assertions, allow(dead_code))]
mod engine {
    use std::fs;
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Manager};

    use super::Backend;

    /// Windows hands out `\\?\C:\...` (verbatim) paths, which Node.js cannot resolve as its entry point.
    fn plain(p: PathBuf) -> PathBuf {
        match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
            Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
            _ => p,
        }
    }

    /// 5180 when free, otherwise any free port.
    fn pick_port() -> u16 {
        if TcpListener::bind(("127.0.0.1", 5180)).is_ok() {
            return 5180;
        }
        TcpListener::bind(("127.0.0.1", 0))
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .unwrap_or(5181)
    }

    /// Shows a start-up failure on the splash, which stays open with the message; the main window stays hidden.
    pub fn show_error(app: &AppHandle, message: &str) {
        let text = serde_json::to_string(message).unwrap_or_else(|_| "\"Unknown error\"".into());
        let script = format!("window.strataError && window.strataError({text})");
        match app.get_webview_window("splash") {
            Some(s) => {
                let _ = s.eval(&script);
                let _ = s.set_focus();
            }
            // the splash is already gone: the main window still has the splash page loaded, so show it there
            None => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval(&script);
                    let _ = w.show();
                }
            }
        }
    }

    pub fn start(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let backend = plain(app.path().resource_dir()?).join("backend");
        let data = plain(app.path().app_data_dir()?);
        fs::create_dir_all(&data)?;
        let node = backend
            .join("node")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let entry = backend.join("server").join("index.mjs");
        if !node.exists() || !entry.exists() {
            return Err(format!("missing engine files in {}", backend.display()).into());
        }
        let port = pick_port();
        let log = fs::File::create(data.join("engine.log"))?;
        let mut cmd = Command::new(&node);
        cmd.arg(&entry)
            .arg("--prod")
            .current_dir(&backend)
            .env("STRATA_ROOT", &backend)
            .env("STRATA_DATA_DIR", &data)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone()?))
            .stderr(Stdio::from(log));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let child = cmd.spawn()?;
        super::trace("engine process started");
        *app.state::<Backend>().0.lock().unwrap() = Some(child);

        // The first launch simulates a week of history before the engine listens (about 15 s).
        std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                    super::trace("engine answering; loading the app in the main window");
                    if let (Some(w), Ok(url)) = (
                        app.get_webview_window("main"),
                        format!("http://127.0.0.1:{port}/").parse(),
                    ) {
                        let _ = w.navigate(url);
                    }
                    return;
                }
                let exited = app
                    .state::<Backend>()
                    .0
                    .lock()
                    .unwrap()
                    .as_mut()
                    .and_then(|c| c.try_wait().ok().flatten());
                if let Some(status) = exited {
                    show_error(&app, &format!("The engine stopped ({status}). Details are in engine.log in the STRATA data folder."));
                    return;
                }
                if started.elapsed() > Duration::from_secs(240) {
                    show_error(&app, "The engine did not start within 4 minutes. Details are in engine.log in the STRATA data folder.");
                    return;
                }
                // checked often: the engine is usually up within a second, and every check missed is time on the splash
                std::thread::sleep(Duration::from_millis(50));
            }
        });
        Ok(())
    }
}
