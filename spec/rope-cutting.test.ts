import { describe, expect, it } from "vitest";
import { applyArrowToRope, type RopeSegment } from "../game/physics.ts";

// The rescue rule: an arrow intersecting an intact rope cuts that rope
// exactly once. This is the one game rule the C5 spec asks for a focused
// automated test on: https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/05-game/
const rope: RopeSegment = { id: "r1", a: { x: 100, y: 0 }, b: { x: 100, y: 400 }, cut: false };
const crossingPath = { from: { x: 0, y: 200 }, to: { x: 200, y: 200 } };
const missingPath = { from: { x: 0, y: 1000 }, to: { x: 200, y: 1000 } };

describe("applyArrowToRope", () => {
  it("cuts an intact rope crossed by the arrow", () => {
    const result = applyArrowToRope(rope, crossingPath.from, crossingPath.to);
    expect(result.cut).toBe(true);
    expect(result.rope.cut).toBe(true);
  });

  it("leaves an intact rope alone when the arrow doesn't cross it", () => {
    const result = applyArrowToRope(rope, missingPath.from, missingPath.to);
    expect(result.cut).toBe(false);
    expect(result.rope.cut).toBe(false);
  });

  it("never re-cuts a rope that's already cut, even on a re-crossing path", () => {
    const alreadyCut: RopeSegment = { ...rope, cut: true };
    const result = applyArrowToRope(alreadyCut, crossingPath.from, crossingPath.to);
    expect(result.cut).toBe(false);
    expect(result.rope.cut).toBe(true);
  });

  it("stays cut across a sequence of hits, as a bouncing arrow re-crossing it would produce", () => {
    const first = applyArrowToRope(rope, crossingPath.from, crossingPath.to);
    const second = applyArrowToRope(first.rope, crossingPath.to, crossingPath.from);
    expect(first.cut).toBe(true);
    expect(second.cut).toBe(false);
    expect(second.rope.cut).toBe(true);
  });
});
