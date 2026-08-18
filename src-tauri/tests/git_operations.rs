mod common;

use common::{git_available, GitRepoFixture};
use tempfile::TempDir;
use terax_lib::modules::fs::to_canon;
use terax_lib::modules::git::errors::GitError;
use terax_lib::modules::git::operations;
use terax_lib::modules::git::types::DiscardEntry;
use terax_lib::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

fn skip_if_no_git() -> bool {
    if !git_available() {
        eprintln!("skipping: git not on PATH");
        return true;
    }
    false
}

#[test]
fn resolve_repo_returns_none_outside_repo() {
    if skip_if_no_git() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let canonical = std::fs::canonicalize(tmp.path()).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(&canonical).unwrap();

    let info = operations::resolve_repo(&registry, &to_canon(&canonical), &WorkspaceEnv::Local)
        .expect("resolve_repo");
    assert!(info.is_none());
}

#[test]
fn resolve_repo_returns_branch_for_real_repo() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("seed.txt", "seed\n");
    fx.run_git(&["add", "seed.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let info = operations::resolve_repo(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("resolve_repo")
        .expect("repo present");
    assert_eq!(info.branch, "main");
    assert!(info.upstream.is_none());
    assert!(!info.is_detached);
}

#[test]
fn resolve_repo_returns_branch_for_unborn_head() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let info = operations::resolve_repo(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("resolve_repo")
        .expect("repo present even without commits");
    assert_eq!(info.branch, "main");
    assert!(info.upstream.is_none());
    assert!(!info.is_detached);
}

#[test]
fn status_on_empty_repo_has_no_files() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).expect("status");
    assert_eq!(snap.branch, "main");
    assert!(snap.changed_files.is_empty());
    assert_eq!(snap.ahead, 0);
    assert_eq!(snap.behind, 0);
}

#[test]
fn status_lists_untracked_file() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("hello.txt", "hi\n");
    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).expect("status");
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "hello.txt")
        .expect("hello.txt in changed_files");
    assert!(entry.untracked);
    assert!(!entry.staged);
}

#[test]
fn stage_then_commit_produces_log_entry() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    operations::stage(
        &fx.registry,
        &fx.repo_str(),
        &["a.txt".into()],
        &fx.workspace,
    )
    .expect("stage");

    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt staged");
    assert!(entry.staged);
    assert!(!entry.untracked);

    let commit = operations::commit(&fx.registry, &fx.repo_str(), "add a", &fx.workspace)
        .expect("commit");
    assert_eq!(commit.summary, "add a");
    assert_eq!(commit.commit_sha.len(), 40);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace)
        .expect("log");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].sha, commit.commit_sha);
    assert_eq!(entries[0].subject, "add a");
}

#[test]
fn unstage_clears_index_entry() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "beta\n");
    operations::stage(
        &fx.registry,
        &fx.repo_str(),
        &["a.txt".into()],
        &fx.workspace,
    )
    .unwrap();

    operations::unstage(
        &fx.registry,
        &fx.repo_str(),
        &["a.txt".into()],
        &fx.workspace,
    )
    .expect("unstage");

    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt present");
    assert!(!entry.staged);
    assert!(entry.unstaged);
}

#[test]
fn commit_with_empty_message_is_rejected() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);

    match operations::commit(&fx.registry, &fx.repo_str(), "   ", &fx.workspace) {
        Err(GitError::EmptyCommitMessage) => {}
        Err(other) => panic!("expected EmptyCommitMessage, got {other}"),
        Ok(_) => panic!("expected error for empty message"),
    }
}

#[test]
fn log_on_empty_repo_returns_empty_list() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let entries =
        operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).expect("log");
    assert!(entries.is_empty());
}

#[test]
fn diff_shows_worktree_change() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "alpha\nbeta\n");

    let diff =
        operations::diff(&fx.registry, &fx.repo_str(), None, false, None, &fx.workspace)
            .expect("diff");
    assert!(diff.diff_text.contains("+beta"));
}

#[test]
fn diff_staged_only_shows_index_change() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "alpha\nbeta\n");
    fx.run_git(&["add", "a.txt"]);
    fx.write_file("a.txt", "alpha\nbeta\ngamma\n");

    let staged =
        operations::diff(&fx.registry, &fx.repo_str(), None, true, None, &fx.workspace)
            .expect("staged diff");
    assert!(staged.diff_text.contains("+beta"));
    assert!(!staged.diff_text.contains("+gamma"));
}

