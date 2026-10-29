use crate::project_io;
use std::{fs, path::PathBuf};

const RECOVERY_FILE: &str = "recovery.orsaven";

pub struct RecoveryStore {
    directory: PathBuf,
}

impl RecoveryStore {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn load(&self) -> Result<Option<String>, String> {
        let path = self.directory.join(RECOVERY_FILE);
        match fs::metadata(&path) {
            Ok(_) => project_io::open_project(&path)
                .map(Some)
                .map_err(|error| format!("Gagal membaca recovery: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Gagal memeriksa recovery: {error}")),
        }
    }

    pub fn save(&self, contents: &str) -> Result<(), String> {
        fs::create_dir_all(&self.directory)
            .map_err(|error| format!("Gagal membuat direktori recovery: {error}"))?;
        project_io::save_project(&self.directory.join(RECOVERY_FILE), contents)
            .map_err(|error| format!("Gagal menyimpan recovery: {error}"))
    }

    pub fn discard(&self) -> Result<(), String> {
        match fs::remove_file(self.directory.join(RECOVERY_FILE)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Gagal menghapus recovery: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_main_file_and_ignores_abandoned_atomic_temp() {
        let directory = std::env::temp_dir().join(format!(
            "orsaven-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let main_file = directory.join("main.orsaven");
        fs::write(&main_file, "main sentinel").unwrap();
        let store = RecoveryStore::new(directory.clone());

        store.save("known complete snapshot").unwrap();
        fs::write(
            directory.join(format!("{RECOVERY_FILE}.{}.999.tmp", std::process::id())),
            "abandoned partial snapshot",
        )
        .unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("known complete snapshot"));

        store.save("newer snapshot").unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("newer snapshot"));
        store.discard().unwrap();
        assert_eq!(store.load().unwrap(), None);
        assert_eq!(fs::read_to_string(main_file).unwrap(), "main sentinel");
        fs::remove_dir_all(directory).unwrap();
    }
}
