/**
 * Normalize line endings before passing content to @codemirror/merge.
 *
 * The Rust backend returns file blobs (git show / read_text_file) without
 * line-ending normalization. When a file is CRLF (common on Windows checkouts,
 * especially Python), the merge view's internal line splitter discards \r
 * inconsistently between the original and modified sides, causing every line
 * to show as changed — an "inaccurate diff" that is really a line-ending
 * mismatch. Normalizing both sides to \n before diffing fixes this.
 *
 * Also strips a trailing stray \r that survives split('\r?\n') in some edge
 * cases (a final line ending in \r\n produces an empty trailing element that
 * can offset the alignment).
 */
export function normalizeForDiff(content: string): string {
  // \r\n -> \n, then clean any remaining lone \r (old Mac endings).
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * @codemirror/merge's default scanLimit is 500. When min(lenA, lenB) exceeds
 * scanLimit * 16 (= 8000 lines), it silently falls back to a fast-but-imprecise
 * "crude" matcher, producing visibly wrong hunks on large files. Raise the
 * limit so typical source files (even a few thousand lines) use the precise
 * Myers algorithm. The cost is O(ND) time on very large diffs, which is
 * acceptable for a review surface.
 */
export const DIFF_SCAN_LIMIT = 4000;
