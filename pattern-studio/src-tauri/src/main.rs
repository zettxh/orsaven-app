mod project_io;
mod recovery;

use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedProject {
    path: String,
    contents: String,
}

#[tauri::command]
async fn save_project(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    if contents.len() > 16_000_000 {
        return Err("Ukuran project melebihi batas 16 MB".into());
    }
    let suggested_name = suggested_name
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("project")
        .to_owned();
    let path = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        app.dialog()
            .file()
            .set_file_name(&suggested_name)
            .add_filter("Orsaven project", &["orsaven"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Dialog simpan gagal: {e}"))?;
    let Some(path) = path else { return Ok(None) };
    let path = path
        .into_path()
        .map_err(|e| format!("Lokasi file project tidak valid: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        project_io::save_project(&path, &contents)
            .map(|()| Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| format!("Penyimpanan project gagal: {e}"))?
}

#[tauri::command]
async fn open_project(app: tauri::AppHandle) -> Result<Option<OpenedProject>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        app.dialog()
            .file()
            .add_filter("Orsaven project", &["orsaven"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("Dialog buka gagal: {e}"))?;
    let Some(path) = path else { return Ok(None) };
    let path = path
        .into_path()
        .map_err(|e| format!("Lokasi file project tidak valid: {e}"))?;
    let contents = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        move || project_io::open_project(&path)
    })
    .await
    .map_err(|e| format!("Pembacaan project gagal: {e}"))?
    .map_err(|e| format!("Pembacaan project gagal: {e}"))?;
    Ok(Some(OpenedProject {
        path: path.to_string_lossy().into_owned(),
        contents,
    }))
}

#[tauri::command]
async fn read_recovery(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Lokasi penyimpanan recovery tidak tersedia: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        recovery::RecoveryStore::new(directory).load()
    })
    .await
    .map_err(|error| format!("Pembacaan recovery gagal: {error}"))?
}

#[tauri::command]
async fn write_recovery(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Lokasi penyimpanan recovery tidak tersedia: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        recovery::RecoveryStore::new(directory).save(&contents)
    })
    .await
    .map_err(|error| format!("Penyimpanan recovery gagal: {error}"))?
}

#[tauri::command]
async fn discard_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Lokasi penyimpanan recovery tidak tersedia: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        recovery::RecoveryStore::new(directory).discard()
    })
    .await
    .map_err(|error| format!("Penghapusan recovery gagal: {error}"))?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            open_project,
            read_recovery,
            write_recovery,
            discard_recovery
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
