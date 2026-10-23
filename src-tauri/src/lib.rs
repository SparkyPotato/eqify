#![feature(portable_simd)]

pub mod audio;

use audio::{AudioEngineManager, FrequencyResponseResult, ToneParams};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::Manager;

const DEFAULT_APO_CONFIG_PATH: &str = r"C:\Program Files\EqualizerAPO\config\config.txt";
const DEFAULT_TARGET_FILENAME: &str = "eqify.txt";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterType {
    #[serde(rename = "PK")]
    Peak,
    #[serde(rename = "LSC")]
    LowShelf,
    #[serde(rename = "HSC")]
    HighShelf,
}

impl FilterType {
    pub fn apo_code(&self) -> &'static str {
        match self {
            Self::Peak => "PK",
            Self::LowShelf => "LSC",
            Self::HighShelf => "HSC",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "PK" | "PEAK" | "PEAKING" => Some(Self::Peak),
            "LSC" | "LS" | "LOWSHELF" => Some(Self::LowShelf),
            "HSC" | "HS" | "HIGHSHELF" => Some(Self::HighShelf),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterBand {
    pub enabled: bool,
    pub filter_type: FilterType,
    pub freq: f64,
    pub gain: f64,
    pub q: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqProfile {
    pub name: String,
    pub preamp: f64,
    pub filters: Vec<FilterBand>,
    #[serde(default = "SystemTime::now")]
    pub updated_at: SystemTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApoStatus {
    pub installed: bool,
    pub config_file: String,
    pub target_file: String,
    pub is_included: bool,
    pub can_write: bool,
}

fn get_apo_config_file() -> &'static Path {
    Path::new(DEFAULT_APO_CONFIG_PATH)
}

fn get_apo_dir() -> Option<&'static Path> {
    get_apo_config_file().parent()
}

fn get_eqify_dir() -> PathBuf {
    let mut dir = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.push("EQify");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn get_profiles_dir() -> PathBuf {
    let dir = get_eqify_dir().join("profiles");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn get_last_preset_file() -> PathBuf {
    get_eqify_dir().join("last_preset.txt")
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

mod commands {
    use super::*;

    #[tauri::command]
    pub fn calculate_frequency_response(
        filters: Vec<FilterBand>,
        preamp: f64,
        num_points: Option<usize>,
    ) -> FrequencyResponseResult {
        let count = num_points.unwrap_or(400);
        audio::compute_frequency_response(&filters, preamp as f32, count, 48000.0)
    }

    #[tauri::command]
    pub fn start_tone_generator(
        params: ToneParams,
        audio_manager: tauri::State<'_, Arc<Mutex<AudioEngineManager>>>,
    ) -> Result<(), String> {
        let mut mgr = audio_manager.lock().map_err(|e| e.to_string())?;
        mgr.start(params)
    }

    #[tauri::command]
    pub fn update_tone_generator(
        params: ToneParams,
        audio_manager: tauri::State<'_, Arc<Mutex<AudioEngineManager>>>,
    ) -> Result<(), String> {
        let mgr = audio_manager.lock().map_err(|e| e.to_string())?;
        mgr.update(params);
        Ok(())
    }

    #[tauri::command]
    pub fn stop_tone_generator(
        audio_manager: tauri::State<'_, Arc<Mutex<AudioEngineManager>>>,
    ) -> Result<(), String> {
        let mut mgr = audio_manager.lock().map_err(|e| e.to_string())?;
        mgr.stop();
        Ok(())
    }

    #[tauri::command]
    pub fn check_equalizer_apo_status(target_file: Option<String>) -> ApoStatus {
        let config_path = get_apo_config_file();
        let target = target_file.unwrap_or_else(|| DEFAULT_TARGET_FILENAME.to_string());
        let installed = config_path.exists();
        let mut is_included = false;
        let mut can_write = false;

        if let Some(parent) = config_path.parent() {
            let test_file = parent.join(".test_write.tmp");
            if fs::write(&test_file, b"test").is_ok() {
                let _ = fs::remove_file(&test_file);
                can_write = true;
            }
        }

        if installed {
            if let Ok(content) = fs::read_to_string(config_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("Include:") {
                        let included = trimmed.trim_start_matches("Include:").trim();
                        if included.eq_ignore_ascii_case(&target) {
                            is_included = true;
                            break;
                        }
                    }
                }
            }
        }

        ApoStatus {
            installed,
            config_file: config_path.to_string_lossy().to_string(),
            target_file: target,
            is_included,
            can_write,
        }
    }

    #[tauri::command]
    pub fn configure_equalizer_apo_include(target_file: Option<String>) -> Result<String, String> {
        let config_path = get_apo_config_file();
        let target = target_file.unwrap_or_else(|| DEFAULT_TARGET_FILENAME.to_string());

        if !config_path.exists() {
            return Err(format!("EqualizerAPO config not found at {}", config_path.display()));
        }

        let include_line = format!("Include: {}", target);
        let content = fs::read_to_string(config_path).unwrap_or_default();

        let mut already_included = false;
        let mut lines: Vec<String> = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.eq_ignore_ascii_case(&include_line) {
                already_included = true;
                lines.push(include_line.clone());
            } else {
                lines.push(line.to_string());
            }
        }

        if !already_included {
            lines.push(include_line.clone());
        }

        let updated = lines.join("\r\n") + "\r\n";
        fs::write(config_path, updated)
            .map_err(|e| format!("Failed to update config.txt: {}", e))?;

        Ok(format!("Configured EqualizerAPO to include {}", target))
    }

    #[tauri::command]
    pub fn set_equalizer_apo_include(target_file: Option<String>, enabled: bool) -> Result<bool, String> {
        let config_path = get_apo_config_file();
        let target = target_file.unwrap_or_else(|| DEFAULT_TARGET_FILENAME.to_string());

        if !config_path.exists() {
            return Err(format!("EqualizerAPO config not found at {}", config_path.display()));
        }

        let include_target = target.to_lowercase();
        let content = fs::read_to_string(config_path).unwrap_or_default();
        let mut lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            let lower = trimmed.to_lowercase();

            let is_match = if lower.starts_with("include:") {
                let rest = lower.trim_start_matches("include:").trim();
                rest == include_target
            } else if lower.starts_with("#") && lower.contains("include:") {
                let rest = lower.split("include:").nth(1).unwrap_or("").trim();
                rest == include_target
            } else {
                false
            };

            if is_match {
                found = true;
                if enabled {
                    lines.push(format!("Include: {}", target));
                } else {
                    lines.push(format!("# Include: {}", target));
                }
            } else {
                lines.push(line.to_string());
            }
        }

        if !found {
            if enabled {
                lines.push(format!("Include: {}", target));
            } else {
                lines.push(format!("# Include: {}", target));
            }
        }

        let updated = lines.join("\r\n") + "\r\n";
        fs::write(config_path, updated)
            .map_err(|e| format!("Failed to update config.txt: {}", e))?;

        Ok(enabled)
    }

    #[tauri::command]
    pub fn apply_eq_config(
        filters: Vec<FilterBand>,
        preamp: f64,
        bypass: bool,
        target_file: Option<String>,
    ) -> Result<String, String> {
        let apo_dir = get_apo_dir().ok_or_else(|| "Invalid EqualizerAPO path".to_string())?;
        let target_name = target_file.unwrap_or_else(|| DEFAULT_TARGET_FILENAME.to_string());
        let target_path = apo_dir.join(&target_name);

        let mut out = String::new();
        out.push_str("# EQify EqualizerAPO Export\r\n");
        out.push_str("Device: all\r\n");
        out.push_str("Channel: all\r\n");

        let effective_preamp = if bypass { 0.0 } else { preamp };
        out.push_str(&format!("Preamp: {:.1} dB\r\n", effective_preamp));

        for (i, filter) in filters.iter().enumerate() {
            let is_on = if bypass { false } else { filter.enabled };
            let state_str = if is_on { "ON" } else { "OFF" };
            let apo_type = filter.filter_type.apo_code();

            out.push_str(&format!(
                "Filter {}: {} {} Fc {:.1} Hz Gain {:.2} dB Q {:.2}\r\n",
                i + 1,
                state_str,
                apo_type,
                filter.freq,
                filter.gain,
                filter.q
            ));
        }

        fs::write(&target_path, out)
            .map_err(|e| format!("Failed to write to {}: {}", target_path.display(), e))?;

        Ok(format!("Applied settings to {}", target_name))
    }

    pub fn parse_apo_text(content: &str, name: String) -> EqProfile {
        let mut preamp = 0.0;
        let mut filters = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Preamp:") {
                let part = trimmed.trim_start_matches("Preamp:").trim();
                let num_str = part.split_whitespace().next().unwrap_or("0");
                if let Ok(p) = num_str.parse::<f64>() {
                    preamp = p;
                }
            } else if trimmed.starts_with("Filter") {
                if let Some(colon_pos) = trimmed.find(':') {
                    let rest = trimmed[colon_pos + 1..].trim();
                    let tokens: Vec<&str> = rest.split_whitespace().collect();
                    if tokens.len() >= 6 {
                        let enabled = tokens[0].eq_ignore_ascii_case("ON");
                        let filter_type = FilterType::from_str(tokens[1]).unwrap_or(FilterType::Peak);

                        let mut freq = 1000.0;
                        let mut gain = 0.0;
                        let mut q = 1.0;

                        let mut i = 2;
                        while i < tokens.len() {
                            match tokens[i].to_uppercase().as_str() {
                                "FC" => {
                                    if i + 1 < tokens.len() {
                                        if let Ok(v) = tokens[i + 1].parse::<f64>() {
                                            freq = v;
                                        }
                                    }
                                    i += 2;
                                }
                                "GAIN" => {
                                    if i + 1 < tokens.len() {
                                        if let Ok(v) = tokens[i + 1].parse::<f64>() {
                                            gain = v;
                                        }
                                    }
                                    i += 2;
                                }
                                "Q" => {
                                    if i + 1 < tokens.len() {
                                        if let Ok(v) = tokens[i + 1].parse::<f64>() {
                                            q = v;
                                        }
                                    }
                                    i += 2;
                                }
                                _ => i += 1,
                            }
                        }

                        filters.push(FilterBand {
                            enabled,
                            filter_type,
                            freq,
                            gain,
                            q,
                        });
                    }
                }
            }
        }

        EqProfile {
            name,
            preamp,
            filters,
            updated_at: SystemTime::now(),
        }
    }

