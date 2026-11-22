// STRATA desktop shell.
//
// In development (`pnpm dev`) the Tauri CLI starts the Node server itself and the window opens on
// http://127.0.0.1:5180. In the installed app this file starts the bundled engine
// (resources/backend: a Node runtime, the API + simulator and the UI), keeps its database in the
// user's app-data folder, shows a splash screen until the engine answers, and stops it on exit.

use std::sync::Mutex;

use tauri::{Manager, RunEvent};

struct Backend(Mutex<Option<std::process::Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second launch focuses the running window instead of starting another engine
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            create_main_window(app.handle())?;
            // The window stays hidden until the app has loaded (see `on_page_load`), so it opens straight onto the
            // sign-in page. Only if the engine is slow (a first start, or a long catch-up) is the splash shown.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                reveal(&handle);
            });
            #[cfg(not(debug_assertions))]
            if let Err(err) = engine::start(app.handle().clone()) {
                engine::show_error(app.handle(), &format!("Could not start the STRATA engine: {err}"));
            }
            Ok(())
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

/// Shows the main window once (maximised, focused). Safe to call from any thread and more than once.
fn reveal(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.maximize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
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
        .background_color(Color(8, 11, 16, 255))
        .on_page_load(move |_window, payload| {
            // the app itself (served by the engine on 127.0.0.1, also in development) has loaded
            if payload.event() == PageLoadEvent::Finished && payload.url().host_str() == Some("127.0.0.1") {
                reveal(&handle);
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

    pub fn show_error(app: &AppHandle, message: &str) {
        if let Some(w) = app.get_webview_window("main") {
            let text = serde_json::to_string(message).unwrap_or_else(|_| "\"Unknown error\"".into());
            let _ = w.eval(&format!("window.strataError && window.strataError({text})"));
        }
        super::reveal(app);
    }

    pub fn start(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let backend = plain(app.path().resource_dir()?).join("backend");
        let data = plain(app.path().app_data_dir()?);
        fs::create_dir_all(&data)?;
        let node = backend.join("node").join(if cfg!(windows) { "node.exe" } else { "node" });
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
        *app.state::<Backend>().0.lock().unwrap() = Some(child);

        // The first launch simulates a week of history before the engine listens (about 15 s).
        std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                    if let (Some(w), Ok(url)) = (app.get_webview_window("main"), format!("http://127.0.0.1:{port}/").parse()) {
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
                std::thread::sleep(Duration::from_millis(250));
            }
        });
        Ok(())
    }
}
