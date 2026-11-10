use std::{fs::{File, OpenOptions}, io::{self, Write}, path::Path, sync::atomic::{AtomicU64, Ordering}};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[cfg(not(windows))]
fn replace(source: &Path, destination: &Path) -> io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" { fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32; }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    // Same-directory rename, replacing an existing file; never remove the destination first.
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0x1 | 0x8) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub(crate) fn write_export(path: &Path, contents: &[u8]) -> io::Result<()> {
    write_with(path, |file| file.write_all(contents))
}

fn write_with(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let (temporary, mut file) = loop {
        let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(".scenivo-export-{}-{sequence}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&temporary) {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let result = write(&mut file).and_then(|_| file.sync_all());
    drop(file); // Windows cannot rename an open temporary file.
    let result = result.and_then(|_| replace(&temporary, path));
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("scenivo-atomic-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir(&dir).unwrap();
        dir
    }
    #[test]
    fn partial_write_and_failure_preserve_original_and_clean_temporary() {
        let dir = directory(); let path = dir.join("backup.json");
        std::fs::write(&path, b"original backup").unwrap();
        let result = write_with(&path, |file| { file.write_all(b"partial")?; Err(io::Error::new(io::ErrorKind::WriteZero, "short write")) });
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original backup");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn replacement_failure_cleans_temporary_and_preserves_target() {
        let dir = directory(); let target = dir.join("directory"); std::fs::create_dir(&target).unwrap();
        assert!(write_export(&target, b"new").is_err());
        assert!(target.is_dir()); assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn successful_overwrite_preserves_exact_utf8_and_binary() {
        let dir = directory(); let path = dir.join("backup.json");
        write_export(&path, "中文".as_bytes()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), "中文".as_bytes());
        write_export(&path, &[0, 255, 1]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), [0, 255, 1]);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
