import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  Folder01Icon,
  PlayIcon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { native, type GitWorktreeStatusEntry } from "@/modules/ai/lib/native";
import { useWorktreeDialogStore } from "./lib/worktreeDialogStore";

export type WorktreeAgentInfo = { agent: string; status: string } | null;

type Props = {
  repoRoot: string;
  rows: GitWorktreeStatusEntry[];
  loading: boolean;
  error: string | null;
  baseline: string | null;
  getWorktreeAgent?: (path: string) => WorktreeAgentInfo;
  onOpenTerminal: (path: string) => void;
  onLaunchClaude: (input: {
    worktreePath: string;
    branch: string;
    claude: boolean;
    prompt: string;
  }) => void;
  onChanged: () => void;
};

function agentDotClass(status: string): string {
  switch (status) {
    case "working":
      return "bg-amber-500 animate-pulse";
    case "attention":
      return "bg-rose-500";
    case "finished":
      return "bg-emerald-500";
    case "idle":
      return "bg-emerald-500/70";
    default:
      return "bg-muted-foreground/40";
  }
}

function RowIcon({
  title,
  disabled,
  onClick,
  icon,
  hoverClass,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof Folder01Icon;
  hoverClass?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "cursor-pointer rounded p-1 text-muted-foreground/70 transition-colors disabled:cursor-default disabled:opacity-40",
        hoverClass ?? "hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.8} />
    </button>
  );
}

