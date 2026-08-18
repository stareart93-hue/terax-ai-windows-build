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
  Delete02Icon,
  Folder01Icon,
  PlayIcon,
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

export function WorktreeOverview({
  repoRoot,
  rows,
  loading,
  error,
  getWorktreeAgent,
  onOpenTerminal,
  onLaunchClaude,
  onChanged,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<GitWorktreeStatusEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const openWorktreeDialog = useWorktreeDialogStore((s) => s.openDialog);

  const handleRemove = async () => {
    if (!pendingDelete) return;
    setRemoving(true);
    try {
      await native.gitWorktreeRemove(repoRoot, pendingDelete.worktreePath, true, true);
      toast.success(`Removed worktree ${pendingDelete.branch ?? ""}`.trim());
      setPendingDelete(null);
      onChanged();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRemoving(false);
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
                {row.dirty > 0 ? (
                  <span className="shrink-0 rounded-md border border-border/60 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {row.dirty}
                  </span>
                ) : null}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title="Open a terminal here"
                    onClick={() => onOpenTerminal(row.worktreePath)}
                    className="cursor-pointer rounded p-1 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <HugeiconsIcon icon={Folder01Icon} size={12} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    title="Launch a Claude Code session here"
                    onClick={() =>
                      onLaunchClaude({
                        worktreePath: row.worktreePath,
                        branch: row.branch ?? tail,
                        claude: true,
                        prompt: "",
                      })
                    }
                    className="cursor-pointer rounded p-1 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    title="Remove worktree and branch"
                    disabled={removing}
                    onClick={() => setPendingDelete(row)}
                    className="cursor-pointer rounded p-1 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-destructive"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.8} />
                  </button>
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
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                void handleRemove();
              }}
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