#[test]
fn discard_tracked_restores_worktree() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "tampered\n");

    operations::discard(
        &fx.registry,
        &fx.repo_str(),
        &[DiscardEntry {
            path: "a.txt".into(),
            untracked: false,
        }],
        &fx.workspace,
    )
    .expect("discard");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "alpha\n");
}

#[test]
fn discard_untracked_removes_file() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("garbage.txt", "junk\n");

    operations::discard(
        &fx.registry,
        &fx.repo_str(),
        &[DiscardEntry {
            path: "garbage.txt".into(),
            untracked: true,
        }],
        &fx.workspace,
    )
    .expect("discard");

    assert!(!fx.repo_path.join("garbage.txt").exists());
}

#[test]
fn panel_snapshot_returns_repo_and_status_after_commit() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("b.txt", "beta\n");

    let snap = operations::panel_snapshot(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("panel_snapshot");
    let repo = snap.repo.expect("repo present");
    assert_eq!(repo.branch, "main");
    let status = snap.status.expect("status present");
    assert!(status.changed_files.iter().any(|f| f.path == "b.txt"));
}

#[test]
fn panel_snapshot_outside_repo_is_empty() {
    if skip_if_no_git() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let canonical = std::fs::canonicalize(tmp.path()).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(&canonical).unwrap();

    let snap =
        operations::panel_snapshot(&registry, &to_canon(&canonical), &WorkspaceEnv::Local)
            .expect("panel_snapshot");
    assert!(snap.repo.is_none());
    assert!(snap.status.is_none());
}

#[test]
fn show_commit_diff_returns_patch_for_known_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let entries =
        operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let sha = &entries[0].sha;

    let diff = operations::show_commit_diff(&fx.registry, &fx.repo_str(), sha, &fx.workspace)
        .expect("show_commit_diff");
    assert!(diff.diff_text.contains("a.txt"));
    assert!(diff.diff_text.contains("+alpha"));
}

#[test]
fn show_commit_diff_rejects_invalid_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    match operations::show_commit_diff(
        &fx.registry,
        &fx.repo_str(),
        "not-a-sha",
        &fx.workspace,
    ) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for invalid sha"),
    }
}

#[test]
fn log_paginates_with_before_sha_cursor() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    for i in 0..3 {
        fx.write_file(&format!("f{i}.txt"), &format!("v{i}\n"));
        fx.run_git(&["add", &format!("f{i}.txt")]);
        fx.run_git(&["commit", "-q", "-m", &format!("c{i}")]);
    }

    let first_page =
        operations::log(&fx.registry, &fx.repo_str(), 1, None, &fx.workspace).unwrap();
    assert_eq!(first_page.len(), 1);
    let cursor = first_page[0].sha.clone();

    let second_page = operations::log(
        &fx.registry,
        &fx.repo_str(),
        10,
        Some(&cursor),
        &fx.workspace,
    )
    .unwrap();
    assert!(second_page.iter().all(|e| e.sha != cursor));
    assert_eq!(second_page.len(), 2);
}

#[test]
fn log_with_invalid_cursor_sha_errors() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "x\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    match operations::log(
        &fx.registry,
        &fx.repo_str(),
        10,
        Some("not-hex"),
        &fx.workspace,
    ) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for bad cursor"),
    }
}

#[test]
fn commit_files_reports_added_and_modified() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.write_file("b.txt", "beta\n");
    fx.run_git(&["add", "a.txt", "b.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("a.txt", "alpha2\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "modify"]);

    let entries =
        operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let head = &entries[0].sha;

    let files =
        operations::commit_files(&fx.registry, &fx.repo_str(), head, &fx.workspace).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "a.txt");
    assert_eq!(files[0].status, "M");
    assert_eq!(files[0].status_label, "Modified");
}

#[test]
fn commit_file_diff_returns_original_and_modified_text() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "v1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "v1"]);
    fx.write_file("a.txt", "v2\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "v2"]);

    let entries =
        operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let head = &entries[0].sha;

    let diff =
        operations::commit_file_diff(&fx.registry, &fx.repo_str(), head, "a.txt", None, &fx.workspace)
            .unwrap();
    assert_eq!(diff.original_content, "v1\n");
    assert_eq!(diff.modified_content, "v2\n");
    assert!(!diff.is_binary);
}

