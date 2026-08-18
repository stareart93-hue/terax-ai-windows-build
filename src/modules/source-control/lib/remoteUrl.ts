/**
 * GitHub compare URL for the "push and open a PR draft" flow. Accepts the
 * https, scp-style, and ssh remote forms; non-GitHub remotes resolve to null
 * so the UI can hide the action.
 */
export function githubCompareUrl(
  remoteUrl: string,
  baseRef: string,
  branch: string,
): string | null {
  const patterns = [
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i,
  ];
  for (const p of patterns) {
    const m = remoteUrl.trim().match(p);
    if (m) {
      // Slashes are meaningful in compare refs; encode each segment only. The
      // base may be remote-tracking (origin/main) and loses its prefix; the
      // head is always a local branch name and must keep its slashes.
      const enc = (ref: string) =>
        ref
          .split("/")
          .map(encodeURIComponent)
          .join("/");
      const base = enc(baseRef.replace(/^[^/]+\//, ""));
      const head = enc(branch);
      return `https://github.com/${m[1]}/${m[2]}/compare/${base}...${head}?expand=1`;
    }
  }
  return null;
}
