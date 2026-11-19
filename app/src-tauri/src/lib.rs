use tauri::Manager;

/// Port of the analysis engine embedded in the desktop app.
/// The frontend (`app/src/api.ts`) uses the same port.
const DESKTOP_API_ADDR: &str = "127.0.0.1:17890";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Run the same Rust engine as the website, locally and offline.
            let data_dir = app.path().app_data_dir()?;
            let cfg = automate_core::Config::from_env(
                DESKTOP_API_ADDR.parse().expect("valid address"),
                data_dir,
            );
            tauri::async_runtime::spawn(async move {
                if let Err(err) = automate_core::serve(cfg).await {
                    eprintln!("Automate engine failed to start: {err:#}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Automate desktop app");
}
