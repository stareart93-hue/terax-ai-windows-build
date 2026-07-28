import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import { getContextualAction, getSourceControlRemoteIndicator, normalizeError } from "./useSourceControl";

function status(over: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    repoRoot: "/r",
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
    ...over,
  };
}

describe("normalizeError", () => {
  it("passes through string errors", () => {
    expect(normalizeError("boom")).toBe("boom");
  });
  it("extracts .message from objects", () => {
    expect(normalizeError(new Error("oops"))).toBe("oops");
    expect(normalizeError({ message: "x" })).toBe("x");
  });
  it("falls back for unknown shapes", () => {
    expect(normalizeError(42)).toBe("Unknown source control error");
    expect(normalizeError({ foo: 1 })).toBe("Unknown source control error");
    expect(normalizeError(null)).toBe("Unknown source control error");
  });
});

describe("getContextualAction", () => {
  it("returns null without an upstream", () => {
    expect(getContextualAction(status({ upstream: null }))).toBeNull();
    expect(getContextualAction(null)).toBeNull();
  });
  it("returns null when diverged (ahead>0 && behind>0)", () => {
    expect(getContextualAction(status({ upstream: "origin", ahead: 2, behind: 3 }))).toBeNull();
  });
  it("returns pull when behind only", () => {
    expect(getContextualAction(status({ upstream: "origin", ahead: 0, behind: 5 }))).toBe("pull");
  });
  it("returns push when ahead only", () => {
    expect(getContextualAction(status({ upstream: "origin", ahead: 4, behind: 0 }))).toBe("push");
  });
  it("returns fetch when in sync", () => {
    expect(getContextualAction(status({ upstream: "origin", ahead: 0, behind: 0 }))).toBe("fetch");
  });
});

describe("getSourceControlRemoteIndicator", () => {
  const base = {
    hasRepo: true,
    upstream: "origin/main" as string | null,
    ahead: 0,
    behind: 0,
    busyAction: null,
  } as const;

  it("is hidden when no repo or upstream", () => {
    expect(
      getSourceControlRemoteIndicator({ ...base, hasRepo: false, upstream: null }).visible,
    ).toBe(false);
    expect(
      getSourceControlRemoteIndicator({ ...base, upstream: null }).visible,
    ).toBe(false);
  });
  it("is disabled + no action when diverged", () => {
    const ind = getSourceControlRemoteIndicator({
      ...base,
      ahead: 1,
      behind: 1,
    });
    expect(ind.visible).toBe(true);
    expect(ind.disabled).toBe(true);
    expect(ind.action).toBeNull();
  });
  it("offers pull when behind, disabled while busy", () => {
    const ind = getSourceControlRemoteIndicator({ ...base, behind: 3 });
    expect(ind.action).toBe("pull");
    expect(ind.disabled).toBe(false);
    const busy = getSourceControlRemoteIndicator({
      ...base,
      behind: 3,
      busyAction: "fetch",
    });
    expect(busy.disabled).toBe(true);
  });
  it("offers push when ahead", () => {
    expect(
      getSourceControlRemoteIndicator({ ...base, ahead: 2 }).action,
    ).toBe("push");
  });
});
