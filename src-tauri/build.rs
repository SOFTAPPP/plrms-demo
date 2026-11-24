fn main() {
    // Ensure the resource directory exists so tauri_build doesn't fail in development
    let _ = std::fs::create_dir_all("resources/backend");
    tauri_build::build();
}