#[test]
fn remote_url_returns_none_for_missing_remote() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let url = operations::remote_url(&fx.registry, &fx.repo_str(), "origin", &fx.workspace)
        .unwrap();
    assert!(url.is_none());
}

#[test]
fn remote_url_returns_configured_url() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.run_git(&[
        "remote",
        "add",
        "origin",
        "https://example.com/x.git",
    ]);

    let url = operations::remote_url(&fx.registry, &fx.repo_str(), "origin", &fx.workspace)
        .unwrap();
    assert_eq!(url.as_deref(), Some("https://example.com/x.git"));
}

#[test]
fn remote_url_rejects_unsafe_remote_name() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let url = operations::remote_url(
        &fx.registry,
        &fx.repo_str(),
        "name with space",
        &fx.workspace,
    )
    .unwrap();
    assert!(url.is_none());
}

#[test]
fn unauthorized_path_is_rejected() {
    if skip_if_no_git() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let canonical = std::fs::canonicalize(tmp.path()).unwrap();
    let registry = WorkspaceRegistry::default();

    match operations::status(&registry, &to_canon(&canonical), &WorkspaceEnv::Local) {
        Err(GitError::PathOutsideWorkspace(_)) => {}
        Err(other) => panic!("expected PathOutsideWorkspace, got {other}"),
        Ok(_) => panic!("expected error for unauthorized dir"),
    }
}

#[test]
fn checkout_branch_rejects_unsafe_names() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    
    let err_empty = operations::checkout_branch(&fx.registry, &fx.repo_str(), "", &fx.workspace).unwrap_err();
    assert!(matches!(err_empty, GitError::InvalidPath(p) if p.is_empty()));

    let err_dash = operations::checkout_branch(&fx.registry, &fx.repo_str(), "-f", &fx.workspace).unwrap_err();
    assert!(matches!(err_dash, GitError::InvalidPath(p) if p == "-f"));

    let err_dash_long = operations::checkout_branch(&fx.registry, &fx.repo_str(), "--detach", &fx.workspace).unwrap_err();
    assert!(matches!(err_dash_long, GitError::InvalidPath(p) if p == "--detach"));
}

#[test]
fn list_branches_keeps_current_branch_local_and_surfaces_worktrees() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "."]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.run_git(&["branch", "feature"]);

    let wt = TempDir::new().unwrap();
    let wt_path = wt.path().join("linked");
    fx.run_git(&["worktree", "add", "-q", wt_path.to_str().unwrap(), "feature"]);

    let result = operations::list_branches(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("list_branches");

    // current branch stays local+head despite the main worktree being listed
    let main = result
        .branches
        .iter()
        .find(|b| b.name == "main")
        .expect("main branch present");
    assert_eq!(main.kind, "local");
    assert!(main.is_head);
    assert!(main.worktree_path.is_none());

    let feature: Vec<_> = result.branches.iter().filter(|b| b.name == "feature").collect();
    assert_eq!(feature.len(), 1);
    assert_eq!(feature[0].kind, "worktree");
    assert!(!feature[0].is_head);
    assert!(feature[0].worktree_path.is_some());
}

/// Build a repo with a real merge conflict on `file.txt`:
///   base -> main (ours: "main wins")
///        \-> topic (theirs: "topic wins")
///   `git merge topic` fails and leaves file.txt in UU state.
fn repo_with_conflict(fx: &GitRepoFixture) {
    fx.write_file("file.txt", "base\n");
    fx.run_git(&["add", "file.txt"]);
    fx.run_git(&["commit", "-q", "-m", "base"]);

    fx.run_git(&["checkout", "-q", "-b", "topic"]);
    fx.write_file("file.txt", "topic wins\n");
    fx.run_git(&["add", "file.txt"]);
    fx.run_git(&["commit", "-q", "-m", "topic"]);

    fx.run_git(&["checkout", "-q", "main"]);
    fx.write_file("file.txt", "main wins\n");
    fx.run_git(&["add", "file.txt"]);
    fx.run_git(&["commit", "-q", "-m", "main"]);

    // Merge fails on conflict — ignore the exit status.
    let _ = std::process::Command::new("git")
        .args(["merge", "topic"])
        .current_dir(&fx.repo_path)
        .output();
}

