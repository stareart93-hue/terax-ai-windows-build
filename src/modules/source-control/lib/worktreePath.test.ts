import { describe, expect, it } from "vitest";
import { previewWorktreePath, sanitizeBranchName } from "./worktreePath";

describe("sanitizeBranchName", () => {
  it("turns spaces into dashes and trims", () => {
    expect(sanitizeBranchName("  fix login race ")).toBe("fix-login-race");
  });

  it("drops characters git forbids in refs", () => {
    expect(sanitizeBranchName("fix~^:?*[\\x")).toBe("fixx");
  });

  it("collapses double dots and slashes", () => {
    expect(sanitizeBranchName("a..b")).toBe("a.b");
    expect(sanitizeBranchName("a//b")).toBe("a/b");
  });

  it("strips leading and trailing separators", () => {
    expect(sanitizeBranchName("-f")).toBe("f");
    expect(sanitizeBranchName("feature/")).toBe("feature");
    expect(sanitizeBranchName("feature.")).toBe("feature");
  });

  it("keeps feature slashes and case", () => {
    expect(sanitizeBranchName("feat/Fix-Login_2")).toBe("feat/Fix-Login_2");
  });
});

describe("previewWorktreePath", () => {
  it("derives the sibling dir with the branch suffix", () => {
    expect(previewWorktreePath("C:/repo/main", "fix login")).toBe(
      "C:/repo/main-fix-login",
    );
  });

  it("normalizes backslash roots", () => {
    expect(previewWorktreePath("C:\\repo\\main", "fix")).toBe(
      "C:/repo/main-fix",
    );
  });

  it("flattens nested branch names into one segment", () => {
    expect(previewWorktreePath("/home/u/terax", "feat/x")).toBe(
      "/home/u/terax-feat-x",
    );
  });

  it("falls back to the root when the branch is empty", () => {
    expect(previewWorktreePath("/home/u/terax", "  ")).toBe("/home/u/terax");
  });
});
