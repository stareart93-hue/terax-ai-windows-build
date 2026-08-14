#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;
use terax_lib::modules::fs::to_canon;
use terax_lib::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

pub struct GitRepoFixture {
    pub registry: WorkspaceRegistry,
    pub workspace: WorkspaceEnv,
    pub repo_path: PathBuf,
    _tmp: TempDir,
}

impl GitRepoFixture {
    pub fn new() -> Self {
        let tmp = TempDir::new().expect("tempdir");
        let canonical = std::fs::canonicalize(tmp.path()).expect("canonicalize");
        let registry = WorkspaceRegistry::default();
        registry.authorize(&canonical).expect("authorize");

        run_git_in(&canonical, &["init", "-q"]);
        run_git_in(&canonical, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        run_git_in(&canonical, &["config", "user.email", "test@terax.local"]);
        run_git_in(&canonical, &["config", "user.name", "Terax Test"]);
        run_git_in(&canonical, &["config", "commit.gpgsign", "false"]);
        run_git_in(&canonical, &["config", "core.autocrlf", "false"]);

        Self {
            registry,
            workspace: WorkspaceEnv::Local,
            repo_path: canonical,
            _tmp: tmp,
        }
    }

    pub fn repo_str(&self) -> String {
        to_canon(&self.repo_path)
    }

    pub fn run_git(&self, args: &[&str]) {
        run_git_in(&self.repo_path, args);
    }

    pub fn write_file(&self, rel: &str, content: &str) {
        let p = self.repo_path.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir parents");
        }
        std::fs::write(&p, content).expect("write file");
    }

    /// Bare clone of the fixture repo registered as `origin`, with
    /// refs/remotes/origin/HEAD pointing at main so baseline resolution sees a
    /// remote default. Keep the returned TempDir alive for the test duration.
    pub fn setup_origin(&self) -> TempDir {
        let tmp = TempDir::new().expect("tempdir");
        let bare = tmp.path().join("origin.git");
        // Windows paths (C:\...) passed bare to clone/remote are parsed as
        // remote URLs ("hostname contains invalid characters"); file:// URLs
        // work identically on both platforms.
        let bare_url = file_url(&bare);
        let out = Command::new("git")
            .args(["clone", "--bare", "-q"])
            .arg(file_url(&self.repo_path))
            .arg(&bare)
            .output()
            .expect("git on PATH");
        assert!(
            out.status.success(),
            "git clone --bare failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        self.run_git(&["remote", "add", "origin", bare_url.as_str()]);
        self.run_git(&["fetch", "-q", "origin"]);
        self.run_git(&["remote", "set-head", "origin", "main"]);
        tmp
    }
}

fn file_url(path: &Path) -> String {
    let raw = path.to_string_lossy();
    // canonicalize() on Windows returns verbatim \\?\ paths; git rejects those
    // inside file:// URLs.
    let trimmed = raw.strip_prefix(r"\\?\").unwrap_or(raw.as_ref());
    let s = trimmed.replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        format!("file:///{s}")
    }
}

pub fn git_output(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git on PATH");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn run_git_in(cwd: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git on PATH");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub struct FsFixture {
    pub root: PathBuf,
    _tmp: TempDir,
}

impl FsFixture {
    pub fn new() -> Self {
        let tmp = TempDir::new().expect("tempdir");
        let root = std::fs::canonicalize(tmp.path()).expect("canonicalize");
        Self { root, _tmp: tmp }
    }

    pub fn root_str(&self) -> String {
        to_canon(&self.root)
    }

    pub fn write(&self, rel: &str, content: &str) {
        let p = self.root.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir parents");
        }
        std::fs::write(&p, content).expect("write file");
    }

    pub fn mkdir(&self, rel: &str) {
        std::fs::create_dir_all(self.root.join(rel)).expect("mkdir");
    }
}