#[test]
fn resolve_conflict_ours_keeps_local_version() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    repo_with_conflict(&fx);

    operations::resolve_conflict(
        &fx.registry,
        &fx.repo_str(),
        "file.txt",
        "ours",
        &fx.workspace,
    )
    .expect("resolve_conflict ours");

    let content = std::fs::read_to_string(fx.repo_path.join("file.txt")).unwrap();
    assert_eq!(content, "main wins\n");
    // No conflict markers remain.
    assert!(!content.contains("<<<<") && !content.contains(">>>>"));

    // The file must no longer be reported as Unmerged.
    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    let still_unmerged = snap
        .changed_files
        .iter()
        .any(|f| f.path == "file.txt" && f.status_label == "Unmerged");
    assert!(!still_unmerged, "file.txt still reported as unmerged");
}

#[test]
fn resolve_conflict_theirs_keeps_incoming_version() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    repo_with_conflict(&fx);

    operations::resolve_conflict(
        &fx.registry,
        &fx.repo_str(),
        "file.txt",
        "theirs",
        &fx.workspace,
    )
    .expect("resolve_conflict theirs");

    let content = std::fs::read_to_string(fx.repo_path.join("file.txt")).unwrap();
    assert_eq!(content, "topic wins\n");
}

#[test]
fn resolve_conflict_rejects_invalid_side() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("file.txt", "base\n");
    fx.run_git(&["add", "file.txt"]);
    fx.run_git(&["commit", "-q", "-m", "base"]);

    match operations::resolve_conflict(
        &fx.registry,
        &fx.repo_str(),
        "file.txt",
        "everyone",
        &fx.workspace,
    ) {
        Err(GitError::InvalidInput(_)) => {}
        Err(other) => panic!("expected InvalidInput, got {other}"),
        Ok(_) => panic!("expected error for invalid side"),
    }
}

#[test]
fn pull_rebase_replays_local_commits_without_conflict() {
    if skip_if_no_git() {
        return;
    }
    // A non-conflicting divergence: main and a remote branch both advance with
    // disjoint file changes, so `pull --rebase` succeeds cleanly.
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "base"]);
    fx.run_git(&["checkout", "-q", "-b", "remote-tip"]);
    fx.write_file("b.txt", "b\n");
    fx.run_git(&["add", "b.txt"]);
    fx.run_git(&["commit", "-q", "-m", "remote add"]);
    fx.run_git(&["checkout", "-q", "main"]);
    fx.write_file("c.txt", "c\n");
    fx.run_git(&["add", "c.txt"]);
    fx.run_git(&["commit", "-q", "-m", "local add"]);
    // Point main at remote-tip as its upstream and rebase onto it.
    fx.run_git(&["fetch", ".", "remote-tip:origin/main"]);
    fx.run_git(&["branch", "--set-upstream-to=origin/main", "main"]);

    operations::pull_rebase(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("pull_rebase");

    // After rebase, all three files exist (base + remote b + local c replayed).
    assert!(fx.repo_path.join("b.txt").exists());
    assert!(fx.repo_path.join("c.txt").exists());
}

#[test]
fn merge_state_detects_rebase_in_progress_and_clears_on_abort() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    repo_with_conflict(&fx);

    // repo_with_conflict leaves a merge in progress (unresolved conflict).
    let state = operations::merge_in_progress(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("merge_in_progress");
    assert!(
        state.merge_in_progress,
        "expected merge in progress after a conflicting merge"
    );

    // Abort the merge (use merge --abort; rebase wasn't started here). For the
    // merge path, MERGE_HEAD is what we detect — clear it via checkout/reset.
    let _ = std::process::Command::new("git")
        .args(["merge", "--abort"])
        .current_dir(&fx.repo_path)
        .status();

    let state = operations::merge_in_progress(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("merge_in_progress after abort");
    assert!(
        !state.merge_in_progress,
        "merge should no longer be in progress after abort"
    );
    assert!(!state.rebase_in_progress);
}

#[test]
fn merge_state_clean_on_quiet_repo() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let state = operations::merge_in_progress(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("merge_in_progress");
    assert!(!state.merge_in_progress);
    assert!(!state.rebase_in_progress);
}


#[test]
fn default_baseline_falls_back_to_local_main() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let info =
        operations::default_baseline(&fx.registry, &fx.repo_str(), &fx.workspace).expect("baseline");
    assert_eq!(info.baseline_ref.as_deref(), Some("main"));
    assert!(info.remote.is_none());
}