    #[tauri::command]
    pub fn parse_apo_config_content(content: String, name: Option<String>) -> Result<EqProfile, String> {
        let profile_name = name.unwrap_or_else(|| "Imported".to_string());
        Ok(parse_apo_text(&content, profile_name))
    }

    #[tauri::command]
    pub fn list_apo_txt_files() -> Vec<String> {
        let mut files = Vec::new();
        if let Some(apo_dir) = get_apo_dir() {
            if let Ok(entries) = fs::read_dir(apo_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                            if ext.eq_ignore_ascii_case("txt") {
                                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                                    files.push(name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
        files.sort();
        files
    }

    #[tauri::command]
    pub fn read_current_apo_config(target_file: Option<String>) -> Result<EqProfile, String> {
        let filename = target_file.unwrap_or_else(|| "peace.txt".to_string());
        let path = PathBuf::from(&filename);
        let effective_path = if path.is_absolute() {
            path
        } else {
            let apo_dir = get_apo_dir().ok_or_else(|| "Invalid EqualizerAPO path".to_string())?;
            apo_dir.join(&filename)
        };

        if !effective_path.exists() {
            return Err(format!("File {} does not exist", effective_path.display()));
        }

        let content = fs::read_to_string(&effective_path)
            .map_err(|e| format!("Could not read {}: {}", effective_path.display(), e))?;

        let name = effective_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&filename)
            .to_string();

        Ok(parse_apo_text(&content, name))
    }

    #[tauri::command]
    pub fn get_profiles() -> Vec<EqProfile> {
        let dir = get_profiles_dir();
        let mut profiles = Vec::new();

        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(profile) = serde_json::from_str::<EqProfile>(&content) {
                            profiles.push(profile);
                        }
                    }
                }
            }
        }

