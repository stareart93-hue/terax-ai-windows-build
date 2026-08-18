import { describe, expect, it } from "vitest";
import { githubCompareUrl } from "./remoteUrl";

describe("githubCompareUrl", () => {
  it("accepts https, scp, and ssh remote forms", () => {
    expect(githubCompareUrl("https://github.com/crynta/terax-ai", "origin/main", "feat/x")).toBe(
      "https://github.com/crynta/terax-ai/compare/main...feat/x?expand=1",
    );
    expect(githubCompareUrl("https://github.com/crynta/terax-ai.git", "origin/main", "feat/x")).toBe(
      "https://github.com/crynta/terax-ai/compare/main...feat/x?expand=1",
    );
    expect(githubCompareUrl("git@github.com:crynta/terax-ai.git", "origin/main", "feat/x")).toBe(
      "https://github.com/crynta/terax-ai/compare/main...feat/x?expand=1",
    );
    expect(githubCompareUrl("ssh://git@github.com/crynta/terax-ai", "origin/main", "feat/x")).toBe(
      "https://github.com/crynta/terax-ai/compare/main...feat/x?expand=1",
    );
  });

  it("keeps local baselines as-is and encodes branch names", () => {
    expect(githubCompareUrl("https://github.com/o/r", "main", "feat/x")).toBe(
      "https://github.com/o/r/compare/main...feat/x?expand=1",
    );
    expect(githubCompareUrl("https://github.com/o/r", "main", "feat/x y")).toBe(
      "https://github.com/o/r/compare/main...feat/x%20y?expand=1",
    );
  });

  it("returns null for non-github remotes", () => {
    expect(githubCompareUrl("https://gitlab.com/o/r.git", "main", "x")).toBeNull();
    expect(githubCompareUrl("git@gitlab.com:o/r.git", "main", "x")).toBeNull();
    expect(githubCompareUrl("", "main", "x")).toBeNull();
  });
});
