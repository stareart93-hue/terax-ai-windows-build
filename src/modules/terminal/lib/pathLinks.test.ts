import { describe, expect, it } from "vitest";
import { findPathMatches, resolveTerminalPath } from "./pathLinks";

describe("findPathMatches", () => {
  it("finds absolute paths with line and column", () => {
    const matches = findPathMatches("error at /home/u/repo/src/main.rs:42:7");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("/home/u/repo/src/main.rs");
    expect(matches[0].line).toBe(42);
    expect(matches[0].col).toBe(7);
    expect(matches[0].start).toBe(9);
  });

  it("finds relative ./ and ../ paths", () => {
    expect(findPathMatches("see ./lib/mod.ts:10")[0].text).toBe(
      "./lib/mod.ts",
    );
    expect(findPathMatches("in ../shared/util.ts")[0].text).toBe(
      "../shared/util.ts",
    );
  });

  it("accepts windows drive paths in both separator styles", () => {
    expect(findPathMatches("at C:/repo/src/a.ts:3")[0].text).toBe(
      "C:/repo/src/a.ts",
    );
    expect(findPathMatches("at C:\\repo\\src\\a.ts")[0].text).toBe(
      "C:\\repo\\src\\a.ts",
    );
  });

  it("skips urls and bare words", () => {
    expect(findPathMatches("open https://github.com/crynta/terax-ai now")).toHaveLength(0);
    expect(findPathMatches("git@github.com:crynta/terax-ai.git")).toHaveLength(0);
    expect(findPathMatches("just some words here")).toHaveLength(0);
  });

  it("does not include trailing punctuation", () => {
    const matches = findPathMatches("wrote /tmp/out.json, then stopped.");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("/tmp/out.json");
  });

  it("finds multiple paths on one line", () => {
    const matches = findPathMatches("diff ./a.ts ./b.ts");
    expect(matches.map((m) => m.text)).toEqual(["./a.ts", "./b.ts"]);
  });

  it("line suffix is optional and not swallowed into the path", () => {
    const matches = findPathMatches("at /var/log/app.log");
    expect(matches[0].text).toBe("/var/log/app.log");
    expect(matches[0].line).toBeNull();
  });
});

describe("resolveTerminalPath", () => {
  it("keeps absolute paths and normalizes separators", () => {
    expect(resolveTerminalPath("C:\\repo\\a.ts", null)).toBe("C:/repo/a.ts");
    expect(resolveTerminalPath("/usr/local/x", null)).toBe("/usr/local/x");
  });

  it("joins relatives onto the cwd", () => {
    expect(resolveTerminalPath("./src/a.ts", "/home/u/repo")).toBe(
      "/home/u/repo/src/a.ts",
    );
    expect(resolveTerminalPath("src\\a.ts", "C:/repo")).toBe("C:/repo/src/a.ts");
  });

  it("resolves .. segments naively", () => {
    expect(resolveTerminalPath("../lib/b.ts", "/home/u/repo/src")).toBe(
      "/home/u/repo/lib/b.ts",
    );
  });

  it("returns null without a cwd for relative input", () => {
    expect(resolveTerminalPath("./a.ts", null)).toBeNull();
  });
});
