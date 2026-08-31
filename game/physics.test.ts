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
  type Wall,
} from "./physics.ts";

const ground: GroundPlane = { y: 500 };
const farPerson: PersonHitbox = { id: "far", center: { x: -1000, y: -1000 }, radius: 10 };
const noWalls: Wall[] = [];

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
    const arrow: ArrowState = {
      position: { x: 0, y: 490 },
      velocity: { x: 0, y: 800 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [], [farPerson], ground, noWalls, 1);
    expect(result.arrow.embedded).toBe(true);
    expect(result.events.some((e) => e.type === "ground")).toBe(true);
  });

  it("does nothing more to an already-embedded arrow", () => {
    const arrow: ArrowState = {
      position: { x: 0, y: 500 },
      velocity: { x: 0, y: 0 },
      embedded: true,
      bounces: 0,
    };
    const result = stepArrow(arrow, [], [farPerson], ground, noWalls, 1);
    expect(result.events).toEqual([]);
    expect(result.arrow.embedded).toBe(true);
  });
});

describe("stepArrow: rope then ground in one step", () => {
  it("cuts the rope and keeps flying to embed in the ground", () => {
    const rope: RopeSegment = { id: "r1", a: { x: 100, y: 0 }, b: { x: 100, y: 400 }, cut: false };
    const arrow: ArrowState = {
      position: { x: 0, y: 200 },
      velocity: { x: 4000, y: 0 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [rope], [farPerson], ground, noWalls, 0.1);
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
    const person: PersonHitbox = { id: "p1", center: { x: 100, y: 200 }, radius: 15 };
    const arrow: ArrowState = {
      position: { x: 0, y: 200 },
      velocity: { x: 4000, y: 0 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [], [person], ground, noWalls, 0.1);
    const personEvent = result.events.find((e) => e.type === "person");
    expect(personEvent).toBeDefined();
    expect(personEvent && personEvent.type === "person" && personEvent.personId).toBe("p1");
    expect(result.arrow.embedded).toBe(true);
    expect(result.arrow.velocity).toEqual({ x: 0, y: 0 });
  });

  it("attributes the hit to the correct person among several", () => {
    const near: PersonHitbox = { id: "near", center: { x: 50, y: 200 }, radius: 15 };
    const far: PersonHitbox = { id: "far", center: { x: 500, y: 200 }, radius: 15 };
    const arrow: ArrowState = {
      position: { x: 0, y: 200 },
      velocity: { x: 4000, y: 0 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [], [far, near], ground, noWalls, 0.1);
    const personEvent = result.events.find((e) => e.type === "person");
    expect(personEvent && personEvent.type === "person" && personEvent.personId).toBe("near");
  });
});

describe("stepArrow: wall", () => {
  it("reflects off a wall and keeps flying, tracking the bounce", () => {
    // Vertical wall at x=100; arrow travels straight in +x, should reflect
    // straight back in -x (reduced by restitution), still airborne.
    const wall: Wall = { id: "left", a: { x: 100, y: -1000 }, b: { x: 100, y: 1000 } };
    const arrow: ArrowState = {
      position: { x: 0, y: 200 },
      velocity: { x: 4000, y: 0 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [], [farPerson], ground, [wall], 0.1);
    expect(result.events.some((e) => e.type === "wall")).toBe(true);
    expect(result.arrow.embedded).toBe(false);
    expect(result.arrow.bounces).toBe(1);
    expect(result.arrow.velocity.x).toBeLessThan(0);
    expect(Math.abs(result.arrow.velocity.x)).toBeCloseTo(4000 * PHYSICS.bounceRestitution, 0);
  });

  it("embeds once the bounce budget runs out", () => {
    // A narrow wall corridor the arrow bounces along repeatedly within a
    // single step; eventually the bounce count exceeds PHYSICS.maxBounces
    // and it must embed rather than bounce forever.
    const left: Wall = { id: "left", a: { x: 0, y: -1000 }, b: { x: 0, y: 1000 } };
    const right: Wall = { id: "right", a: { x: 40, y: -1000 }, b: { x: 40, y: 1000 } };
    const arrow: ArrowState = {
      position: { x: 20, y: 200 },
      velocity: { x: 4000, y: 0 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [], [farPerson], ground, [left, right], 1);
    expect(result.arrow.embedded).toBe(true);
    expect(result.arrow.bounces).toBeGreaterThan(PHYSICS.maxBounces);
  });

  it("still cuts a rope crossed on the way back after bouncing off a wall", () => {
    // Arrow starts at x=0 heading +x, bounces off a wall at x=20, and the
    // reflected path (heading -x) crosses a rope at x=-10 that was never on
    // the outbound leg.
    const wall: Wall = { id: "right", a: { x: 20, y: -1000 }, b: { x: 20, y: 1000 } };
    const rope: RopeSegment = { id: "r1", a: { x: -10, y: 0 }, b: { x: -10, y: 400 }, cut: false };
    const arrow: ArrowState = {
      position: { x: 0, y: 200 },
      velocity: { x: 4000, y: 0 },
      embedded: false,
      bounces: 0,
    };
    const result = stepArrow(arrow, [rope], [farPerson], ground, [wall], 0.1);
    const types = result.events.map((e) => e.type);
    expect(types).toContain("wall");
    expect(types).toContain("rope");
    expect(result.ropes.find((r) => r.id === "r1")?.cut).toBe(true);
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
