//! Open-descriptor count, for `/v1/metrics` and the descriptor-leak test.
//!
//! A descriptor leak in the exec path is invisible until the table is full and
//! the daemon can neither accept connections nor spawn children, so the number
//! is worth exporting even though it is only a diagnostic.

/// Descriptors this process currently has open, or `None` where the platform
/// gives no way to ask.
pub fn open_fd_count() -> Option<usize> {
    count()
}

#[cfg(target_os = "linux")]
fn count() -> Option<usize> {
    // Listing the directory needs a descriptor of its own, and that descriptor
    // appears in the listing, so it comes back off the total.
    let entries = std::fs::read_dir("/proc/self/fd").ok()?.count();
    Some(entries.saturating_sub(1))
}

#[cfg(all(unix, not(target_os = "linux")))]
fn count() -> Option<usize> {
    // No /proc to read, so probe the descriptor table instead. `F_GETFD` only
    // reads an existing descriptor's flags and fails with EBADF otherwise, so
    // the scan has no side effects. It is bounded because some systems report
    // a soft limit in the billions.
    const SCAN_LIMIT: i64 = 65_536;
    // Safety: `sysconf` reads a static system limit and takes no pointers.
    let reported = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) };
    let limit = if reported <= 0 {
        1024
    } else {
        reported.min(SCAN_LIMIT)
    };
    let mut open = 0usize;
    for fd in 0..limit as libc::c_int {
        // Safety: see above; `fd` may name nothing, which is the EBADF case.
        if unsafe { libc::fcntl(fd, libc::F_GETFD) } != -1 {
            open += 1;
        }
    }
    Some(open)
}

#[cfg(not(unix))]
fn count() -> Option<usize> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_go_up_when_a_file_is_opened() {
        let before = open_fd_count().expect("this platform reports open descriptors");
        let file = tempfile::NamedTempFile::new().unwrap();
        let after = open_fd_count().expect("this platform reports open descriptors");
        assert!(after > before, "{before} -> {after}");
        drop(file);
    }
}
