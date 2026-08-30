import {
  PHYSICS,
  applyImpulse,
  launchVelocity,
  pendulumDirection,
  pendulumTangent,
  previewPoint,
  rotateVector,
  stepArrow,
  stepPendulum,
  type ArrowState,
  type GroundPlane,
  type PendulumState,
  type PersonHitbox,
  type Point,
  type RopeSegment,
} from "./game/physics.ts";

// World is taller than the original 960x540 (16:9) to give a portrait phone
// more filled screen before letterboxing kicks in. The whole scene below is
// translated down by Y_SHIFT inside the new height, not rescaled, so every
// distance/angle between anchor/rope/person/ground is byte-for-byte the same
// as the tested 16:9 layout — only the framing (sky above, platform depth
// below) changed, not the shot geometry or difficulty curve.
const WORLD_W = 960;
const WORLD_H = 640;
const Y_SHIFT = 50;
const ANCHOR: Point = { x: 150, y: 420 + Y_SHIFT };
const HOTSPOT_RADIUS = 110;
const MIN_DRAG_TO_FIRE = 8;
const START_ARROWS = 5;

const ground: GroundPlane = { y: 500 + Y_SHIFT };
const ROPE_TOP: Point = { x: 700, y: 40 + Y_SHIFT };
// Geometry only — the rope's rendered/collision length and the person's
// pivot radius are both derived from this rest layout once, at load time.
// After that, the rope's lower end and the person's center are two points
// on the same pendulum ray (see pendulumPoints below): they can never drift
// apart, because neither is stored independently again.
const REST_ROPE_BOTTOM: Point = { x: 700, y: 230 + Y_SHIFT };
const ROPE_LENGTH = REST_ROPE_BOTTOM.y - ROPE_TOP.y;
const PERSON_RADIUS = 20;
const REST_PERSON_CENTER: Point = { x: 700, y: 255 + Y_SHIFT };
const BODY_TIE_OFFSET = REST_PERSON_CENTER.y - REST_ROPE_BOTTOM.y;
const PIVOT_RADIUS = ROPE_LENGTH + BODY_TIE_OFFSET;
const PERSON_LAND_Y = ground.y - PERSON_RADIUS;

/** Rope's lower end and the person's center, both derived from the same
 * pendulum angle around ROPE_TOP — this is what makes them stay connected. */
function pendulumPoints(theta: number): { ropeEnd: Point; personCenter: Point } {
  const dir = pendulumDirection(theta);
  return {
    ropeEnd: { x: ROPE_TOP.x + dir.x * ROPE_LENGTH, y: ROPE_TOP.y + dir.y * ROPE_LENGTH },
    personCenter: { x: ROPE_TOP.x + dir.x * PIVOT_RADIUS, y: ROPE_TOP.y + dir.y * PIVOT_RADIUS },
  };
}

interface EmbeddedArrow {
  position: Point;
  angle: number;
}

/** An arrow embedded in the person, stored relative to the person's own
 * (unrotated) body frame so it moves and rotates rigidly with the body. */
interface PersonEmbeddedArrow {
  localOffset: Point;
  localAngle: number;
}

type Status = "ready" | "failed" | "won";

interface GameState {
  rope: RopeSegment;
  person: PersonHitbox;
  pendulum: PendulumState;
  personFalling: boolean;
  personLanded: boolean;
  /** person's linear velocity once the rope is cut and it free-falls */
  fallVelocity: Point;
  personFlinchUntil: number;
  arrowsRemaining: number;
  flying: ArrowState | null;
  flyingAngle: number;
  embedded: EmbeddedArrow[];
  personArrows: PersonEmbeddedArrow[];
  dragging: boolean;
  dragVector: Point;
  status: Status;
}

function freshState(): GameState {
  const pendulum: PendulumState = { theta: 0, omega: 0 };
  const { ropeEnd, personCenter } = pendulumPoints(pendulum.theta);
  return {
    rope: { id: "rescue", a: ROPE_TOP, b: ropeEnd, cut: false },
    person: { center: personCenter, radius: PERSON_RADIUS },
    pendulum,
    personFalling: false,
    personLanded: false,
    fallVelocity: { x: 0, y: 0 },
    personFlinchUntil: 0,
    arrowsRemaining: START_ARROWS,
    flying: null,
    flyingAngle: 0,
    embedded: [],
    personArrows: [],
    dragging: false,
    dragVector: { x: 0, y: 0 },
    status: "ready",
  };
}

