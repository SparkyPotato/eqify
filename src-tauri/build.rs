use std::process::Command;

fn main() {
    let dist_index = std::path::Path::new("../dist/index.html");
    if !dist_index.exists() {
        println!("cargo:warning=dist/index.html not found, building frontend with npm run build...");
        let status = if cfg!(target_os = "windows") {
            Command::new("cmd")
                .args(["/C", "npm run build"])
                .current_dir("..")
                .status()
        } else {
            Command::new("sh")
                .args(["-c", "npm run build"])
                .current_dir("..")
                .status()
        };
        if let Err(e) = status {
            println!("cargo:warning=Failed to run npm run build: {}", e);
        }
    }
    tauri_build::build()
}