#[test]
fn default_baseline_prefers_origin_head() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    let _origin = fx.setup_origin();

    let info =
        operations::default_baseline(&fx.registry, &fx.repo_str(), &fx.workspace).expect("baseline");
    assert_eq!(info.baseline_ref.as_deref(), Some("origin/main"));
    assert_eq!(info.remote.as_deref(), Some("origin"));
}

#[test]
fn list_remote_branches_lists_origin_refs_without_head() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    let _origin = fx.setup_origin();

    let result = operations::list_remote_branches(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("list_remote_branches");
    assert!(result.branches.iter().any(|b| b == "origin/main"));
    assert!(result
        .branches
        .iter()
        .all(|b| !b.ends_with("/HEAD")));
}

#[test]
fn worktree_create_creates_sibling_branch_and_authorizes() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let result = operations::worktree_create(&fx.registry, &fx.repo_str(), "fix-login", None, &fx.workspace)
        .expect("worktree_create");
    assert_eq!(result.branch, "fix-login");
    assert!(result.worktree_path.ends_with("-fix-login"), "sibling naming, got {}", result.worktree_path);

    let wt_local = std::fs::canonicalize(&result.worktree_path).unwrap();
    assert!(wt_local.is_dir());
    assert!(fx.registry.is_authorized(&wt_local), "created path must be authorized");
    assert_eq!(
        common::git_output(&wt_local, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "fix-login"
    );

    operations::worktree_remove(&fx.registry, &fx.repo_str(), &result.worktree_path, true, true, &fx.workspace)
        .expect("cleanup worktree_remove");
    assert!(!wt_local.exists());
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--verify", "--quiet", "refs/heads/fix-login"])
        .current_dir(&fx.repo_path)
        .output()
        .unwrap();
    assert!(!out.status.success(), "branch must be deleted");
}

#[test]
fn worktree_create_rejects_unsafe_branch_names() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    for bad in ["", "-f", "--force", "a..b", "a:b", "a b"] {
        match operations::worktree_create(&fx.registry, &fx.repo_str(), bad, None, &fx.workspace) {
            Err(GitError::InvalidInput(_)) => {}
            other => panic!("expected InvalidInput for {bad:?}, got {other:?}"),
        }
    }
}

#[test]
fn worktree_create_rejects_existing_branch() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.run_git(&["branch", "feature"]);

    match operations::worktree_create(&fx.registry, &fx.repo_str(), "feature", None, &fx.workspace) {
        Err(GitError::InvalidInput(msg)) => {
            assert!(msg.contains("already exists"), "message: {msg}");
        }
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

#[test]
fn worktree_create_with_remote_start_sets_upstream() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    let _origin = fx.setup_origin();

    let result = operations::worktree_create(&fx.registry, &fx.repo_str(), "fix", None, &fx.workspace)
        .expect("worktree_create");
    assert_eq!(
        common::git_output(&fx.repo_path, &["config", "branch.fix.remote"]),
        "origin",
        "baseline start must set upstream tracking"
    );

    operations::worktree_remove(&fx.registry, &fx.repo_str(), &result.worktree_path, true, true, &fx.workspace)
        .expect("cleanup");
}

#[test]
fn worktree_remove_rejects_unregistered_and_main_paths() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let stranger = fx.repo_path.join("not-a-worktree");
    std::fs::create_dir_all(&stranger).unwrap();
    match operations::worktree_remove(&fx.registry, &fx.repo_str(), &to_canon(&stranger), true, true, &fx.workspace) {
        Err(GitError::InvalidInput(_)) => {}
        other => panic!("expected InvalidInput for non-worktree dir, got {other:?}"),
    }

    match operations::worktree_remove(&fx.registry, &fx.repo_str(), &fx.repo_str(), true, true, &fx.workspace) {
        Err(GitError::InvalidInput(msg)) => {
            assert!(msg.contains("main worktree"), "message: {msg}");
        }
        other => panic!("expected InvalidInput for main worktree, got {other:?}"),
    }
}

