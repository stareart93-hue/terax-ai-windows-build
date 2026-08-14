import { invoke } from "@tauri-apps/api/core";
import { whenSessionReady, writeToSession } from "@/modules/terminal";

export type TuiWaitResult = "ready" | "blocked" | "gone" | "timeout";

export function claudeTuiNeedsUserChoice(buf: string): boolean {
  const s = buf.toLowerCase();
  return (
    s.includes("do you trust") ||
    s.includes("permission") ||
    s.includes("select an option") ||
    s.includes("choose an option") ||
    (s.includes("yes") && s.includes("no") && s.includes("enter"))
  );
}

export function claudeTuiAcceptsPrompt(buf: string): boolean {
  const s = buf.toLowerCase();
  return s.includes("shortcuts") && !claudeTuiNeedsUserChoice(s);
}

export async function waitForClaudeTuiReady(
  readBuf: () => string | null,
  timeoutMs = 8000,
): Promise<TuiWaitResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = readBuf();
    if (buf === null) return "gone";
    if (claudeTuiNeedsUserChoice(buf)) return "blocked";
    if (claudeTuiAcceptsPrompt(buf)) return "ready";
    await new Promise((r) => setTimeout(r, 120));
  }
  return "timeout";
}

type LaunchParams = {
  leafId: number;
  /** Terminal buffer reader used to detect the Claude TUI. */
  readBuf: () => string | null;
  /** Optional first prompt, pasted once the TUI accepts input. */
  prompt?: string;
};

/**
 * Start a Claude Code session inside an existing terminal leaf: enable the
 * Terax hooks, wait for the PTY, type `claude`, then wait for the TUI and
 * optionally paste the first prompt. Shared by the managed-agent flow and the
 * user-initiated worktree launcher.
 */
export async function launchClaudeTerminal({
  leafId,
  readBuf,
  prompt,
}: LaunchParams): Promise<TuiWaitResult> {
  const hooksReady = invoke("agent_enable_hooks", {
    agent: "claude",
  }).catch(() => {});
  await Promise.all([whenSessionReady(leafId), hooksReady]);
  if (!writeToSession(leafId, "claude\r")) return "gone";
  const result = await waitForClaudeTuiReady(readBuf);
  if (result !== "ready") return result;
  if (prompt?.trim()) {
    // Claude's TUI treats a trailing CR in the same write chunk as a literal
    // newline; send Enter separately so it registers as a submit.
    if (!writeToSession(leafId, `\x1b[200~${prompt.trim()}\x1b[201~`)) {
      return "gone";
    }
    setTimeout(() => writeToSession(leafId, "\r"), 120);
  }
  return "ready";
}
