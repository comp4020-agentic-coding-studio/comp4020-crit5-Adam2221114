import { describe, expect, it } from "vitest";
import {
  PHYSICS,
  applyImpulse,
  launchVelocity,
  pendulumDirection,
  stepArrow,
  stepPendulum,
  type ArrowState,
  type GroundPlane,
  type PendulumState,
  type PersonHitbox,
  type RopeSegment,
} from "./physics.ts";

const ground: GroundPlane = { y: 500 };
const farPerson: PersonHitbox = { center: { x: -1000, y: -1000 }, radius: 10 };

describe("launchVelocity", () => {
  it("fires opposite the pull, scaled by draw power", () => {
    const v = launchVelocity({ x: 20, y: 0 });
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeCloseTo(0);
  });

  it("clamps power at maxDrawDistance", () => {
    const atCap = launchVelocity({ x: PHYSICS.maxDrawDistance, y: 0 });
    const beyondCap = launchVelocity({ x: PHYSICS.maxDrawDistance * 3, y: 0 });
    expect(Math.abs(beyondCap.x)).toBeCloseTo(Math.abs(atCap.x));
  });
});

describe("stepArrow: ground", () => {
  it("embeds an arrow that reaches the ground", () => {
    const arrow: ArrowState = { position: { x: 0, y: 490 }, velocity: { x: 0, y: 800 }, embedded: false };
    const result = stepArrow(arrow, [], farPerson, ground, 1);
    expect(result.arrow.embedded).toBe(true);
    expect(result.events.some((e) => e.type === "ground")).toBe(true);
  });

  it("does nothing more to an already-embedded arrow", () => {
    const arrow: ArrowState = { position: { x: 0, y: 500 }, velocity: { x: 0, y: 0 }, embedded: true };
    const result = stepArrow(arrow, [], farPerson, ground, 1);
    expect(result.events).toEqual([]);
    expect(result.arrow.embedded).toBe(true);
  });
});

describe("stepArrow: rope then ground in one step", () => {
  it("cuts the rope and keeps flying to embed in the ground", () => {
    const rope: RopeSegment = { id: "r1", a: { x: 100, y: 0 }, b: { x: 100, y: 400 }, cut: false };
    const arrow: ArrowState = { position: { x: 0, y: 200 }, velocity: { x: 4000, y: 0 }, embedded: false };
    const result = stepArrow(arrow, [rope], farPerson, ground, 0.1);
    const types = result.events.map((e) => e.type);
    expect(types).toContain("rope");
    expect(result.ropes.find((r) => r.id === "r1")?.cut).toBe(true);
  });
});

describe("stepArrow: person", () => {
  it("embeds the arrow in the person and stops it", () => {
    // Superseded rule: an arrow used to flinch the person and keep flying.
    // The rescue now requires arrows to physically embed (stop, orient to
    // the hit, and later move/rotate with the body) so a hit can drive a
    // pendulum impulse — see main.ts's person-hit handling.
    const person: PersonHitbox = { center: { x: 100, y: 200 }, radius: 15 };
    const arrow: ArrowState = { position: { x: 0, y: 200 }, velocity: { x: 4000, y: 0 }, embedded: false };
    const result = stepArrow(arrow, [], person, ground, 0.1);
    expect(result.events.some((e) => e.type === "person")).toBe(true);
    expect(result.arrow.embedded).toBe(true);
    expect(result.arrow.velocity).toEqual({ x: 0, y: 0 });
  });
});

describe("pendulum", () => {
  const pivotRadius = 200;

  it("settles back toward straight down (theta 0) when left alone", () => {
    let state: PendulumState = { theta: 0.6, omega: 0 };
    for (let i = 0; i < 2000; i++) {
      state = stepPendulum(state, pivotRadius, 1 / 60);
    }
    expect(Math.abs(state.theta)).toBeLessThan(0.05);
    expect(Math.abs(state.omega)).toBeLessThan(0.05);
  });

  it("swings away from the side an arrow hits it from", () => {
    // The bow is to the left of the person in every L1 shot, so an arrow
    // always arrives moving in +x. That should swing the person toward +x
    // (dir.x > 0), matching "hit from the left pushes the person right."
    let state: PendulumState = { theta: 0, omega: 0 };
    state = applyImpulse(state, { x: 1200, y: -50 });
    expect(state.omega).not.toBe(0);
    for (let i = 0; i < 5; i++) {
      state = stepPendulum(state, pivotRadius, 1 / 60);
    }
    expect(pendulumDirection(state.theta).x).toBeGreaterThan(0);
  });
});