let state = freshState();

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const restartButton = document.getElementById("restart") as HTMLButtonElement;

for (let i = 0; i < START_ARROWS; i++) {
  const pip = document.createElement("div");
  pip.className = "arrow-pip";
  hud.appendChild(pip);
}

function renderHud() {
  const pips = hud.querySelectorAll(".arrow-pip");
  pips.forEach((pip, i) => {
    pip.classList.toggle("spent", i >= state.arrowsRemaining);
  });
}

function showOverlay(label: string) {
  restartButton.textContent = label;
  overlay.hidden = false;
}

restartButton.addEventListener("click", () => {
  state = freshState();
  overlay.hidden = true;
  renderHud();
});

// --- layout: a fixed logical world, scaled+letterboxed to fit the viewport,
// so gameplay (positions, physics) is identical at every marking viewport. ---
let scale = 1;
let offsetX = 0;
let offsetY = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.min(cssW / WORLD_W, cssH / WORLD_H);
  offsetX = (cssW - WORLD_W * scale) / 2;
  offsetY = (cssH - WORLD_H * scale) / 2;
}

window.addEventListener("resize", resize);
resize();

function toWorld(clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
}

function clampDrag(raw: Point): Point {
  const len = Math.hypot(raw.x, raw.y);
  if (len <= PHYSICS.maxDrawDistance) return raw;
  const k = PHYSICS.maxDrawDistance / len;
  return { x: raw.x * k, y: raw.y * k };
}

let activePointerId: number | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (state.status !== "ready" || state.flying) return;
  const world = toWorld(e.clientX, e.clientY);
  const distToAnchor = Math.hypot(world.x - ANCHOR.x, world.y - ANCHOR.y);
  if (distToAnchor > HOTSPOT_RADIUS) return;
  state.dragging = true;
  state.dragVector = { x: 0, y: 0 };
  activePointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("aiming");
});

canvas.addEventListener("pointermove", (e) => {
  const world = toWorld(e.clientX, e.clientY);
  if (state.dragging && e.pointerId === activePointerId) {
    const raw = { x: world.x - ANCHOR.x, y: world.y - ANCHOR.y };
    state.dragVector = clampDrag(raw);
    return;
  }
  if (state.status === "ready" && !state.flying) {
    const near = Math.hypot(world.x - ANCHOR.x, world.y - ANCHOR.y) <= HOTSPOT_RADIUS;
    canvas.classList.toggle("aimable", near);
  }
});

function release(e: PointerEvent) {
  if (!state.dragging || e.pointerId !== activePointerId) return;
  state.dragging = false;
  canvas.classList.remove("aiming");
  canvas.releasePointerCapture(e.pointerId);
  const drag = state.dragVector;
  const pulled = Math.hypot(drag.x, drag.y);
  state.dragVector = { x: 0, y: 0 };
  if (pulled < MIN_DRAG_TO_FIRE) return; // treated as no shot, no arrow spent
  state.arrowsRemaining -= 1;
  state.flying = { position: { ...ANCHOR }, velocity: launchVelocity(drag), embedded: false };
  renderHud();
}

canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

// --- update ---
let lastT = performance.now();

