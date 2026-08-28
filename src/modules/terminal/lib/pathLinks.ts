/**
 * File-path extraction from terminal lines and the click-to-open plumbing.
 * Pure extraction lives here so it stays testable; the xterm link provider
 * lives in fileLinkProvider.ts.
 */

export type PathMatch = {
  /** 0-based start index into the source string. */
  start: number;
  /** The path text without the :line:col suffix. */
  text: string;
  line: number | null;
  col: number | null;
};

const TOKEN = "[A-Za-z0-9_.@+\\-]+";
const SEPS = "[/\\\\]";
const ABS_WIN = `[A-Za-z]:${SEPS}${TOKEN}(?:${SEPS}${TOKEN})*`;
const ABS_UNIX = `\\/${TOKEN}(?:${SEPS}${TOKEN})*`;
const REL = `\\.{1,2}${SEPS}${TOKEN}(?:${SEPS}${TOKEN})*`;
const LOC = ":(\\d{1,5})(?::(\\d{1,5}))?";

const PATH_WITH_LOC_RE = new RegExp(
  `(${ABS_WIN}|${ABS_UNIX}|${REL})(${LOC})?`,
  "g",
);

/**
 * Path-shaped tokens in a terminal line: absolute POSIX or Windows paths and
 * explicit ./ ../ relatives, optionally followed by :line or :line:col in
 * compiler-output style. Anything else (bare words, URLs) is skipped; final
 * existence is checked at click time so over-matching only costs a hover
 * underline.
 */
export function findPathMatches(input: string): PathMatch[] {
  const out: PathMatch[] = [];
  PATH_WITH_LOC_RE.lastIndex = 0;
  for (let m = PATH_WITH_LOC_RE.exec(input); m !== null; m = PATH_WITH_LOC_RE.exec(input)) {
    const text = m[1];
    if (!text) continue;
    const prev = m.index > 0 ? input[m.index - 1] : "";
    // Reject matches glued to a word, URL scheme, or authority slashes
    // ("https://x" would otherwise match the s: as a windows drive).
    if (/[\w:./]/.test(prev)) continue;
    out.push({
      start: m.index,
      text,
      line: m[3] ? Number(m[3]) : null,
      col: m[4] ? Number(m[4]) : null,
    });
  }
  return out;
}

/** Join a relative terminal path onto the leaf's OSC 7 cwd, forward slashes. */
export function resolveTerminalPath(
  path: string,
  cwd: string | null,
): string | null {
  const norm = path.replace(/\\/g, "/");
  const isWin = /^[A-Za-z]:\//.test(norm);
  if (norm.startsWith("/") || isWin) return norm;
  if (!cwd) return null;
  const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return null;
  // Leading ./ is the common relative form; ../ segments resolve naively
  // (no fs walk) so the existence check catches anything malformed.
  const parts = base.split("/");
  for (const seg of norm.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

export type FileLinkOpener = (
  path: string,
  line: number | null,
  col: number | null,
) => void;

let opener: FileLinkOpener | null = null;

export function setFileLinkOpener(fn: FileLinkOpener): void {
  opener = fn;
}

export function dispatchFileLink(
  path: string,
  line: number | null,
  col: number | null,
): void {
  opener?.(path, line, col);
}
