//! Update decisions shared with the desktop app.
//!
//! A hotfix re-released under the SAME version number differs from what the
//! user runs only by build, so the desktop feed carries a top-level "build"
//! stamp (the short git hash the release was built from) and the app compares
//! it against its own. The rule is pure, so it lives here where the test
//! harness runs.

/// Whether a release that keeps the version number should be offered to a
/// local build.
///
/// `remote_build` is the feed's "build" field, `local` is the running
/// binary's own stamp (or "dev" when git was not available at build time).
/// Offered only when the feed stamp exists, is non-empty and differs from
/// the local one, so the same bytes never loop back at the user. A "dev"
/// local build has no identity to compare against, so it is never offered a
/// same-version release.
pub fn offer_equal_version(remote_build: Option<&str>, local: &str) -> bool {
    if local == "dev" {
        return false;
    }
    match remote_build {
        Some(b) => !b.is_empty() && b != local,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::offer_equal_version;

    #[test]
    fn no_build_stamp_is_not_offered() {
        // Cannot tell the two builds apart: treat as up to date.
        assert!(!offer_equal_version(None, "abc1234"));
    }

    #[test]
    fn empty_build_stamp_is_not_offered() {
        assert!(!offer_equal_version(Some(""), "abc1234"));
    }

    #[test]
    fn same_build_stamp_is_not_offered() {
        assert!(!offer_equal_version(Some("abc1234"), "abc1234"));
    }

    #[test]
    fn different_build_stamp_is_offered() {
        assert!(offer_equal_version(Some("def5678"), "abc1234"));
        // The compare is exact: no trimming, no case folding.
        assert!(offer_equal_version(Some(" abc1234"), "abc1234"));
        assert!(offer_equal_version(Some("ABC1234"), "abc1234"));
    }

    #[test]
    fn dev_build_is_never_offered() {
        assert!(!offer_equal_version(Some("def5678"), "dev"));
        assert!(!offer_equal_version(None, "dev"));
        assert!(!offer_equal_version(Some(""), "dev"));
    }
}