function update(now: number) {
  const dt = Math.min((now - lastT) / 1000, 1 / 30);
  lastT = now;

  // While the rope is intact, the person is a live pendulum: its position
  // and the rope's collision/rendered endpoint both come from `theta` this
  // frame, never from an independently-stored point.
  if (!state.personFalling) {
    state.pendulum = stepPendulum(state.pendulum, PIVOT_RADIUS, dt);
    const { ropeEnd, personCenter } = pendulumPoints(state.pendulum.theta);
    state.rope = { ...state.rope, b: ropeEnd };
    state.person.center = personCenter;
  }

  if (state.flying) {
    const incomingVelocity = state.flying.velocity;
    state.flyingAngle = Math.atan2(incomingVelocity.y, incomingVelocity.x);
    const result = stepArrow(state.flying, [state.rope], state.person, ground, dt);
    state.rope = result.ropes[0];
    for (const event of result.events) {
      if (event.type === "rope") {
        // Constraint removed: the person keeps whatever linear velocity the
        // swing implied at this instant and free-falls from there.
        state.personFalling = true;
        const tangent = pendulumTangent(state.pendulum.theta);
        const speed = state.pendulum.omega * PIVOT_RADIUS;
        state.fallVelocity = { x: tangent.x * speed, y: tangent.y * speed };
      } else if (event.type === "person") {
        state.personFlinchUntil = now + 150;
        state.pendulum = applyImpulse(state.pendulum, incomingVelocity);
        const worldOffset = { x: event.at.x - state.person.center.x, y: event.at.y - state.person.center.y };
        state.personArrows.push({
          localOffset: rotateVector(worldOffset, -state.pendulum.theta),
          localAngle: state.flyingAngle - state.pendulum.theta,
        });
      }
    }
    if (result.arrow.embedded) {
      const embeddedInPerson = result.events.some((e) => e.type === "person");
      if (!embeddedInPerson) {
        state.embedded.push({ position: result.arrow.position, angle: state.flyingAngle });
      }
      state.flying = null;
      if (state.arrowsRemaining <= 0 && !state.personLanded) {
        state.status = "failed";
        showOverlay("RESTART");
      }
    } else {
      state.flying = result.arrow;
    }
  }

  if (state.personFalling && !state.personLanded) {
    state.fallVelocity.y += PHYSICS.gravity * dt;
    state.person.center.x = clamp(state.person.center.x + state.fallVelocity.x * dt, PERSON_RADIUS, WORLD_W - PERSON_RADIUS);
    state.person.center.y += state.fallVelocity.y * dt;
    if (state.person.center.y >= PERSON_LAND_Y) {
      state.person.center.y = PERSON_LAND_Y;
      state.personLanded = true;
      state.status = "won";
      showOverlay("AGAIN");
    }
  }

  draw(now);
  renderHud();
  requestAnimationFrame(update);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// --- draw helpers (visual dressing only — none of this reads or writes
// game state beyond what's needed to render it) ---

/** The safe landing platform: a plank surface on top of the ground/support
 * mass, unmistakably a place to land rather than generic floor fill. */
function drawPlatform() {
  ctx.fillStyle = "#2b2118";
  ctx.fillRect(0, ground.y, WORLD_W, WORLD_H - ground.y);

  const plankDepth = 20;
  ctx.fillStyle = "#a9713f";
  ctx.fillRect(0, ground.y, WORLD_W, plankDepth);
  ctx.strokeStyle = "#7a4e2c";
  ctx.lineWidth = 2;
  for (let x = 0; x < WORLD_W; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, ground.y);
    ctx.lineTo(x, ground.y + plankDepth);
    ctx.stroke();
  }
  ctx.strokeStyle = "#5c3a20";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, ground.y + plankDepth);
  ctx.lineTo(WORLD_W, ground.y + plankDepth);
  ctx.stroke();
}

/** The rope: tied to a wooden crossbeam (not floating), rendered with a
 * braided texture instead of a bare stroke. Its lower end is always
 * `state.rope.b` — the same point the physical/collision model uses — so
 * there is no separate drawn endpoint that could drift out of sync. */
