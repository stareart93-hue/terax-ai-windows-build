/**
 * Branch-name sanitation and worktree path preview, mirroring the sibling-dir
 * convention the Rust `git_worktree_create` uses: `<repo parent>/<repo name>-<branch>`.
 */

export function sanitizeBranchName(input: string): string {
  let s = input.trim().replace(/\s+/g, "-");
  s = s.replace(/[^\w./-]/g, "");
  s = s.replace(/\.{2,}/g, ".").replace(/\/{2,}/g, "/");
  s = s.replace(/^[-./]+/, "").replace(/[/.]+$/, "");
  return s;
}

export function previewWorktreePath(repoRoot: string, branch: string): string {
  const norm = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return norm;
  const parent = norm.slice(0, idx);
  const name = norm.slice(idx + 1);
  const seg = sanitizeBranchName(branch).replace(/\//g, "-");
  if (!seg) return norm;
  return `${parent}/${name}-${seg}`;
}

/** Race naming: the first worktree keeps the name, the rest get -2, -3, ... */
export function branchNamesForRace(branch: string, count: number): string[] {
  const base = sanitizeBranchName(branch);
  if (!base || count <= 0) return [];
  const n = Math.min(count, 4);
  return Array.from({ length: n }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`));
}
