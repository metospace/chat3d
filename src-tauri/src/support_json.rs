pub(crate) const MAX_WORKSPACE_BACKUP_BYTES: usize = 400 * 1024 * 1024;

pub(crate) fn check_support_size(kind: &str, size: usize) -> Result<(), String> {
    let limit = if kind == "workspace" { MAX_WORKSPACE_BACKUP_BYTES } else { 50 * 1024 * 1024 };
    if size > limit {
        return Err(if kind == "workspace" { "备份超过400 MiB，请分别导出项目".into() } else { "导出文件超过50 MiB".into() });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_backup_accepts_400_mib_inclusively() {
        assert!(check_support_size("workspace", 400 * 1024 * 1024).is_ok());
        assert_eq!(check_support_size("workspace", 400 * 1024 * 1024 + 1).unwrap_err(), "备份超过400 MiB，请分别导出项目");
        assert!(check_support_size("diagnostics", 50 * 1024 * 1024 + 1).is_err());
    }
}
