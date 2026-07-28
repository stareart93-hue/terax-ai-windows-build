import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAgentStore } from "../store/agentStore";
import { displayAgent } from "../lib/format";
import type { AgentNotification, AgentStatus } from "../lib/types";

const STATUS_META: Record<
  AgentStatus,
  { dot: string; label: string; tone: string }
> = {
  attention: {
    dot: "bg-primary animate-pulse",
    label: "needs input",
    tone: "font-medium text-primary",
  },
  finished: {
    dot: "bg-sky-500",
    label: "finished",
    tone: "font-medium text-sky-600 dark:text-sky-400",
  },
  working: {
    dot: "bg-muted-foreground/50",
    label: "working",
    tone: "text-muted-foreground",
  },
  idle: {
    dot: "bg-emerald-500",
    label: "idle",
    tone: "text-emerald-600 dark:text-emerald-400",
  },
};

const NOTIF_LABEL: Record<AgentNotification["kind"], string> = {
  attention: "needs input",
  finished: "finished",
  error: "failed",
};

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * A user-facing view of what every running agent is doing right now: live
 * sessions with their current state, plus a recent event feed. Answers the
 * "what is the agent up to?" question that was previously invisible (only a
 * tab spinner + occasional toasts).
 */
export function AgentActivityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sessions = useAgentStore((s) => s.sessions);
  const localAgent = useAgentStore((s) => s.localAgent);
  const notifications = useAgentStore((s) => s.notifications);
  const markAllRead = useAgentStore((s) => s.markAllRead);
  const clearNotifications = useAgentStore((s) => s.clearNotifications);

  const sessionList = Object.values(sessions).sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-sm">Agent activity</DialogTitle>
          <DialogDescription className="text-xs">
            Live state and recent events for running agents (Claude Code, local
            AI, …).
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* Live sessions */}
          <section className="mb-4">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Sessions
            </h3>
            {sessionList.length === 0 && !localAgent ? (
              <p className="text-xs text-muted-foreground">
                No active agent sessions.
              </p>
            ) : (
              <ul className="space-y-1">
                {sessionList.map((s) => {
                  const meta = STATUS_META[s.status];
                  return (
                    <li
                      key={s.leafId}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs"
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {displayAgent(s.agent)}
                      </span>
                      <span className={cn("shrink-0", meta.tone)}>{meta.label}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                        {relativeTime(s.lastActivityAt)}
                      </span>
                    </li>
                  );
                })}
                {localAgent ? (
                  <li className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        STATUS_META[localAgent.status].dot,
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {displayAgent(localAgent.agent)}
                    </span>
                    <span className={cn("shrink-0", STATUS_META[localAgent.status].tone)}>
                      {STATUS_META[localAgent.status].label}
                    </span>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          {/* Event feed */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                Recent events
              </h3>
              {notifications.length > 0 ? (
                <button
                  type="button"
                  onClick={clearNotifications}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events yet.</p>
            ) : (
              <ul className="space-y-1">
                {notifications.slice(0, 30).map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-1.5 py-1 text-xs",
                      !n.read && "bg-accent/30",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1 shrink-0 rounded-full",
                        n.kind === "error"
                          ? "bg-destructive"
                          : n.kind === "attention"
                            ? "bg-primary"
                            : "bg-sky-500",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {displayAgent(n.agent)} · {NOTIF_LABEL[n.kind]}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                      {relativeTime(n.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 px-4 py-2">
          <span className="text-[10px] text-muted-foreground/60">
            {sessionList.length} session{sessionList.length === 1 ? "" : "s"} ·{" "}
            {notifications.length} event{notifications.length === 1 ? "" : "s"}
          </span>
          {notifications.some((n) => !n.read) ? (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Mark all read
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
