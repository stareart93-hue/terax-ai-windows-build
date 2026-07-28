/**
 * Lifecycle state of a running agent (e.g. Claude Code in a terminal).
 *
 *   working    — executing (thinking / calling tools / streaming). From the
 *                agent's "prompt submitted" / pre-/post-tool signals.
 *   finished   — completed its turn but the user hasn't viewed it yet. From the
 *                agent's "stop" signal. Surfaced in the badge; clicking through
 *                to the agent's tab clears it to "idle".
 *   idle       — finished and viewed; waiting for the next instruction. No
 *                badge, no action needed.
 *   attention  — blocked waiting for the user to answer (permission request,
 *                clarification). From the agent's "notification" signal. This
 *                is the state that should prompt the user to switch back.
 */
export type AgentStatus = "working" | "finished" | "idle" | "attention";

export type AgentSource = "terminal" | "local";

export type AgentSignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "idle"
  | "exited";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
  /** True once we've received a real working/attention/finished signal — i.e.
   *  the agent's hooks are installed and reporting. Used to gate the silence
   *  fallback so it only applies to hook-less sessions. */
  everSignaled: boolean;
};

export type AgentNotification = {
  id: string;
  source: AgentSource;
  leafId: number;
  tabId: number;
  agent: string;
  kind: NotificationKind;
  at: number;
  read: boolean;
};

export type NotificationKind = "attention" | "finished" | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
