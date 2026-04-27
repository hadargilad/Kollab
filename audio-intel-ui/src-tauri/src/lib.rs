// Dev mode: backend is started manually with:
//   cd backend && python -m uvicorn api:app --port 8001
//
// Production: add PyInstaller binary to src-tauri/binaries/ and restore
// the sidecar spawn block below + "externalBin" in tauri.conf.json.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
