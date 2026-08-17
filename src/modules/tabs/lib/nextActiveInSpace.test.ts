import { describe, expect, it } from "vitest";
import {
  nextActiveAfterEditorClose,
  nextActiveInSpace,
  previewReturnTarget,
  returnTargetForNewPreview,
  type EditorTab,
  type Tab,
} from "./useTabs";

function term(id: number, spaceId: string): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as Tab;
}

function editor(
  id: number,
  spaceId: string,
  preview = false,
  returnToTabId?: number,
): EditorTab {
  return {
    id,
    kind: "editor",
    spaceId,
    title: `file-${id}.ts`,
    path: `/tmp/file-${id}.ts`,
    dirty: false,
    preview,
    returnToTabId,
  };
}

describe("nextActiveInSpace", () => {
  it("picks the previous tab within the same space", () => {
    const tabs = [term(1, "a"), term(2, "a"), term(3, "a")];
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
    expect(nextActiveInSpace(tabs, 2)).toBe(1);
  });

  it("falls forward when closing the first tab of a space", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    expect(nextActiveInSpace(tabs, 1)).toBe(2);
  });

  it("never jumps into another space", () => {
    const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];
    expect(nextActiveInSpace(tabs, 2)).toBe(3);
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
  });

  it("returns null for the last tab of its space (refuse to close)", () => {
    const tabs = [term(1, "a"), term(2, "b")];
    expect(nextActiveInSpace(tabs, 1)).toBeNull();
    expect(nextActiveInSpace(tabs, 2)).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(nextActiveInSpace([term(1, "a")], 99)).toBeNull();
  });
});

describe("nextActiveAfterEditorClose", () => {
  it("returns to the previously active editor, skipping a more recent terminal", () => {
    const tabs = [term(1, "a"), editor(2, "a"), editor(3, "a")];
    // terminal 1 was viewed after editor 2; closing 3 must still land on 2
    expect(nextActiveAfterEditorClose(tabs, 3, [3, 1, 2])).toBe(2);
  });

  it("walks the MRU list until an editor in the same space is found", () => {
    const tabs = [
      term(1, "a"),
      editor(2, "a"),
      term(3, "b"),
      editor(4, "a"),
      editor(5, "a"),
    ];
    // 4 and 2 are the editor history in space a, newest first
    expect(nextActiveAfterEditorClose(tabs, 5, [5, 3, 4, 1, 2])).toBe(4);
    expect(nextActiveAfterEditorClose(tabs, 4, [4, 3, 1, 2])).toBe(2);
  });

  it("falls back to the strip neighbor when the MRU has no editor", () => {
    const tabs = [term(1, "a"), editor(2, "a"), term(3, "a")];
    expect(nextActiveAfterEditorClose(tabs, 2, [2, 1])).toBe(1);
  });

  it("never jumps into another space and refuses the last tab of a space", () => {
    const tabs = [term(1, "b"), editor(2, "a")];
    expect(nextActiveAfterEditorClose(tabs, 2, [2, 1])).toBeNull();
    expect(nextActiveAfterEditorClose(tabs, 2, [2])).toBeNull();
  });

  it("keeps the neighbor rule for non-editor tabs", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    expect(nextActiveAfterEditorClose(tabs, 2, [2, 1])).toBe(1);
  });

  it("ignores stale ids that no longer resolve to a tab", () => {
    const tabs = [term(1, "a"), editor(2, "a"), editor(3, "a")];
    expect(nextActiveAfterEditorClose(tabs, 3, [3, 99, 2])).toBe(2);
  });
});

describe("preview return target", () => {
  it("returns to the tab active before the file preview opened", () => {
    const tabs = [term(1, "a"), term(2, "a"), editor(3, "a", true, 1)];
    expect(previewReturnTarget(tabs, tabs[2] as EditorTab)).toBe(1);
  });

  it("ignores stale or cross-space return targets", () => {
    expect(
      previewReturnTarget([editor(3, "a", true, 99)], editor(3, "a", true, 99)),
    ).toBeNull();
    expect(
      previewReturnTarget(
        [term(1, "b"), editor(3, "a", true, 1)],
        editor(3, "a", true, 1),
      ),
    ).toBeNull();
  });

  it("keeps the original target while replacing preview files", () => {
    const tabs = [term(1, "a"), editor(3, "a", true, 1)];
    expect(returnTargetForNewPreview(tabs, 3)).toBe(1);
  });

  it("records the current tab when entering preview from a normal tab", () => {
    expect(returnTargetForNewPreview([term(1, "a")], 1)).toBe(1);
  });
});
