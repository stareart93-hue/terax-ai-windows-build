import type { Tab } from "@/modules/tabs";
import { hasLeaf, leafIdForPty } from "@/modules/terminal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
/**
 * If an agent is "working" but goes silent for this long without a fresh
 * signal, fall back to "idle". This covers the common case where Claude Code's
 * hooks aren't installed (so no Stop/Notification markers ever arrive): without
 * this, the agent would stay "working" forever. Receiving any working/attention
 * signal resets the timer via lastActivityAt, so a genuinely long-running turn
 * that keeps emitting signals stays "working".
 */
const WORKING_SILENCE_MS = 60_000;

/**
 * Attention signals are debounced: when one arrives we wait this long before
 * applying it. If a "working" signal (PreToolUse/UserPromptSubmit) arrives in
 * that window — meaning the user already answered and the agent resumed — the
 * pending attention is cancelled. This prevents the "stuck on attention while
 * working" symptom caused by a Notification arriving just before/as the agent
 * resumes execution.
 */
const ATTENTION_DEBOUNCE_MS = 800;
import { displayAgent } from "../lib/format";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number;
  focused: boolean;
  onActivate: Activate;
};

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      return { tabId: t.id, title: t.title };
    }
  }
  return null;
}

function route(
  session: AgentSession,
  kind: "attention" | "finished",
  ctx: Ctx,
): void {
  const info = tabInfo(ctx.tabs, session.leafId);
  const name = displayAgent(session.agent);
  const heading =
    kind === "attention" ? `${name} needs your input` : `${name} finished`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: info?.title,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    // Stop fires every turn, so finished only updates the bell; attention toasts.
    allowToast: kind === "attention",
    tabId: session.tabId,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

// Per-leaf pending attention timers. A Notification (attention) doesn't apply
// immediately — see ATTENTION_DEBOUNCE_MS. Cancelled by an incoming working signal.
const pendingAttention = new Map<number, ReturnType<typeof setTimeout>>();

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      return;
    }
    case "working":
      // A working signal means the agent resumed — cancel any pending attention
      // (the user already answered; the Notification was stale/residual).
      {
        const t = pendingAttention.get(leafId);
        if (t !== undefined) {
          clearTimeout(t);
          pendingAttention.delete(leafId);
        }
      }
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      // Debounce: delay applying attention. If a working signal arrives first
      // (agent resumed after the user answered), the attention is cancelled.
      const existing = pendingAttention.get(leafId);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        pendingAttention.delete(leafId);
        const s = useAgentStore.getState().sessions[leafId];
        if (!s) return;
        // Only apply if the agent hasn't since moved to working/finished.
        if (s.status === "working") return;
        useAgentStore.getState().setStatus(leafId, "attention");
        const session = useAgentStore.getState().sessions[leafId];
        if (session) route(session, "attention", ctx);
      }, ATTENTION_DEBOUNCE_MS);
      pendingAttention.set(leafId, timer);
      return;
    }
    case "finished": {
      // Mark as "finished" (unread) rather than "idle" so the user can see the
      // agent completed and click through. The view effect below clears
      // finished -> idle once they actually look at the tab.
      store.setStatus(leafId, "finished");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "exited":
      {
        const t = pendingAttention.get(leafId);
        if (t !== undefined) {
          clearTimeout(t);
          pendingAttention.delete(leafId);
        }
      }
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
  }
}

export function AgentNotificationsBridge({
  tabs,
  activeId,
  onActivate,
}: {
  tabs: Tab[];
  activeId: number;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({ tabs, activeId, focused, onActivate });
  ctxRef.current = { tabs, activeId, focused, onActivate };

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AgentSignal>("terax:agent-signal", (e) =>
      handleSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Silence fallback: demote stale "working" sessions to "idle" so the UI
  // doesn't read "working" forever when an agent's hooks aren't installed
  // (no Stop marker ever arrives). Gated on `everSignaled` — once a session has
  // reported a real working/attention/finished transition, its hooks are
  // working and we trust them; the fallback would otherwise demote a genuinely
  // long-running turn (which emits no signal while thinking/tooling) to idle.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const store = useAgentStore.getState();
      for (const s of Object.values(store.sessions)) {
        if (
          !s.everSignaled &&
          s.status === "working" &&
          now - s.lastActivityAt > WORKING_SILENCE_MS
        ) {
          store.setStatus(s.leafId, "finished");
        }
      }
    };
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);

  // View-through: when the user actually looks at a "finished" (unread) agent —
  // its tab is active and the window is focused — clear it to "idle". This is
  // the "click to acknowledge" step that separates "completed, unseen" from
  // "completed, seen".
  useEffect(() => {
    if (!focused) return;
    const store = useAgentStore.getState();
    for (const s of Object.values(store.sessions)) {
      if (s.status === "finished" && s.tabId === activeId) {
        store.setStatus(s.leafId, "idle");
      }
    }
  }, [focused, activeId]);

  return null;
}
