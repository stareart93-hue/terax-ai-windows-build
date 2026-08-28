import { useCallback, useEffect, useState } from "react";
import {
  native,
  type GitRepoInfo,
  type GitReviewFile,
  type GitReviewStatusResult,
} from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setWorktreeBaseline } from "@/modules/settings/store";

import { useGitSignalRefresh } from "./lib/useGitSignalRefresh";

export type BranchReviewState = {
  /** Effective baseline: the settings override, else the git-detected default. */
  baseline: string | null;
  files: GitReviewFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Persist a per-repo baseline override and refetch. */
  setBaseline: (ref: string) => void;
};

export function useBranchReview(
  isOpen: boolean,
  repo: GitRepoInfo | null,
  enabled: boolean,
): BranchReviewState {
  const repoRoot = repo?.repoRoot ?? null;
  const override = usePreferencesStore((s) =>
    repoRoot ? (s.worktreeBaseline[repoRoot] ?? null) : null,
  );
  const [autoBaseline, setAutoBaseline] = useState<string | null>(null);
  const [result, setResult] = useState<GitReviewStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const baseline = override ?? autoBaseline;

  useEffect(() => {
    if (!isOpen || !repoRoot || override) {
      setAutoBaseline(null);
      return;
    }
    let cancelled = false;
    void native
      .gitDefaultBaseline(repoRoot)
      .then((info) => {
        if (!cancelled) setAutoBaseline(info.baselineRef);
      })
      .catch(() => {
        if (!cancelled) setAutoBaseline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, repoRoot, override]);

  // token is an intentional refresh trigger; the effect body does not read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh trigger
  useEffect(() => {
    if (!isOpen || !enabled || !repoRoot || !baseline) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }    let cancelled = false;
    setLoading(true);
    setError(null);
    void native
      .gitReviewStatus(repoRoot, baseline)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setResult(null);
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, enabled, repoRoot, baseline, token]);

  const refresh = useCallback(() => setToken((t) => t + 1), []);
  useGitSignalRefresh(isOpen && enabled && !!repoRoot && !!baseline, refresh);
  const setBaseline = useCallback(
    (ref: string) => {
      if (!repoRoot || !ref) return;
      void setWorktreeBaseline(repoRoot, ref).then(refresh);
    },
    [repoRoot, refresh],
  );

  return {
    baseline,
    files: result?.files ?? [],
    filesChanged: result?.filesChanged ?? 0,
    additions: result?.additions ?? 0,
    deletions: result?.deletions ?? 0,
    loading,
    error,
    refresh,
    setBaseline,
  };
}