        profiles.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        profiles
    }

    #[tauri::command]
    pub fn save_profile(mut profile: EqProfile) -> Result<String, String> {
        let dir = get_profiles_dir();
        profile.updated_at = SystemTime::now();

        let safe_name = sanitize_filename(&profile.name);
        let path = dir.join(format!("{}.json", safe_name));

        let json = serde_json::to_string_pretty(&profile)
            .map_err(|e| format!("Failed to serialize profile: {}", e))?;

        fs::write(&path, json)
            .map_err(|e| format!("Failed to write profile {}: {}", path.display(), e))?;

        Ok(profile.name)
    }

    #[tauri::command]
    pub fn delete_profile(name: String) -> Result<bool, String> {
        let dir = get_profiles_dir();
        let safe_name = sanitize_filename(&name);
        let path = dir.join(format!("{}.json", safe_name));

        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    #[tauri::command]
    pub fn get_last_preset() -> Option<String> {
        let path = get_last_preset_file();
        fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    #[tauri::command]
    pub fn set_last_preset(name: String) -> Result<(), String> {
        let path = get_last_preset_file();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            let _ = fs::remove_file(path);
        } else {
            fs::write(path, trimmed).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[tauri::command]
    pub fn app_window_minimize(window: tauri::Window) -> Result<(), String> {
        window.minimize().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn app_window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
        if window.is_maximized().map_err(|e| e.to_string())? {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }

    #[tauri::command]
    pub fn app_window_close(window: tauri::Window) -> Result<(), String> {
        window.close().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn app_window_start_dragging(window: tauri::Window) -> Result<(), String> {
        window.start_dragging().map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = std::ffi::OsStr::new("com.eqify.app")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(AppID: *const u16) -> i32;
        }
        let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(wide.as_ptr()) };
    }

    let audio_manager = Arc::new(Mutex::new(AudioEngineManager::new()));

    tauri::Builder::default()
        .manage(audio_manager)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Some(window) = app.get_webview_window("main") {
                let icon = tauri::include_image!("icons/icon.png");
                let _ = window.set_icon(icon);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::calculate_frequency_response,
            commands::start_tone_generator,
            commands::update_tone_generator,
            commands::stop_tone_generator,
            commands::check_equalizer_apo_status,
            commands::configure_equalizer_apo_include,
            commands::set_equalizer_apo_include,
            commands::list_apo_txt_files,
            commands::parse_apo_config_content,
            commands::apply_eq_config,
            commands::read_current_apo_config,
            commands::get_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::get_last_preset,
            commands::set_last_preset,
            commands::app_window_minimize,
            commands::app_window_toggle_maximize,
            commands::app_window_close,
            commands::app_window_start_dragging,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eq_profile_deserialize_without_updated_at() {
        let json = r#"{
            "name": "peace.txt",
            "preamp": -6.0,
            "filters": [
                {
                    "enabled": true,
                    "filter_type": "PK",
                    "freq": 1000.0,
                    "gain": 2.5,
                    "q": 1.41
                }
            ]
        }"#;

        let profile: Result<EqProfile, _> = serde_json::from_str(json);
        assert!(profile.is_ok(), "Failed to deserialize: {:?}", profile.err());
        let p = profile.unwrap();
        assert_eq!(p.name, "peace.txt");
        assert_eq!(p.preamp, -6.0);
        assert_eq!(p.filters.len(), 1);
        assert_eq!(p.filters[0].filter_type, FilterType::Peak);
    }
}