#[test]
fn review_status_lists_committed_and_uncommitted_changes_vs_baseline() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "one\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let wt = operations::worktree_create(&fx.registry, &fx.repo_str(), "feature", Some("main"), &fx.workspace)
        .expect("worktree_create");
    let wt_local = std::fs::canonicalize(&wt.worktree_path).unwrap();
    std::fs::write(wt_local.join("b.txt"), "new file\n").unwrap();
    common::git_output(&wt_local, &["add", "b.txt"]);
    common::git_output(&wt_local, &["commit", "-q", "-m", "feat"]);
    std::fs::write(wt_local.join("a.txt"), "one\ntwo\n").unwrap();

    let rs = operations::review_status(&fx.registry, &wt.worktree_path, "main", &fx.workspace)
        .expect("review_status");
    assert_eq!(rs.files_changed, 2);
    assert!(rs.additions >= 2, "additions counted, got {}", rs.additions);
    let a = rs.files.iter().find(|f| f.path == "a.txt").expect("a.txt listed");
    assert_eq!(a.status, "M");
    assert!(rs.files.iter().any(|f| f.path == "b.txt" && f.status == "A"));

    let dc = operations::diff_content(&fx.registry, &wt.worktree_path, "a.txt", false, None, Some("main"), &fx.workspace)
        .expect("diff_content");
    assert_eq!(dc.original_content, "one\n");
    assert_eq!(dc.modified_content, "one\ntwo\n");

    operations::worktree_remove(&fx.registry, &fx.repo_str(), &wt.worktree_path, true, true, &fx.workspace)
        .expect("cleanup");
}

#[test]
fn review_survives_unborn_head_in_fresh_worktree() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "one\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let wt = operations::worktree_create(&fx.registry, &fx.repo_str(), "fresh", Some("main"), &fx.workspace)
        .expect("worktree_create");
    let wt_local = std::fs::canonicalize(&wt.worktree_path).unwrap();
    std::fs::write(wt_local.join("a.txt"), "one\nedited\n").unwrap();

    // No commits on the branch yet: the three-dot diff cannot resolve a merge
    // base, so both surfaces must fall back to the base commit itself.
    let rs = operations::review_status(&fx.registry, &wt.worktree_path, "main", &fx.workspace)
        .expect("review_status");
    assert!(rs.files.iter().any(|f| f.path == "a.txt" && f.status == "M"));

    let dc = operations::diff_content(&fx.registry, &wt.worktree_path, "a.txt", false, None, Some("main"), &fx.workspace)
        .expect("diff_content");
    assert_eq!(dc.original_content, "one\n");
    assert_eq!(dc.modified_content, "one\nedited\n");

    operations::worktree_remove(&fx.registry, &fx.repo_str(), &wt.worktree_path, true, true, &fx.workspace)
        .expect("cleanup");
}

#[test]
fn worktree_list_status_reports_branch_and_dirty_counts() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let clean = operations::worktree_create(&fx.registry, &fx.repo_str(), "clean-wt", Some("main"), &fx.workspace)
        .expect("create clean");
    let dirty = operations::worktree_create(&fx.registry, &fx.repo_str(), "dirty-wt", Some("main"), &fx.workspace)
        .expect("create dirty");
    let dirty_local = std::fs::canonicalize(&dirty.worktree_path).unwrap();
    std::fs::write(dirty_local.join("a.txt"), "changed\n").unwrap();
    std::fs::write(dirty_local.join("new.txt"), "untracked\n").unwrap();

    let list = operations::worktree_list_status(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("list status");
    // the main worktree itself must not appear
    assert!(list.iter().all(|e| !e.worktree_path.contains("dirty-wt") || e.worktree_path.ends_with("dirty-wt")));
    let clean_entry = list.iter().find(|e| e.branch.as_deref() == Some("clean-wt")).expect("clean listed");
    assert_eq!(clean_entry.dirty, 0);
    let dirty_entry = list.iter().find(|e| e.branch.as_deref() == Some("dirty-wt")).expect("dirty listed");
    assert_eq!(dirty_entry.dirty, 2, "modified + untracked both count");

    operations::worktree_remove(&fx.registry, &fx.repo_str(), &clean.worktree_path, true, true, &fx.workspace).unwrap();
    operations::worktree_remove(&fx.registry, &fx.repo_str(), &dirty.worktree_path, true, true, &fx.workspace).unwrap();
}
