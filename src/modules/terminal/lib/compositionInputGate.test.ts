import { describe, expect, it } from "vitest";
import { CompositionInputGate } from "./compositionInputGate";

describe("CompositionInputGate", () => {
  it("forwards only one final IME commit", () => {
    const gate = new CompositionInputGate();
    gate.startComposition();

    expect(gate.shouldForward("ni", 10)).toBe(false);

    gate.endComposition("你", 20);
    expect(gate.shouldForward("你", 21)).toBe(true);
    expect(gate.shouldForward("你", 22)).toBe(false);
  });

  it("does not suppress normal repeated typing", () => {
    const gate = new CompositionInputGate();

    expect(gate.shouldForward("a", 10)).toBe(true);
    expect(gate.shouldForward("a", 11)).toBe(true);
  });

  it("does not suppress the same IME text after the duplicate window", () => {
    const gate = new CompositionInputGate();
    gate.startComposition();
    gate.endComposition("你", 20);

    expect(gate.shouldForward("你", 21)).toBe(true);
    expect(gate.shouldForward("你", 200)).toBe(true);
  });
});
