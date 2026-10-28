use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_PROJECT_BYTES: u64 = 16_000_000;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn error(context: &str, err: impl std::fmt::Display) -> String {
    format!("{context}: {err}")
}

fn temporary_path(path: &Path) -> Result<(PathBuf, fs::File), String> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().ok_or_else(|| "Nama file project tidak valid".to_owned())?;
    for _ in 0..32 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let mut temp_name = name.to_os_string();
        temp_name.push(format!(".{}.{}.tmp", std::process::id(), sequence));
        let temp_path = parent.join(temp_name);
        match OpenOptions::new().write(true).create_new(true).open(&temp_path) {
            Ok(file) => return Ok((temp_path, file)),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(error("Tidak dapat membuat file sementara", err)),
        }
    }
    Err("Tidak dapat membuat nama file sementara yang unik".into())
}

fn save_with(
    path: &Path,
    write: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    let (temp_path, mut file) = temporary_path(path)?;
    let result = (|| {
        write(&mut file).map_err(|e| error("Gagal menulis project", e))?;
        file.flush().map_err(|e| error("Gagal menyelesaikan penulisan project", e))?;
        file.sync_all().map_err(|e| error("Gagal menyimpan project ke disk", e))
    })();
    drop(file);
    let result = result.and_then(|()| {
        replace_file(&temp_path, path).map_err(|e| error("Gagal mengganti file project", e))
    });
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}
pub fn save_project(path: &Path, contents: &str) -> Result<(), String> {
    if contents.len() as u64 > MAX_PROJECT_BYTES {
        return Err("Ukuran project melebihi batas 16 MB".into());
    }
    save_with(path, |file| file.write_all(contents.as_bytes()))
}

pub fn open_project(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| error("Gagal membuka project", e))?;
    let metadata = file
        .metadata()
        .map_err(|e| error("Gagal membaca metadata project", e))?;
    if !metadata.is_file() {
        return Err("File project bukan file biasa".into());
    }
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err("Ukuran project melebihi batas 16 MB".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_PROJECT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| error("Gagal membaca project", e))?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err("Ukuran project melebihi batas 16 MB".into());
    }
    String::from_utf8(bytes).map_err(|e| error("File project bukan UTF-8 yang valid", e))
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) };
    if ok != 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "orsaven-{label}-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn saves_and_opens_real_project_file() {
        let path = test_path("roundtrip");
        save_project(&path, "{\"format\":\"orsaven\",\"version\":0}").unwrap();
        save_project(&path, "{\"format\":\"orsaven\",\"version\":1}").unwrap();
        assert_eq!(
            open_project(&path).unwrap(),
            "{\"format\":\"orsaven\",\"version\":1}"
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_oversized_and_invalid_utf8_files() {
        let path = test_path("invalid");
        fs::write(&path, vec![b'x'; MAX_PROJECT_BYTES as usize + 1]).unwrap();
        assert!(open_project(&path).unwrap_err().contains("16 MB"));
        fs::write(&path, [0xff]).unwrap();
        assert!(open_project(&path).unwrap_err().contains("UTF-8"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn partial_write_failure_preserves_existing_project() {
        let path = test_path("preserved");
        save_project(&path, "original").unwrap();
        let failure = save_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("injected write failure"))
        });
        assert!(failure.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        let prefix = format!("{}.{}.", path.file_name().unwrap().to_string_lossy(), std::process::id());
        assert!(!fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix)));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn replacement_failure_preserves_existing_file() {
        let directory = test_path("replace-directory");
        fs::create_dir(&directory).unwrap();
        let sentinel = directory.join("sentinel");
        fs::write(&sentinel, "original").unwrap();
        assert!(save_project(&directory, "replacement").is_err());
        fs::remove_file(&sentinel).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}

