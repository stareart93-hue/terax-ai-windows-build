import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  nextAttentionTarget,
  useAgentStore,
} from "./agentStore";

describe("agentStore three-state lifecycle", () => {
  beforeEach(() => {
    // Reset store state between tests.
    useAgentStore.setState({
      sessions: {},
      localAgent: null,
      notifications: [],
    });
  });
  afterEach(() => {
    useAgentStore.setState({
      sessions: {},
      localAgent: null,
      notifications: [],
    });
  });

  it("starts a session in idle (awaiting first prompt) with no attentionSince", () => {
    useAgentStore.getState().start(1, 10, "claude");
    const s = useAgentStore.getState().sessions[1];
    expect(s.status).toBe("idle");
    expect(s.attentionSince).toBeNull();
  });

  it("attention sets attentionSince; idle and working clear it", () => {
    const { start, setStatus } = useAgentStore.getState();
    start(1, 10, "claude");

    setStatus(1, "attention");
    expect(useAgentStore.getState().sessions[1].attentionSince).not.toBeNull();
    expect(useAgentStore.getState().sessions[1].status).toBe("attention");

    setStatus(1, "idle");
    expect(useAgentStore.getState().sessions[1].attentionSince).toBeNull();
    expect(useAgentStore.getState().sessions[1].status).toBe("idle");

    setStatus(1, "working");
    expect(useAgentStore.getState().sessions[1].attentionSince).toBeNull();
  });

  it("nextAttentionTarget only returns attention sessions, not idle", () => {
    const { start, setStatus } = useAgentStore.getState();
    start(1, 10, "claude");
    start(2, 20, "codex");

    // Both idle -> no target.
    setStatus(1, "idle");
    setStatus(2, "idle");
    expect(nextAttentionTarget()).toBeNull();

    // One needs input -> that one.
    setStatus(2, "attention");
    const t = nextAttentionTarget();
    expect(t).toEqual({ tabId: 20, leafId: 2 });
  });

  it("nextAttentionTarget picks the most recently attentioned session", () => {
    const { start, setStatus } = useAgentStore.getState();
    start(1, 10, "claude");
    start(2, 20, "codex");
    setStatus(1, "attention");
    setStatus(2, "attention");
    // Both are attention-eligible; force distinct recency so codex wins.
    useAgentStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        1: { ...s.sessions[1], attentionSince: 1000 },
        2: { ...s.sessions[2], attentionSince: 2000 },
      },
    }));
    expect(nextAttentionTarget()).toEqual({ tabId: 20, leafId: 2 });
  });

  it("finish removes the session", () => {
    const { start, finish } = useAgentStore.getState();
    start(1, 10, "claude");
    expect(useAgentStore.getState().sessions[1]).toBeDefined();
    finish(1);
    expect(useAgentStore.getState().sessions[1]).toBeUndefined();
  });

  it("setStatus is a no-op when the status is unchanged", () => {
    const { start, setStatus } = useAgentStore.getState();
    start(1, 10, "claude");
    setStatus(1, "working"); // move to working first
    const before = useAgentStore.getState().sessions[1];
    setStatus(1, "working"); // same as current — no-op
    const after = useAgentStore.getState().sessions[1];
    // Reference equality: no new object created.
    expect(after).toBe(before);
  });
});
