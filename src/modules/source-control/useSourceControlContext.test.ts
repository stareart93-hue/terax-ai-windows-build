import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { resolveSourceControlContextPath } from "./useSourceControlContext";

function terminal(cwd: string): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    cwd,
    paneTree: { kind: "leaf", id: 1, cwd },
    activeLeafId: 1,
  };
}

describe("resolveSourceControlContextPath", () => {
  it("uses the active terminal's OSC cwd regardless of agent activity", () => {
    expect(
      resolveSourceControlContextPath({
        activeTab: terminal("C:/repo/worktrees/current"),
        activeTerminalLeafCwd: "C:/repo/worktrees/current",
        explorerRoot: "C:/repo/main",
        workspaceFallbackPath: "C:/repo/main",
      }),
    ).toBe("C:/repo/worktrees/current");
  });

  it("uses the editor directory outside a terminal", () => {
    const tab: Tab = {
      id: 2,
      kind: "editor",
      spaceId: "default",
      title: "a.ts",
      path: "C:/repo/src/a.ts",
      dirty: false,
      preview: false,
    };
    expect(
      resolveSourceControlContextPath({
        activeTab: tab,
        activeTerminalLeafCwd: null,
        explorerRoot: null,
        workspaceFallbackPath: "C:/fallback",
      }),
    ).toBe("C:/repo/src");
  });
});
