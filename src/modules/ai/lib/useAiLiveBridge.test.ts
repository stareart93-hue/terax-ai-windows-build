import { describe, expect, it } from "vitest";
import {
  claudeTuiAcceptsPrompt,
  claudeTuiNeedsUserChoice,
} from "./useAiLiveBridge";

describe("Claude TUI readiness", () => {
  it("accepts the normal prompt surface", () => {
    expect(
      claudeTuiAcceptsPrompt("Welcome to Claude Code\n? for shortcuts"),
    ).toBe(true);
  });

  it("does not treat shortcut help alone as prompt readiness", () => {
    expect(claudeTuiAcceptsPrompt("? for help")).toBe(false);
  });

  it("blocks trust and option screens", () => {
    expect(
      claudeTuiNeedsUserChoice("Do you trust the files in this folder? Yes No"),
    ).toBe(true);
    expect(claudeTuiNeedsUserChoice("Select an option, then press Enter")).toBe(
      true,
    );
  });

  it("does not accept prompt text while a choice is visible", () => {
    expect(
      claudeTuiAcceptsPrompt("shortcuts\nYes No\nPress Enter to continue"),
    ).toBe(false);
  });
});
