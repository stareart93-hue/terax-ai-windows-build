import { useCallback, useMemo } from "react";
import { native } from "@/modules/ai/lib/native";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";
import { findLeafCwd, hasLeaf } from "@/modules/terminal";
import { useSourceControl } from "./useSourceControl";

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

type Params = {
  activeTab: Tab | undefined;
  tabs: Tab[];
  activeTerminalLeafCwd: string | null;
  explorerRoot: string | null;
  launchCwd: string | null;
  launchCwdResolved: boolean;
  home: string | null;
  sidebarView: SidebarViewId;
  cycleSidebarView: (view: SidebarViewId) => void;
  openCommitHistoryTab: (args: {
    repoRoot: string;
    branch: string | null;
  }) => void;
};

export function agentSourceControlPath(
  tabs: Tab[],
  sessions: ReturnType<typeof useAgentStore.getState>["sessions"],
  activeTab?: Tab,
): string | null {
  if (activeTab?.kind === "terminal") {
    const activeSession = sessions[activeTab.activeLeafId];
    if (activeSession?.agent.toLowerCase().includes("claude")) {
      return (
        findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null
      );
    }
  }

  const candidates = Object.values(sessions)
    .filter((s) => s.agent.toLowerCase().includes("claude"))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  for (const session of candidates) {
    const tab = tabs.find(
      (t) => t.kind === "terminal" && hasLeaf(t.paneTree, session.leafId),
    );
    if (tab?.kind !== "terminal") continue;
    return findLeafCwd(tab.paneTree, session.leafId) ?? tab.cwd ?? null;
  }

  return null;
}

/**
 * Resolves the source-control context path off the active tab and feeds the
 * source-control summary. When git is not active the badge tracks a stable
 * per-session path so tab switches / cd don't re-fire git IPC.
 */
export function useSourceControlContext({
  activeTab,
  tabs,
  activeTerminalLeafCwd,
  explorerRoot,
  launchCwd,
  launchCwdResolved,
  home,
  sidebarView,
  cycleSidebarView,
  openCommitHistoryTab,
}: Params) {
  const workspaceFallbackPath = launchCwdResolved
    ? (launchCwd ?? home ?? null)
    : null;
  const agentSessions = useAgentStore((s) => s.sessions);
  const agentContextPath = useMemo(
    () => agentSourceControlPath(tabs, agentSessions, activeTab),
    [tabs, agentSessions, activeTab],
  );
  const sourceControlContextPath = (() => {
    if (
      activeTab?.kind === "git-diff" ||
      activeTab?.kind === "git-commit-file" ||
      activeTab?.kind === "git-history"
    ) {
      return activeTab.repoRoot;
    }
    if (sidebarView === "source-control" && agentContextPath) {
      return agentContextPath;
    }
    if (activeTab?.kind === "terminal") {
      return activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
    }
    if (activeTab?.kind === "editor") return dirname(activeTab.path);
    return explorerRoot ?? workspaceFallbackPath;
  })();
  const hasOpenGitTab = useMemo(
    () =>
      tabs.some(
        (t) =>
          t.kind === "git-diff" ||
          t.kind === "git-history" ||
          t.kind === "git-commit-file",
      ),
    [tabs],
  );
  const sourceControlActive = hasOpenGitTab || sidebarView === "source-control";
  // Ambient path tracks the explorer root so the rail badge and explorer git
  // decorations reflect the repo you are actually looking at. cd-within-repo
  // churn is absorbed by the status TTL + reusable-root path in useSourceControl.
  const badgeContextPath = explorerRoot ?? workspaceFallbackPath;
  const sourceControlPath = sourceControlActive
    ? sourceControlContextPath
    : badgeContextPath;
  const sourceControl = useSourceControl(sourceControlPath, true);

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    if (known) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    if (!sourceControlContextPath) return;
    try {
      const repo = await native.gitResolveRepo(sourceControlContextPath);
      if (!repo) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    } catch {
      /* noop */
    }
  }, [
    openCommitHistoryTab,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
    sourceControlContextPath,
  ]);

  return { sourceControl, toggleSourceControl, openGitGraphFromContext };
}
