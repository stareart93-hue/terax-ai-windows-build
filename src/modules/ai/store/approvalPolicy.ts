import { create } from "zustand";

/**
 * Session-scoped approval policy. Progressive trust: the user can let a tool
 * proceed without re-prompting, either for the rest of the session (an allow
 * rule) or for the next N calls of the same kind (a countdown).
 *
 * Not persisted: resets on session switch (see chatStore.switchSession) and on
 * app restart. This is deliberate — trust does not carry across sessions. The
 * security layer (lib/security.ts deny-list + per-tool canonical-path checks)
 * always runs inside each tool's execute regardless of this policy; this store
 * only controls whether the approval *card* is shown.
 */

export type ToolAllowRule = {
  /** Tool name as it appears in approval parts, e.g. "edit", "bash_run". */
  toolName: string;
  /**
   * Optional path prefix. When set, the rule only matches file-mutation tools
   * whose target path starts with this prefix. Undefined means "any path".
   * Ignored for non-file tools (bash_run etc.).
   */
  pathPrefix?: string;
};

type State = {
  /** "Allow this kind for the rest of the session". */
  sessionAllowed: ToolAllowRule[];
  /** toolName -> remaining auto-approve budget ("approve the next N"). */
  approveAllRemaining: Record<string, number>;

  allowTool: (rule: ToolAllowRule) => void;
  revokeTool: (rule: ToolAllowRule) => void;
  /** Grant an auto-approve budget for the next `n` calls of `toolName`. */
  setApproveAll: (toolName: string, n: number) => void;
  /** Consume one budget unit for `toolName` if any remains. */
  dec: (toolName: string) => void;
  /** Clear everything (called on session switch). */
  reset: () => void;
};

function matchesRule(rule: ToolAllowRule, toolName: string, path?: string): boolean {
  if (rule.toolName !== toolName) return false;
  if (rule.pathPrefix === undefined) return true;
  if (path === undefined) return false;
  return path === rule.pathPrefix || path.startsWith(`${rule.pathPrefix}/`);
}

/** Test whether a pending tool call is covered by the current policy. */
export function isAutoApproved(
  s: State,
  toolName: string,
  path?: string,
): boolean {
  if (s.sessionAllowed.some((r) => matchesRule(r, toolName, path))) return true;
  const budget = s.approveAllRemaining[toolName] ?? 0;
  return budget > 0;
}

export const useApprovalPolicyStore = create<State>((set) => ({
  sessionAllowed: [],
  approveAllRemaining: {},

  allowTool: (rule) =>
    set((s) => {
      // Dedupe by toolName + pathPrefix.
      const exists = s.sessionAllowed.some(
        (r) =>
          r.toolName === rule.toolName && r.pathPrefix === rule.pathPrefix,
      );
      if (exists) return s;
      return { sessionAllowed: [...s.sessionAllowed, rule] };
    }),

  revokeTool: (rule) =>
    set((s) => ({
      sessionAllowed: s.sessionAllowed.filter(
        (r) =>
          !(r.toolName === rule.toolName && r.pathPrefix === rule.pathPrefix),
      ),
    })),

  setApproveAll: (toolName, n) =>
    set((s) => ({
      approveAllRemaining: {
        ...s.approveAllRemaining,
        [toolName]: Math.max(0, n),
      },
    })),

  dec: (toolName) =>
    set((s) => {
      const cur = s.approveAllRemaining[toolName] ?? 0;
      if (cur <= 0) return s;
      const next = { ...s.approveAllRemaining, [toolName]: cur - 1 };
      if (next[toolName] <= 0) delete next[toolName];
      return { approveAllRemaining: next };
    }),

  reset: () => set({ sessionAllowed: [], approveAllRemaining: {} }),
}));

/** Imperative accessor (used by the AgentRunBridge interceptor). */
export function approvalPolicyState(): State {
  return useApprovalPolicyStore.getState();
}
