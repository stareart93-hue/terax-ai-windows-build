import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef, useState } from "react";
import {
  branchNamesForRace,
  previewWorktreePath,
  sanitizeBranchName,
} from "./lib/worktreePath";

export type WorktreeSessionRequest = {
  worktreePath: string;
  branch: string;
  claude: boolean;
  prompt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string | null;
  onCreated: (request: WorktreeSessionRequest) => void;
};

type Busy = "idle" | "fetching" | "creating";

export function NewWorktreeDialog({
  open,
  onOpenChange,
  repoRoot,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [count, setCount] = useState(1);
  const [startRef, setStartRef] = useState<string | null>(null);
  const [launch, setLaunch] = useState<"claude" | "terminal">("claude");
  const [fetchFirst, setFetchFirst] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const baselineOverride = usePreferencesStore((s) =>
    repoRoot ? (s.worktreeBaseline[repoRoot] ?? null) : null,
  );
  const baselineOverrideRef = useRef(baselineOverride);
  baselineOverrideRef.current = baselineOverride;

  const branch = sanitizeBranchName(name);

  useEffect(() => {
    if (!open || !repoRoot) return;
    setName("");
    setCount(1);
    setLaunch("claude");
    setFetchFirst(true);
    setPrompt("");
    setBusy("idle");
    setError(null);
    setBaseline(null);
    setLocalBranches([]);
    setRemoteBranches([]);
    setStartRef(baselineOverrideRef.current);
    inputRef.current?.focus();

    let cancelled = false;
    void native
      .gitDefaultBaseline(repoRoot)
      .then((info) => {
        if (cancelled) return;
        setBaseline(info.baselineRef);
        setStartRef((cur) => cur ?? info.baselineRef);
      })
      .catch(() => {});
    void native
      .gitListBranches(repoRoot)
      .then((r) => {
        if (cancelled) return;
        setLocalBranches(
          r.branches
            .filter((b) => b.kind === "local")
            .map((b) => b.name)
            .filter((n) => n && !n.startsWith("(")),
        );
      })
      .catch(() => {});
    void native
      .gitListRemoteBranches(repoRoot)
      .then((r) => {
        if (!cancelled) setRemoteBranches(r.branches);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, repoRoot]);

  const submit = async () => {
    if (!repoRoot) return;
    if (!branch) {
      setError("Branch name is required.");
      inputRef.current?.focus();
      return;
    }
    if (!startRef) {
      setError("Pick a branch to start from.");
      return;
    }
    setError(null);
    if (fetchFirst) setBusy("fetching");
    try {
      if (fetchFirst) await native.gitFetch(repoRoot);
      setBusy("creating");
      for (const branchName of branchNamesForRace(branch, count)) {
        const result = await native.gitWorktreeCreate(
          repoRoot,
          branchName,
          startRef,
        );
        await native.workspaceAuthorize(result.worktreePath).catch(() => {});
        onCreated({
          worktreePath: result.worktreePath,
          branch: result.branch,
          claude: launch === "claude",
          prompt,
        });
      }
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  };

  const effectiveBaseline = baselineOverride ?? baseline;
  const localChoices = localBranches.filter((n) => n !== effectiveBaseline);
  const remoteChoices = remoteBranches.filter(
    (n) => n !== effectiveBaseline && !localBranches.includes(n),
  );
  const preview = repoRoot ? previewWorktreePath(repoRoot, branch) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New worktree</DialogTitle>
          <DialogDescription>
            Create a linked worktree on a fresh branch, then open it as a
            terminal session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="worktree-branch">
              Branch name
            </label>
            <Input
              id="worktree-branch"
              ref={inputRef}
              value={name}
              placeholder="fix-login-race"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && busy === "idle") void submit();
              }}
              autoFocus
            />
            {branch && preview && (
              <span
                className="truncate font-mono text-[10.5px] text-muted-foreground"
                title={preview}
              >
                {preview}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Start from</span>
            <Select
              value={startRef ?? ""}
              onValueChange={setStartRef}
              disabled={busy !== "idle"}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {effectiveBaseline ? (
                    <SelectItem value={effectiveBaseline}>
                      {effectiveBaseline} (baseline)
                    </SelectItem>
                  ) : null}
                  {localChoices.length > 0 && (
                    <SelectLabel>Local branches</SelectLabel>
                  )}
                  {localChoices.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                  {remoteChoices.length > 0 && (
                    <SelectLabel>Remote branches</SelectLabel>
                  )}
                  {remoteChoices.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Open as</span>
            <Select
              value={launch}
              onValueChange={(v) => setLaunch(v === "terminal" ? "terminal" : "claude")}
              disabled={busy !== "idle"}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude Code session</SelectItem>
                <SelectItem value="terminal">Blank terminal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {launch === "claude" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">
                Initial prompt (optional)
              </span>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should Claude work on in this worktree?"
                rows={3}
                className="resize-none text-[12.5px]"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              Parallel worktrees
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy !== "idle"}
                  onClick={() => setCount(n)}
                  title={n === 1 ? "One worktree" : `Race ${n} agents on the same task`}
                  className={
                    "h-6 w-7 cursor-pointer rounded-md border text-[11px] font-semibold tabular-nums transition-colors disabled:cursor-default disabled:opacity-50 " +
                    (count === n
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-foreground/[0.05]")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {count > 1 && branch && (
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {branchNamesForRace(branch, count).join(", ")}
            </span>
          )}

          <div className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              id="worktree-fetch-first"
              checked={fetchFirst}
              onCheckedChange={(v) => setFetchFirst(v === true)}
              disabled={busy !== "idle"}
            />
            <label htmlFor="worktree-fetch-first" className="cursor-pointer">
              Fetch latest before creating
            </label>
          </div>

          {error && (
            <p className="text-xs leading-snug text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy !== "idle"}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy !== "idle" || !branch}>
            {busy === "fetching"
              ? "Fetching…"
              : busy === "creating"
                ? "Creating…"
                : "Create worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
