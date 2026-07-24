import { describe, expect, it } from "vitest";
import {
  computeHunks,
  hasPartialRejection,
  synthesizeFinalContent,
} from "./hunkReview";

describe("synthesizeFinalContent", () => {
  it("returns proposed when all hunks accepted", () => {
    const original = "alpha\nbeta\ngamma\n";
    const proposed = "alpha\nBETA\ngamma\n";
    const hunks = computeHunks(original, proposed);
    expect(hunks).toHaveLength(1);
    const result = synthesizeFinalContent(original, proposed, ["accepted"]);
    expect(result).toBe(proposed);
  });

  it("returns original when all hunks rejected", () => {
    const original = "alpha\nbeta\ngamma\n";
    const proposed = "alpha\nBETA\ngamma\n";
    const result = synthesizeFinalContent(original, proposed, ["rejected"]);
    expect(result).toBe(original);
  });

  it("applies accepted hunks and reverts rejected ones independently", () => {
    const original = "a\nb\nc\nd\ne\n";
    const proposed = "A\nb\nC\nd\nE\n"; // three changed lines
    const hunks = computeHunks(original, proposed);
    // presentableDiff may coalesce adjacent changes; just sanity-check length.
    expect(hunks.length).toBeGreaterThanOrEqual(1);

    // Reject everything → original.
    const allRejected = synthesizeFinalContent(
      original,
      proposed,
      hunks.map(() => "rejected"),
    );
    expect(allRejected).toBe(original);

    // Accept everything → proposed.
    const allAccepted = synthesizeFinalContent(
      original,
      proposed,
      hunks.map(() => "accepted"),
    );
    expect(allAccepted).toBe(proposed);
  });

  it("handles partial rejection across multiple separated hunks", () => {
    // Two clearly separated changes with unchanged context between them.
    const original = "keep1\nchangeMe\nkeep2\nalsoChange\nkeep3\n";
    const proposed = "keep1\nCHANGED\nkeep2\nALSO_CHANGED\nkeep3\n";
    const hunks = computeHunks(original, proposed);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    // Reject the first, accept the second.
    const statuses = hunks.map((_, i) =>
      i === 0 ? "rejected" : "accepted",
    );
    const result = synthesizeFinalContent(original, proposed, statuses);
    expect(result).toBe("keep1\nchangeMe\nkeep2\nALSO_CHANGED\nkeep3\n");
  });

  it("treats pending as accepted (apply by default)", () => {
    const original = "x\ny\n";
    const proposed = "x\nY\n";
    expect(synthesizeFinalContent(original, proposed, ["pending"])).toBe(
      proposed,
    );
  });

  it("produces proposed when statuses is empty (defaults to accept)", () => {
    const original = "foo\nbar\n";
    const proposed = "foo\nBAR\nbaz\n";
    expect(synthesizeFinalContent(original, proposed, [])).toBe(proposed);
  });
});

describe("hasPartialRejection", () => {
  it("is false when all accepted/pending", () => {
    expect(hasPartialRejection(["accepted", "pending"])).toBe(false);
    expect(hasPartialRejection([])).toBe(false);
  });
  it("is true when any rejected", () => {
    expect(hasPartialRejection(["accepted", "rejected"])).toBe(true);
  });
});
