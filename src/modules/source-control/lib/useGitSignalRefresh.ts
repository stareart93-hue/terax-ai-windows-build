import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { listenFsChanged } from "@/modules/explorer/lib/watch";

const DEBOUNCE_MS = 600;

/**
 * Debounced refresh driven by the same signals the Changes list uses: agent
 * turns finishing, local commands returning to a prompt, and watched-file
 * edits. No-op while the surface is not visible.
 */
export function useGitSignalRefresh(enabled: boolean, refresh: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        refresh();
      }, DEBOUNCE_MS);
    };

    const disposers: (() => void)[] = [];
    void listen<{ kind: string }>("terax:agent-signal", (e) => {
      const kind = e.payload.kind;
      if (kind !== "working" && kind !== "finished" && kind !== "idle" && kind !== "exited") {
        return;
      }
      bump();
    }).then((un) => disposers.push(() => un()));
    void listenFsChanged(() => bump()).then((un) => disposers.push(un));

    const onCommandComplete = () => bump();
    window.addEventListener("terax:terminal-command-complete", onCommandComplete);
    disposers.push(() =>
      window.removeEventListener("terax:terminal-command-complete", onCommandComplete),
    );

    return () => {
      if (timer) window.clearTimeout(timer);
      for (const dispose of disposers) dispose();
    };
  }, [enabled, refresh]);
}
