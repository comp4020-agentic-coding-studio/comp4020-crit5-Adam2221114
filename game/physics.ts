// The shared projectile/collision core. One set of constants, one stepping
// function, used by every level — level difficulty comes from geometry
// (rope/obstacle/ground layout), never from retuning these numbers.
//
// Scope: rope cutting, person-hit embedding (with a pendulum impulse applied
// by the caller), ground embedding, and wall ricochet (a wall reflects the
// arrow — same velocity-changing bounce math regardless of level — until its
// bounce budget or speed runs out, at which point it embeds like any other
// solid hit).

export interface Point {
  x: number;
  y: number;
}

export const PHYSICS = {
  /** px/s^2, downward */
  gravity: 900,
  /** draw distance (px) -> launch speed (px/s) */
  drawPower: 8,
  /** clamps how far the string can be pulled before it stops adding power */
  maxDrawDistance: 140,
  /** collision radius of the arrow itself */
  arrowRadius: 4,
  /** below this speed, ground/solid contact embeds the arrow rather than bouncing */
  embedSpeedThreshold: 40,
  /** reserved for solid-surface ricochet (introduced with walls) */
  bounceRestitution: 0.55,
  /** reserved for solid-surface ricochet (introduced with walls) */
  maxBounces: 3,
} as const;

/**
 * The hanging person's rope-constrained motion — a damped simple pendulum
 * pivoting at the rope anchor. Level-invariant, same spirit as PHYSICS: only
 * geometry (pivot radius) varies per level, never these two numbers.
 */
export const PENDULUM = {
  /** angular velocity decay per second — lets the person settle instead of
   *  swinging forever; a rope/air-drag stand-in, not a physically derived value */
  damping: 0.8,
  /** arrow velocity (px/s, tangential component at impact) -> angular
   *  velocity (rad/s) added on a person hit; empirically tuned for a
   *  visible-but-bounded swing, not a mass-derived impulse */
  impulseScale: 0.006,
} as const;

export interface PendulumState {
  /** radians from straight down, positive = swings toward +x */
  theta: number;
  /** angular velocity, rad/s */
  omega: number;
}

/** Rotates v by angle (standard rotation matrix; consistent for every use
 * below — direction of "positive" is only meaningful relative to itself). */