function StatBadge({
  children,
  title,
  tone,
}: {
  children: React.ReactNode;
  title: string;
  tone: "neutral" | "up" | "down" | "add" | "del";
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5 text-[10px] font-semibold tabular-nums",
        tone === "up" && "text-sky-600 dark:text-sky-400",
        tone === "down" && "text-amber-600 dark:text-amber-400",
        tone === "add" && "text-emerald-600 dark:text-emerald-400",
        tone === "del" && "text-rose-600 dark:text-rose-400",
        tone === "neutral" && "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function WorktreeOverview({
  repoRoot,
  rows,
  loading,
  error,
  baseline,
  getWorktreeAgent,
  onOpenTerminal,
  onLaunchClaude,
  onChanged,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<GitWorktreeStatusEntry | null>(null);
  const [pendingKeep, setPendingKeep] = useState<GitWorktreeStatusEntry | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const openWorktreeDialog = useWorktreeDialogStore((s) => s.openDialog);

  const handleRemove = async () => {
    if (!pendingDelete) return;
    setBusyPath(pendingDelete.worktreePath);
    try {
      await native.gitWorktreeRemove(repoRoot, pendingDelete.worktreePath, true, true);
      toast.success(`Removed worktree ${pendingDelete.branch ?? ""}`.trim());
      setPendingDelete(null);
      onChanged();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyPath(null);
    }
  };

  const handleKeep = async () => {
    if (!pendingKeep) return;
    setBusyPath(pendingKeep.worktreePath);
    const others = rows.filter((r) => r.worktreePath !== pendingKeep.worktreePath);
    let removed = 0;
    try {
      for (const other of others) {
        try {
          await native.gitWorktreeRemove(repoRoot, other.worktreePath, true, true);
          removed += 1;
        } catch (e) {
          toast.error(`Failed to remove ${other.branch ?? other.worktreePath}: ${e}`);
        }
      }
      if (removed > 0) {
        toast.success(`Removed ${removed} other ${removed === 1 ? "worktree" : "worktrees"}`);
      }
      setPendingKeep(null);
      onChanged();
    } finally {
      setBusyPath(null);
    }
  };

  const handleRebase = async (row: GitWorktreeStatusEntry) => {
    if (!baseline) return;
    setBusyPath(row.worktreePath);
    try {
      await native.gitWorktreeRebase(repoRoot, row.worktreePath, baseline);
      toast.success(`Rebased ${row.branch ?? ""} onto ${baseline}`.trim());
      onChanged();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading ? (
        <div className="flex items-center gap-2 border-b border-border/40 px-2.5 py-2 text-[11px] text-muted-foreground">
          <Spinner className="size-3" />
          Loading worktrees…
        </div>
      ) : null}
      {error ? (
        <div className="px-3 py-4 text-[11.5px] leading-snug text-destructive">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 px-3 py-8 text-center">
          <span className="text-[11.5px] text-muted-foreground">
            No linked worktrees. Create one to run an isolated task or race
            multiple agents.
          </span>
          <Button size="xs" onClick={() => openWorktreeDialog(repoRoot)}>
            New worktree
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
          {rows.map((row) => {
            const agent = getWorktreeAgent?.(row.worktreePath) ?? null;
            const tail = row.worktreePath.split(/[\\/]/).filter(Boolean).pop() ?? row.worktreePath;
            const busy = busyPath === row.worktreePath;
            return (
              <div
                key={row.worktreePath}
                className="group flex items-center gap-2 px-2.5 py-[6px] transition-colors hover:bg-foreground/[0.04]"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    agent ? agentDotClass(agent.status) : "bg-muted-foreground/30",
                  )}
                  title={agent ? `${agent.agent}: ${agent.status}` : "no agent session"}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-[11.5px] text-foreground/90">
                    {row.branch ?? tail}
                  </span>
                  <span
                    className="truncate text-[10px] text-muted-foreground/70"
                    title={row.worktreePath}
                  >
                    {tail}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.dirty > 0 ? (
                    <StatBadge title={`${row.dirty} uncommitted files`} tone="neutral">
                      {row.dirty}
                    </StatBadge>
                  ) : null}
                  {row.ahead > 0 ? (
                    <StatBadge title={`${row.ahead} commits ahead of upstream`} tone="up">
                      <HugeiconsIcon icon={ArrowUp01Icon} size={8} strokeWidth={2.4} />
                      {row.ahead}
                    </StatBadge>
                  ) : null}
                  {row.behind > 0 ? (
                    <StatBadge title={`${row.behind} commits behind upstream`} tone="down">
                      <HugeiconsIcon icon={ArrowDown01Icon} size={8} strokeWidth={2.4} />
                      {row.behind}
                    </StatBadge>
                  ) : null}
                  {(row.additions > 0 || row.deletions > 0) && (
                    <>
                      <StatBadge title="committed additions vs upstream" tone="add">
                        +{row.additions}
                      </StatBadge>
                      <StatBadge title="committed deletions vs upstream" tone="del">
                        −{row.deletions}
                      </StatBadge>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {busy ? (
                    <Spinner className="size-3" />
                  ) : (
                    <>
                      <RowIcon
                        title="Open a terminal here"
                        onClick={() => onOpenTerminal(row.worktreePath)}
                        icon={Folder01Icon}
                      />
                      <RowIcon
                        title="Launch a Claude Code session here"
                        onClick={() =>
                          onLaunchClaude({
                            worktreePath: row.worktreePath,
                            branch: row.branch ?? tail,
                            claude: true,
                            prompt: "",
                          })
                        }
                        icon={PlayIcon}
                      />
                      {baseline && row.behind > 0 ? (
                        <RowIcon
                          title={`Rebase onto ${baseline}`}
                          onClick={() => void handleRebase(row)}
                          icon={RefreshIcon}
                        />
                      ) : null}
                      {rows.length > 1 ? (
                        <RowIcon
                          title="Keep this worktree, remove the others"
                          onClick={() => setPendingKeep(row)}
                          icon={Tick02Icon}
                        />
                      ) : null}
                      <RowIcon
                        title="Remove worktree and branch"
                        onClick={() => setPendingDelete(row)}
                        icon={Delete02Icon}
                        hoverClass="hover:bg-foreground/10 hover:text-destructive"
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove worktree?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the directory and force-deletes the branch{" "}
              <span className="font-mono">{pendingDelete?.branch}</span>.
              Uncommitted changes are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyPath !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyPath !== null}
              onClick={(e) => {
                e.preventDefault();
                void handleRemove();
              }}
            >
              {busyPath !== null ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingKeep !== null}
        onOpenChange={(next) => {
          if (!next) setPendingKeep(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this worktree only?</AlertDialogTitle>
            <AlertDialogDescription>
              Keeps{" "}
              <span className="font-mono">{pendingKeep?.branch}</span> and removes
              the other{" "}
              {rows.filter((r) => r.worktreePath !== pendingKeep?.worktreePath).length}{" "}
              worktree(s) with their branches. Their uncommitted changes are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyPath !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyPath !== null}
              onClick={(e) => {
                e.preventDefault();
                void handleKeep();
              }}
            >
              {busyPath !== null ? "Removing…" : "Remove others"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
