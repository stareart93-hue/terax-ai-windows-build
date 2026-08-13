import type { AgentSession } from "@/modules/agents/lib/types";
import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { agentSourceControlPath } from "./useSourceControlContext";

function term(
  id: number,
  leafId: number,
  cwd: string,
  extra?: Partial<Extract<Tab, { kind: "terminal" }>>,
): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    cwd,
    paneTree: { kind: "leaf", id: leafId, cwd },
    activeLeafId: leafId,
    ...extra,
  };
}

function session(
  leafId: number,
  agent: string,
  lastActivityAt: number,
): AgentSession {
  return {
    leafId,
    tabId: leafId,
    agent,
    status: "finished",
    startedAt: lastActivityAt - 1,
    lastActivityAt,
    attentionSince: null,
    everSignaled: true,
  };
}

describe("agentSourceControlPath", () => {
  it("uses the most recent Claude terminal leaf cwd", () => {
    const tabs = [
      term(1, 10, "C:/repo/main"),
      term(2, 20, "C:/repo/worktrees/feature"),
    ];
    const sessions = {
      10: session(10, "claude", 100),
      20: session(20, "claude", 200),
    };

    expect(agentSourceControlPath(tabs, sessions)).toBe(
      "C:/repo/worktrees/feature",
    );
  });

  it("keeps source control on the active Claude terminal over a newer session", () => {
    const activeTab = term(1, 10, "C:/repo/worktrees/current");
    const tabs = [activeTab, term(2, 20, "C:/repo/worktrees/background")];
    const sessions = {
      10: session(10, "claude", 100),
      20: session(20, "claude", 200),
    };

    expect(agentSourceControlPath(tabs, sessions, activeTab)).toBe(
      "C:/repo/worktrees/current",
    );
  });

  it("does not let non-Claude agents claim the Claude source-control context", () => {
    const tabs = [term(1, 10, "C:/repo/claude"), term(2, 20, "C:/repo/codex")];
    const sessions = {
      10: session(10, "claude", 100),
      20: session(20, "codex", 300),
    };

    expect(agentSourceControlPath(tabs, sessions)).toBe("C:/repo/claude");
  });

  it("falls back to the tab cwd when the leaf has not reported cwd yet", () => {
    const tabs = [
      term(1, 10, "C:/repo/from-tab", {
        paneTree: { kind: "leaf", id: 10 },
      }),
    ];
    const sessions = { 10: session(10, "claude", 100) };

    expect(agentSourceControlPath(tabs, sessions)).toBe("C:/repo/from-tab");
  });
});
