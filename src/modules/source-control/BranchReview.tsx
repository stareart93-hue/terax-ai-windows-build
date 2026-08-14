import { useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { native, type GitReviewFile } from "@/modules/ai/lib/native";
import { explorerGitTextClass } from "@/modules/explorer/lib/gitStatusColor";
import type { BranchReviewState } from "./useBranchReview";

type Props = {
  repoRoot: string;
  review: BranchReviewState;
  untrackedPaths: string[];
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    baseRef: string | null;
  }) => void;
};

type ReviewRow = {
  key: string;
  path: string;
  originalPath: string | null;
  statusCode: "M" | "A" | "D" | "U" | "R";
};

const STATUS_ORDER: Record<ReviewRow["statusCode"], number> = {
  U: 0,
  M: 1,
  A: 2,
  R: 3,
  D: 4,
};

function normalizeReviewStatus(status: string): ReviewRow["statusCode"] {
  switch (status.trim().toUpperCase()) {
    case "A":
      return "A";
    case "D":
      return "D";
    case "R":
    case "C":
      return "R";
    default:
      return "M";
  }
}

function BaselinePicker({
  repoRoot,
  review,
}: {
  repoRoot: string;
  review: BranchReviewState;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<string[] | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open || choices || !repoRoot) return;
    const id = ++requestRef.current;
    void Promise.all([
      native.gitListBranches(repoRoot).catch(() => null),
      native.gitListRemoteBranches(repoRoot).catch(() => null),
    ]).then(([local, remote]) => {
      if (id !== requestRef.current) return;
      const names = new Set<string>();
      for (const b of local?.branches ?? []) {
        if (b.kind === "local" && b.name && !b.name.startsWith("(")) {
          names.add(b.name);
        }
      }
      for (const n of remote?.branches ?? []) names.add(n);
      setChoices([...names].sort());
    });
  }, [open, choices, repoRoot]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md bg-foreground/5 px-2 py-1 font-mono text-[11px] font-medium leading-none text-foreground transition-colors hover:bg-foreground/10"
          title="Change the baseline this review diffs against"
        >
          <span className="text-muted-foreground">vs</span>
          <span className="max-w-45 truncate">{review.baseline}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-72 overflow-y-auto">
          {choices === null ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              Loading branches…
            </div>
          ) : (
            choices.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  review.setBaseline(name);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left font-mono text-[11.5px] transition-colors hover:bg-foreground/[0.06]",
                  name === review.baseline
                    ? "text-foreground"
                    : "text-foreground/80",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {name === review.baseline ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                    baseline
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BranchReview({ repoRoot, review, untrackedPaths, onOpenDiff }: Props) {
  const rows = useMemo<ReviewRow[]>(() => {
    const out: ReviewRow[] = review.files.map((f: GitReviewFile) => ({
      key: f.path,
      path: f.path,
      originalPath: f.originalPath,
      statusCode: normalizeReviewStatus(f.status),
    }));
    const seen = new Set(out.map((r) => r.path));
    for (const p of untrackedPaths) {
      if (seen.has(p)) continue;
      out.push({ key: p, path: p, originalPath: null, statusCode: "U" });
    }
    out.sort(
      (a, b) =>
        STATUS_ORDER[a.statusCode] - STATUS_ORDER[b.statusCode] ||
        a.path.localeCompare(b.path),
    );
    return out;
  }, [review.files, untrackedPaths]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/40 px-2.5 py-2">
        <BaselinePicker repoRoot={repoRoot} review={review} />
        <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
          {rows.length} {rows.length === 1 ? "file" : "files"}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10.5px] font-medium tabular-nums">
          <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
            <HugeiconsIcon icon={ArrowUp01Icon} size={9} strokeWidth={2.2} />
            {review.additions}
          </span>
          <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400">
            <HugeiconsIcon icon={ArrowDown01Icon} size={9} strokeWidth={2.2} />
            {review.deletions}
          </span>
        </span>
        {review.loading ? <Spinner className="size-3 shrink-0" /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        {review.error ? (
          <div className="px-3 py-4 text-[11.5px] leading-snug text-destructive">
            {review.error}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11.5px] text-muted-foreground">
            No changes vs {review.baseline}.
          </div>
        ) : (
          rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() =>
                onOpenDiff({
                  path: row.path,
                  repoRoot,
                  mode: "+",
                  originalPath: row.originalPath,
                  baseRef: review.baseline,
                })
              }
              className="group flex w-full cursor-pointer items-center gap-2 px-2.5 py-[5px] text-left transition-colors hover:bg-foreground/[0.05]"
            >
              <span
                className={cn(
                  "w-3 shrink-0 text-center font-mono text-[10.5px] font-bold",
                  explorerGitTextClass(row.statusCode),
                )}
              >
                {row.statusCode}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/90">
                {row.path}
              </span>
              {row.originalPath ? (
                <span className="max-w-35 shrink-0 truncate text-[10px] text-muted-foreground/70">
                  {row.originalPath}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