function drawRope() {
  ctx.fillStyle = "#5c3a20";
  ctx.fillRect(ROPE_TOP.x - 45, ROPE_TOP.y - 14, 90, 14);
  ctx.strokeStyle = "#3a2414";
  ctx.lineWidth = 1;
  ctx.strokeRect(ROPE_TOP.x - 45, ROPE_TOP.y - 14, 90, 14);

  if (state.rope.cut) {
    // A short cut stub still hanging from the beam — no longer connects to
    // anything, so it isn't drawn from live pendulum state.
    ctx.strokeStyle = "#c9b98a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ROPE_TOP.x, ROPE_TOP.y);
    ctx.lineTo(ROPE_TOP.x + 4, ROPE_TOP.y + 28);
    ctx.stroke();
    return;
  }

  const end = state.rope.b;
  const dx = end.x - ROPE_TOP.x;
  const dy = end.y - ROPE_TOP.y;
  const ropeLen = Math.hypot(dx, dy);
  ctx.strokeStyle = "#c9b98a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ROPE_TOP.x, ROPE_TOP.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = "#8a7550";
  ctx.lineWidth = 1.5;
  for (let d = 6; d < ropeLen; d += 9) {
    const t = d / ropeLen;
    const px = ROPE_TOP.x + dx * t;
    const py = ROPE_TOP.y + dy * t;
    const nx = -dy / ropeLen;
    const ny = dx / ropeLen;
    ctx.beginPath();
    ctx.moveTo(px - nx * 3, py - ny * 3);
    ctx.lineTo(px + nx * 3, py + ny * 3);
    ctx.stroke();
  }
}

/** A recognisable hanging figure (head, vest torso, bound arms, legs) built
 * from primitives around the same center/radius the physics hitbox uses —
 * only the drawing gets richer, the hitbox geometry is untouched. Every
 * local offset is rotated by the live pendulum angle before being added to
 * the center, so the whole body swings/falls as one rigid figure — the tie
 * point this produces lands exactly on the rope's drawn end by construction. */
