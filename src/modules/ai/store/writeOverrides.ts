/**
 * Per-session write-override maps, keyed by sessionId. Seeded by the AI diff
 * pane (App.tsx) when the user accepts a partial (per-hunk) edit; consumed
 * once by the edit/write_file tools so the model sees success while the disk
 * reflects the user's chosen subset.
 *
 * Kept in its own module — separate from chatRuntime.ts — so that App.tsx can
 * import seedWriteOverride without pulling the heavy @ai-sdk chat runtime into
 * the main window's eager startup bundle.
 */
const writeOverridesBySession = new Map<string, Map<string, string>>();

/** Get (or lazily create) the override map for a session. */
export function getWriteOverrides(sessionId: string): Map<string, string> {
  let m = writeOverridesBySession.get(sessionId);
  if (!m) {
    m = new Map();
    writeOverridesBySession.set(sessionId, m);
  }
  return m;
}

/** Seed a write override for a path in a session. */
export function seedWriteOverride(
  sessionId: string,
  path: string,
  content: string,
): void {
  getWriteOverrides(sessionId).set(path, content);
}
