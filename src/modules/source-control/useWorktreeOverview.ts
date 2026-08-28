import { useCallback, useEffect, useState } from "react";
import {
  native,
  type GitRepoInfo,
  type GitWorktreeStatusEntry,
} from "@/modules/ai/lib/native";

import { useGitSignalRefresh } from "./lib/useGitSignalRefresh";

export type WorktreeOverviewState = {
  rows: GitWorktreeStatusEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useWorktreeOverview(
  isOpen: boolean,
  repo: GitRepoInfo | null,
  enabled: boolean,
): WorktreeOverviewState {
  const [rows, setRows] = useState<GitWorktreeStatusEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  // token is an intentional refresh trigger; the effect body does not read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh trigger
  useEffect(() => {
    if (!isOpen || !enabled || !repo) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void native
      .gitWorktreeListStatus(repo.repoRoot)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([]);
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, enabled, repo, token]);

  const refresh = useCallback(() => setToken((t) => t + 1), []);
  useGitSignalRefresh(isOpen && enabled && !!repo, refresh);

  return { rows, loading, error, refresh };
}
