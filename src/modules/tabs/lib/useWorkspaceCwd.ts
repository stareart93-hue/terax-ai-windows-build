import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  /** Pane-level cwd of the active terminal leaf, when available. More precise
   *  than the tab-level cwd for split panes. */
  activeTerminalLeafCwd?: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);

  useEffect(() => {
    if (activeTab?.kind !== "terminal") return;
    const cwd = activeTerminalLeafCwd ?? activeTab.cwd;
    if (cwd) {
      lastTerminalCwd.current = cwd;
    }
  }, [activeTab, activeTerminalLeafCwd]);

  const explorerRoot = useMemo<string | null>(() => {
    if (activeTab?.kind === "terminal") {
      // Prefer the active pane's cwd (split-pane aware) over the tab-level cwd.
      const cwd = activeTerminalLeafCwd ?? activeTab.cwd;
      if (cwd) return cwd;
    }
    if (lastTerminalCwd.current) return lastTerminalCwd.current;
    const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
    if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    return home;
  }, [activeTab, tabs, home, activeTerminalLeafCwd]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTab?.kind === "terminal") {
      const cwd = activeTerminalLeafCwd ?? activeTab.cwd;
      if (cwd) return cwd;
    }
    // Editor tabs inherit the last terminal's cwd (or workspace home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return lastTerminalCwd.current ?? home ?? undefined;
  }, [activeTab, home, activeTerminalLeafCwd]);

  return { explorerRoot, inheritedCwdForNewTab };
}