function drawPerson(now: number) {
  const p = state.person.center;
  const r = state.person.radius;
  const theta = state.pendulum.theta;
  const at = (local: Point): Point => {
    const w = rotateVector(local, theta);
    return { x: p.x + w.x, y: p.y + w.y };
  };
  const flinching = now < state.personFlinchUntil;
  const skin = flinching ? "#e85c5c" : "#e8c07a";
  const vest = flinching ? "#c94f2f" : "#d97b3f";
  const tie = at({ x: 0, y: -r * 1.6 });
  const shoulderL = at({ x: -r * 0.25, y: -r * 0.5 });
  const shoulderR = at({ x: r * 0.25, y: -r * 0.5 });

  // arms bound up to the rope
  ctx.strokeStyle = "#c9b98a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tie.x, tie.y);
  ctx.lineTo(shoulderL.x, shoulderL.y);
  ctx.moveTo(tie.x, tie.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  ctx.stroke();

  // legs
  const hipL = at({ x: -r * 0.15, y: r * 0.6 });
  const footL = at({ x: -r * 0.4, y: r * 1.3 });
  const hipR = at({ x: r * 0.15, y: r * 0.6 });
  const footR = at({ x: r * 0.4, y: r * 1.3 });
  ctx.strokeStyle = "#4a3826";
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hipL.x, hipL.y);
  ctx.lineTo(footL.x, footL.y);
  ctx.moveTo(hipR.x, hipR.y);
  ctx.lineTo(footR.x, footR.y);
  ctx.stroke();
  ctx.lineCap = "butt";

  // torso (vest) — a rotated rect, drawn via save/translate/rotate since
  // fillRect itself can't take an offset local frame
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(theta);
  ctx.fillStyle = vest;
  ctx.fillRect(-r * 0.45, -r * 0.5, r * 0.9, r * 1.1);
  ctx.restore();

  // head
  const head = at({ x: 0, y: -r * 0.9 });
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(head.x, head.y, r * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // arrows embedded in the body — move/rotate rigidly with it
  ctx.strokeStyle = "#d8d0bd";
  ctx.lineWidth = 4;
  for (const a of state.personArrows) {
    const world = at(a.localOffset);
    ctx.save();
    ctx.translate(world.x, world.y);
    ctx.rotate(theta + a.localAngle);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(6, 0);
    ctx.stroke();
    ctx.restore();
  }
}

/** The bow: a fixed wooden rig (post + braces) holding a carved-limb bow,
 * not a bare stroked arc. String/nock/preview logic is untouched below. */
function drawBowStand() {
  ctx.strokeStyle = "#5c3a20";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(ANCHOR.x, ANCHOR.y + 30);
  ctx.lineTo(ANCHOR.x, ground.y);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(ANCHOR.x - 26, ground.y);
  ctx.lineTo(ANCHOR.x, ANCHOR.y + 40);
  ctx.moveTo(ANCHOR.x + 26, ground.y);
  ctx.lineTo(ANCHOR.x, ANCHOR.y + 40);
  ctx.stroke();
}

// --- draw ---
function draw(now: number) {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  // full-canvas wash so letterbox bars blend into the scene as a frame
  // rather than reading as dead/broken space.
  const canvasSky = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
  canvasSky.addColorStop(0, "#20263a");
  canvasSky.addColorStop(1, "#12141c");
  ctx.fillStyle = canvasSky;
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // world sky
  const worldSky = ctx.createLinearGradient(0, 0, 0, ground.y);
  worldSky.addColorStop(0, "#242b40");
  worldSky.addColorStop(1, "#1b1f2c");
  ctx.fillStyle = worldSky;
  ctx.fillRect(0, 0, WORLD_W, ground.y);

  drawPlatform();
  drawBowStand();
  drawRope();
  drawPerson(now);

  // ground-embedded arrows (arrows embedded in the person are drawn inside
  // drawPerson, since they must move/rotate with the body)
  ctx.strokeStyle = "#d8d0bd";
  ctx.lineWidth = 4;
  for (const a of state.embedded) {
    ctx.save();
    ctx.translate(a.position.x, a.position.y);
    ctx.rotate(a.angle);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(6, 0);
    ctx.stroke();
    ctx.restore();
  }

  // trajectory preview while aiming
  if (state.dragging) {
    const v = launchVelocity(state.dragVector);
    ctx.fillStyle = "rgba(232, 220, 192, 0.55)";
    for (let t = 0.05; t <= 0.6; t += 0.05) {
      const p = previewPoint(ANCHOR, v, t);
      if (p.y > ground.y) break;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // bow + string
  const pull = state.dragging ? state.dragVector : { x: 0, y: 0 };
  const idlePulse = state.dragging || state.flying ? 0 : 0.5 + 0.5 * Math.sin(now / 500);
  ctx.save();
  ctx.translate(ANCHOR.x, ANCHOR.y);
  const bowGrad = ctx.createLinearGradient(-60, -60, 60, 60);
  bowGrad.addColorStop(0, "#a9713f");
  bowGrad.addColorStop(0.5, "#6b4423");
  bowGrad.addColorStop(1, "#4e3018");
  ctx.strokeStyle = bowGrad;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 60, -Math.PI * 0.32, Math.PI * 0.32);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 235, 200, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 56, -Math.PI * 0.3, Math.PI * 0.3);
  ctx.stroke();
  ctx.fillStyle = "#3a2414";
  ctx.fillRect(-9, -16, 18, 32);
  const tipTop = { x: 60 * Math.cos(-Math.PI * 0.32), y: 60 * Math.sin(-Math.PI * 0.32) };
  const tipBottom = { x: 60 * Math.cos(Math.PI * 0.32), y: 60 * Math.sin(Math.PI * 0.32) };
  const nock = { x: pull.x, y: pull.y };
  ctx.strokeStyle = "#e8dcc0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tipTop.x, tipTop.y);
  ctx.lineTo(nock.x, nock.y);
  ctx.lineTo(tipBottom.x, tipBottom.y);
  ctx.stroke();

  // nocked arrow (idle glow when nothing has happened yet, so the eye lands here first)
  if (!state.flying) {
    const glow = 6 + idlePulse * 6;
    ctx.save();
    ctx.shadowColor = "rgba(255, 225, 150, 0.9)";
    ctx.shadowBlur = glow;
    const dir = state.dragging ? Math.atan2(-nock.y, -nock.x) : 0;
    ctx.translate(nock.x, nock.y);
    ctx.rotate(dir);
    ctx.strokeStyle = "#f2e9d4";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(34, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // flying arrow
  if (state.flying) {
    ctx.save();
    ctx.translate(state.flying.position.x, state.flying.position.y);
    ctx.rotate(state.flyingAngle);
    ctx.strokeStyle = "#f2e9d4";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(16, 0);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

requestAnimationFrame((t) => {
  lastT = t;
  requestAnimationFrame(update);
});