export function rotateVector(v: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Unit vector from the pivot toward the hanging body at this angle. */
export function pendulumDirection(theta: number): Point {
  return rotateVector({ x: 0, y: 1 }, theta);
}

/** Direction of motion for increasing theta — the axis an impulse's
 * velocity is projected onto to decide which way the person swings. */
export function pendulumTangent(theta: number): Point {
  return rotateVector({ x: 0, y: 1 }, theta + Math.PI / 2);
}

/** Advances the pendulum by dt seconds: gravity restoring torque + damping. */
export function stepPendulum(state: PendulumState, pivotRadius: number, dt: number): PendulumState {
  const alpha = -(PHYSICS.gravity / pivotRadius) * Math.sin(state.theta) - PENDULUM.damping * state.omega;
  const omega = state.omega + alpha * dt;
  const theta = state.theta + omega * dt;
  return { theta, omega };
}

/** Adds the tangential component of `velocity` (an arrow's incoming
 * velocity at the moment it embeds) to the pendulum's angular velocity. */
export function applyImpulse(state: PendulumState, velocity: Point): PendulumState {
  const tangent = pendulumTangent(state.theta);
  const tangential = velocity.x * tangent.x + velocity.y * tangent.y;
  return { theta: state.theta, omega: state.omega + tangential * PENDULUM.impulseScale };
}

export interface RopeSegment {
  id: string;
  a: Point;
  b: Point;
  cut: boolean;
}

export interface PersonHitbox {
  id: string;
  center: Point;
  radius: number;
}

export interface GroundPlane {
  /** world y of the ground surface; arrows embed when they cross it */
  y: number;
}

export interface ArrowState {
  position: Point;
  velocity: Point;
  embedded: boolean;
  /** wall bounces used so far — caps ricochet so an arrow can't bounce forever */
  bounces: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
}

export type CollisionEvent =
  | { type: "rope"; ropeId: string; at: Point }
  | { type: "person"; personId: string; at: Point }
  | { type: "ground"; at: Point }
  | { type: "wall"; at: Point };

export interface StepResult {
  arrow: ArrowState;
  events: CollisionEvent[];
  ropes: RopeSegment[];
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v: Point): number {
  return Math.hypot(v.x, v.y);
}

/**
 * Launch velocity for a bow drawn by `drag` (anchor -> pointer). The player
 * pulls the string back; the arrow fires the opposite way, same convention
 * as any slingshot. Draw distance beyond `maxDrawDistance` adds no power.
 */
export function launchVelocity(drag: Point): Point {
  const pull = length(drag);
  if (pull === 0) return { x: 0, y: 0 };
  const clamped = Math.min(pull, PHYSICS.maxDrawDistance);
  const speed = clamped * PHYSICS.drawPower;
  return { x: (-drag.x / pull) * speed, y: (-drag.y / pull) * speed };
}

/** Where the unobstructed arc would be at time `t` — used for the aim preview only. */
export function previewPoint(origin: Point, velocity: Point, t: number): Point {
  return {
    x: origin.x + velocity.x * t,
    y: origin.y + velocity.y * t + 0.5 * PHYSICS.gravity * t * t,
  };
}

// Segment a->b vs segment c->d. Returns the intersection point closest to a,
// or null. Standard parametric line intersection.
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null; // parallel (or degenerate) — no single crossing
  const ac = subtract(c, a);
  const t = (ac.x * s.y - ac.y * s.x) / denom;
  const u = (ac.x * r.y - ac.y * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

// Segment a->b vs circle (center, radius). Returns the first intersection
// along a->b, or null.
function segmentCircleIntersection(a: Point, b: Point, center: Point, radius: number): Point | null {
  const d = subtract(b, a);
  const f = subtract(a, center);
  const A = d.x * d.x + d.y * d.y;
  if (A === 0) return null;
  const B = 2 * (f.x * d.x + f.y * d.y);
  const C = f.x * f.x + f.y * f.y - radius * radius;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return null;
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-B - sqrtDisc) / (2 * A);
  const t2 = (-B + sqrtDisc) / (2 * A);
  const t = [t1, t2].filter((t) => t >= 0 && t <= 1).sort((x, y) => x - y)[0];
  if (t === undefined) return null;
  return { x: a.x + d.x * t, y: a.y + d.y * t };
}

function distanceAlong(a: Point, point: Point): number {
  return length(subtract(point, a));
}

// Segment a->b vs the horizontal ground plane at y = groundY. Solved directly
// (not via segmentIntersection) because that generic solver needs two finite
// endpoints — feeding it a +/-Infinity "infinite line" produces `Infinity * 0`
// (NaN) whenever the ground segment's own dy is exactly 0, and that NaN slips
// straight past the t/u range checks undetected.
function groundIntersection(a: Point, b: Point, groundY: number): Point | null {
  const dy = b.y - a.y;
  if (dy === 0) return null;
  const t = (groundY - a.y) / dy;
  if (t < 0 || t > 1) return null;
  return { x: a.x + (b.x - a.x) * t, y: groundY };
}

/**
 * The one rule the spec asks to put under a focused test: an arrow crossing
 * an intact rope cuts it, exactly once. A rope that's already cut never
 * triggers again, even if a later step's segment crosses it again (a
 * ricocheting arrow can legitimately re-cross a rope it already cut).
 */
export function applyArrowToRope(
  rope: RopeSegment,
  from: Point,
  to: Point,
): { rope: RopeSegment; cut: boolean; at: Point | null } {
  if (rope.cut) return { rope, cut: false, at: null };
  const at = segmentIntersection(from, to, rope.a, rope.b);
  if (!at) return { rope, cut: false, at: null };
  return { rope: { ...rope, cut: true }, cut: true, at };
}

/** A hit test only — no state to protect, so it can fire every time the
 * arrow's path crosses the hitbox. The caller (stepArrow) decides that a
 * person hit stops and embeds the arrow, same as the ground does. */
export function applyArrowToPerson(
  person: PersonHitbox,
  from: Point,
  to: Point,
): { hit: boolean; at: Point | null } {
  const at = segmentCircleIntersection(from, to, person.center, person.radius);
  return at ? { hit: true, at } : { hit: false, at: null };
}

/** A hit test against a solid wall segment. `normal` faces back toward
 * `from` (the incoming side) so the caller can reflect velocity off it
 * regardless of which side the arrow approaches from. */
export function applyArrowToWall(
  wall: Wall,
  from: Point,
  to: Point,
): { hit: boolean; at: Point | null; normal: Point | null } {
  const at = segmentIntersection(from, to, wall.a, wall.b);
  if (!at) return { hit: false, at: null, normal: null };
  const along = subtract(wall.b, wall.a);
  const wallLength = length(along);
  if (wallLength === 0) return { hit: false, at: null, normal: null };
  let normal = { x: -along.y / wallLength, y: along.x / wallLength };
  const toFrom = subtract(from, wall.a);
  if (normal.x * toFrom.x + normal.y * toFrom.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  return { hit: true, at, normal };
}

/**
 * Advances the arrow by `dt` seconds. Within that step, resolves collisions
 * in chronological order along the movement segment: a rope cut doesn't stop
 * the arrow — it keeps flying from that point with its remaining motion, and
 * may go on to hit something else in the same step. A wall reflects the
 * arrow (velocity changes, so the remainder of the tick is recomputed from
 * the bounce point) until its bounce budget or speed runs out, at which
 * point it embeds. A person hit or the ground both stop and embed it
 * immediately.
 */
export function stepArrow(
  arrow: ArrowState,
  ropes: RopeSegment[],
  people: PersonHitbox[],
  ground: GroundPlane,
  walls: Wall[],
  dt: number,
): StepResult {
  if (arrow.embedded) {
    return { arrow, events: [], ropes };
  }

  let velocity = { x: arrow.velocity.x, y: arrow.velocity.y + PHYSICS.gravity * dt };
  let remainingDt = dt;
  let naiveEnd = {
    x: arrow.position.x + velocity.x * remainingDt,
    y: arrow.position.y + velocity.y * remainingDt,
  };

  let segmentStart = { ...arrow.position };
  let workingRopes = ropes;
  let bounces = arrow.bounces;
  const events: CollisionEvent[] = [];
  const EPSILON = 1e-3;

  type Outcome = "stop" | "continue" | "bounced";

  // Re-scan the remainder of this tick's movement after every pass-through
  // or bounce collision, so one fast step can legitimately touch several
  // things (e.g. clip a wall, then cut a rope, then embed in the ground).
  const guardLimit = ropes.length + walls.length + people.length + PHYSICS.maxBounces + 4;
  for (let guard = 0; guard < guardLimit; guard++) {
    type Candidate = { at: Point; dist: number; apply: () => Outcome };
    const candidates: Candidate[] = [];

    for (const rope of workingRopes) {
      const result = applyArrowToRope(rope, segmentStart, naiveEnd);
      if (result.cut && result.at) {
        candidates.push({
          at: result.at,
          dist: distanceAlong(segmentStart, result.at),
          apply: () => {
            workingRopes = workingRopes.map((r) => (r.id === rope.id ? result.rope : r));
            events.push({ type: "rope", ropeId: rope.id, at: result.at! });
            return "continue";
          },
        });
      }
    }

    for (const person of people) {
      const personHit = applyArrowToPerson(person, segmentStart, naiveEnd);
      if (personHit.hit && personHit.at) {
        candidates.push({
          at: personHit.at,
          dist: distanceAlong(segmentStart, personHit.at),
          apply: () => {
            events.push({ type: "person", personId: person.id, at: personHit.at! });
            return "stop";
          },
        });
      }
    }

    const groundHit = groundIntersection(segmentStart, naiveEnd, ground.y);
    if (groundHit) {
      candidates.push({
        at: groundHit,
        dist: distanceAlong(segmentStart, groundHit),
        apply: () => {
          events.push({ type: "ground", at: groundHit });
          return "stop";
        },
      });
    }

    for (const wall of walls) {
      const wallHit = applyArrowToWall(wall, segmentStart, naiveEnd);
      if (wallHit.hit && wallHit.at && wallHit.normal) {
        const at = wallHit.at;
        const normal = wallHit.normal;
        candidates.push({
          at,
          dist: distanceAlong(segmentStart, at),
          apply: () => {
            bounces += 1;
            events.push({ type: "wall", at });
            const vDotN = velocity.x * normal.x + velocity.y * normal.y;
            const reflected = {
              x: (velocity.x - 2 * vDotN * normal.x) * PHYSICS.bounceRestitution,
              y: (velocity.y - 2 * vDotN * normal.y) * PHYSICS.bounceRestitution,
            };
            if (bounces > PHYSICS.maxBounces || length(reflected) < PHYSICS.embedSpeedThreshold) {
              return "stop";
            }
            // Velocity changed, so the rest of the tick's straight-line
            // path has to be recomputed from here — time and distance are
            // linearly related within a uniform-velocity pass, so the
            // travelled fraction of this pass gives the leftover time.
            const passLength = Math.max(distanceAlong(segmentStart, naiveEnd), EPSILON);
            const travelledFraction = distanceAlong(segmentStart, at) / passLength;
            remainingDt = remainingDt * (1 - travelledFraction);
            velocity = reflected;
            naiveEnd = { x: at.x + velocity.x * remainingDt, y: at.y + velocity.y * remainingDt };
            return "bounced";
          },
        });
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.dist - b.dist);
    const earliest = candidates[0];
    const outcome = earliest.apply();

    if (outcome === "stop") {
      return {
        arrow: { position: earliest.at, velocity: { x: 0, y: 0 }, embedded: true, bounces },
        events,
        ropes: workingRopes,
      };
    }

    if (outcome === "bounced") {
      // naiveEnd/velocity/remainingDt already point past the bounce;
      // nudge the start along the *new* direction of travel.
      const speed = length(velocity);
      if (speed < EPSILON) break;
      segmentStart = {
        x: earliest.at.x + (velocity.x / speed) * EPSILON,
        y: earliest.at.y + (velocity.y / speed) * EPSILON,
      };
      continue;
    }

    // Pass-through (rope cut): same velocity/naiveEnd, just nudge forward.
    const remaining = subtract(naiveEnd, earliest.at);
    const remainingLength = length(remaining);
    if (remainingLength < EPSILON) break;
    const nudge = { x: (remaining.x / remainingLength) * EPSILON, y: (remaining.y / remainingLength) * EPSILON };
    segmentStart = { x: earliest.at.x + nudge.x, y: earliest.at.y + nudge.y };
  }

  return {
    arrow: { position: naiveEnd, velocity, embedded: false, bounces },
    events,
    ropes: workingRopes,
  };
}
