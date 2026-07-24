import { presentableDiff } from "@codemirror/merge";

export type HunkStatus = "pending" | "accepted" | "rejected";

/**
 * Compute the hunk list for a (original, proposed) pair using the same diff
 * algorithm the merge view renders, so per-hunk decisions stay aligned with
 * what the user sees.
 */
export function computeHunks(
  original: string,
  proposed: string,
): { fromA: number; toA: number; fromB: number; toB: number }[] {
  return presentableDiff(original, proposed).map((c) => ({
    fromA: c.fromA,
    toA: c.toA,
    fromB: c.fromB,
    toB: c.toB,
  }));
}

/**
 * Build the final content from per-hunk decisions.
 *
 * Walks both documents in order, guided by the diff chunks. For unchanged
 * spans we take text from either side (they're equal). For each changed chunk:
 *  - "accepted" → take the proposed side (keep the AI's edit)
 *  - "rejected" → take the original side (revert the AI's edit)
 *  - "pending"  → take the proposed side (default to applying, matches the
 *                 existing whole-file "Accept" semantics where accept = apply)
 *
 * The result is the file content to write to disk.
 */
export function synthesizeFinalContent(
  original: string,
  proposed: string,
  statuses: HunkStatus[],
): string {
  const chunks = computeHunks(original, proposed);
  let out = "";
  let aPos = 0; // cursor in original
  let bPos = 0; // cursor in proposed

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Unchanged span before this chunk (both sides equal up to the chunk).
    // In a presentable diff, fromA - aPos === fromB - bPos for the common run.
    const commonLen = c.fromA - aPos;
    if (commonLen > 0) {
      out += original.slice(aPos, c.fromA);
    }
    const status = statuses[i] ?? "accepted";
    if (status === "rejected") {
      // keep original text for this chunk
      out += original.slice(c.fromA, c.toA);
    } else {
      // accepted or pending → take proposed
      out += proposed.slice(c.fromB, c.toB);
    }
    aPos = c.toA;
    bPos = c.toB;
  }
  // Trailing unchanged tail (equal on both sides).
  out += original.slice(aPos);
  // bPos tail is the same text; prefer original to avoid drift.
  void bPos;
  return out;
}

/**
 * Does the synthesized result differ from the raw proposed content? When every
 * hunk is accepted/pending, the result equals proposed and a plain write is
 * enough. When any hunk is rejected, we need the override path.
 */
export function hasPartialRejection(statuses: HunkStatus[]): boolean {
  return statuses.some((s) => s === "rejected");
}
