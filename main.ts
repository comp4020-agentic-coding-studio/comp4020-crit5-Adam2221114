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
  type Wall,
} from "./game/physics.ts";

// Two distinct scene compositions, not one board scaled to fit everywhere:
// a wide landscape layout for desktop browsers and a recomposed portrait
// layout for narrow/tall mobile screens. Which one is active is decided in
// resize() from the viewport's own aspect ratio, and #board is then sized to
// that profile's WORLD_W:WORLD_H exactly and centred in the viewport — so
// there is no letterboxing to disguise and no separate canvas-vs-world
// framing (see resize()).
type ProfileKind = "landscape" | "portrait";
type Level = 1 | 2;

/** One hanging person's full rope+body geometry — every person, on every
 * level, hangs from exactly one straight-down rope (`theta0` is implicitly
 * 0, so no stored rest angle is needed). `ropeId` names that person's rope
 * in `Profile.walls`-adjacent `state.ropes`; `landY` is this person's own
 * safe-landing world y (uniform per level since there's one shared ground
 * plane, but kept per-person since radius can differ). */
interface PersonGeometry {
  id: string;
  ropeId: string;
  anchor: Point;
  ropeLength: number;
  tieOffset: number;
  pivotRadius: number;
  radius: number;
  restCenter: Point;
  landY: number;
}

interface Profile {
  kind: ProfileKind;
  level: Level;
  WORLD_W: number;
  WORLD_H: number;
  ANCHOR: Point;
  HOTSPOT_RADIUS: number;
  ground: GroundPlane;
  /** Every solid surface an arrow can ricochet off: the boundary edges plus
   * any placed puzzle obstacles — same engine feature every level, not a
   * Level 2 special case. */
  walls: Wall[];
  /** The non-boundary subset of `walls`, kept separately purely so drawing
   * can render placed obstacles as wood without also drawing the invisible
   * play-area edges. */
  obstacles: Wall[];
  persons: PersonGeometry[];
}

/** Derives one person's full geometry from an explicit rope length/tie
 * offset (rather than a rest-center-y + fraction) so every number here is
 * exactly the one a reachability sweep already verified — no fraction/
 * division round-trip that could drift a verified value by even a ULP. */
function buildPersonGeometry(
  id: string,
  anchor: Point,
  ropeLength: number,
  tieOffset: number,
  radius: number,
  groundY: number,
): PersonGeometry {
  const pivotRadius = ropeLength + tieOffset;
  return {
    id,
    ropeId: id,
    anchor,
    ropeLength,
    tieOffset,
    pivotRadius,
    radius,
    restCenter: { x: anchor.x, y: anchor.y + pivotRadius },
    landY: groundY - radius,
  };
}

/** Left/right/top play-area edges as solid walls; the bottom is deliberately
 * excluded — the ground plane already embeds arrows there. */
function boundaryWalls(worldW: number, worldH: number): Wall[] {
  return [
    { id: "wall-left", a: { x: 0, y: 0 }, b: { x: 0, y: worldH } },
    { id: "wall-right", a: { x: worldW, y: 0 }, b: { x: worldW, y: worldH } },
    { id: "wall-top", a: { x: 0, y: 0 }, b: { x: worldW, y: 0 } },
  ];
}

function buildLevelProfile(
  kind: ProfileKind,
  level: Level,
  worldW: number,
  worldH: number,
  anchor: Point,
  hotspotRadius: number,
  groundY: number,
  obstacles: Wall[],
  persons: PersonGeometry[],
): Profile {
  return {
    kind,
    level,
    WORLD_W: worldW,
    WORLD_H: worldH,
    ANCHOR: anchor,
    HOTSPOT_RADIUS: hotspotRadius,
    ground: { y: groundY },
    walls: [...boundaryWalls(worldW, worldH), ...obstacles],
    obstacles,
    persons,
  };
}

/** Builds a Level 1 profile: no obstacles, one person on one rope. Same
 * rest-layout numbers the original single-rope profile used, just reshaped
 * into the persons-array form every level now shares — reproduces that
 * geometry exactly. */
function buildSingleRopeProfile(
  kind: ProfileKind,
  worldW: number,
  worldH: number,
  anchor: Point,
  hotspotRadius: number,
  groundY: number,
  ropeTop: Point,
  restRopeBottomY: number,
  restPersonCenterY: number,
  personRadius: number,
): Profile {
  const ropeLength = restRopeBottomY - ropeTop.y;
  const tieOffset = restPersonCenterY - restRopeBottomY;
  const person = buildPersonGeometry("rescue", ropeTop, ropeLength, tieOffset, personRadius, groundY);
  return buildLevelProfile(kind, 1, worldW, worldH, anchor, hotspotRadius, groundY, [], [person]);
}

// Mobile/portrait: bow low-left, rescue structure upper-right, recomposed so
// both stay large and touchable in a tall board rather than a shrunk-down
// landscape scene.
const L1_PORTRAIT: Profile = buildSingleRopeProfile(
  "portrait",
  480,
  960,
  { x: 100, y: 660 },
  90,
  800,
  { x: 380, y: 320 },
  510,
  535,
  20,
);

// Desktop/landscape: a wide side-view composition — bow on the left,
// rescue structure on the right, with enough of a gap between them to use
// the horizontal space meaningfully without a giant empty void.
const L1_LANDSCAPE: Profile = buildSingleRopeProfile(
  "landscape",
  960,
  540,
  { x: 170, y: 381 },
  170,
  460,
  { x: 700, y: 162 },
  269,
  283,
  12,
);

// Level 2, landscape: four independent people at different heights/positions
// behind two timber walls and an overhead beam. Verified by a throwaway
// reachability sweep (scripts/reach_sweep_l2.ts, deleted once verification
// passed) against this exact geometry, driving the real stepArrow/
// launchVelocity rather than hand-derived trig:
//   - p1 has a wide direct-hit elevation band (32°-53°) — the easy, direct
//     rescue that reinforces the base rule.
//   - p2/p3/p4 all have an EMPTY direct-hit band at full draw (wallA/wallB
//     block every trajectory that reaches them) but a genuine, non-empty
//     bounce-then-cut band each (wallA ~41-47°/58-60°, wallB ~48°, beam gap
//     ~48-50°) — ricochet off the right boundary is the only way in.
//   - a chained triple-cut exists at 48° (one arrow threading the beam gap
//     cuts p4 then p3 on the same return leg) — the "skilled multi-rope
//     shot" case.
// Caveat, disclosed rather than chased further: at partial draw (~0.9-0.95x)
// a few narrow direct-hit windows open for p2/p3/p4 that don't exist at full
// draw — an inherent consequence of a fixed-height wall against a continuous
// projectile envelope, not a coding bug.
const L2_LANDSCAPE: Profile = buildLevelProfile(
  "landscape",
  2,
  960,
  540,
  { x: 170, y: 381 },
  170,
  460,
  [
    { id: "wallA", a: { x: 560, y: 460 }, b: { x: 560, y: 140 } },
    { id: "wallB", a: { x: 800, y: 460 }, b: { x: 800, y: 200 } },
    { id: "beam", a: { x: 830, y: 140 }, b: { x: 900, y: 140 } },
  ],
  [
    buildPersonGeometry("p1", { x: 380, y: 140 }, 136, 24, 12, 460),
    buildPersonGeometry("p2", { x: 650, y: 230 }, 144.5, 25.5, 12, 460),
    buildPersonGeometry("p3", { x: 830, y: 280 }, 119, 21, 12, 460),
    buildPersonGeometry("p4", { x: 920, y: 120 }, 85, 15, 12, 460),
  ],
);

// Level 2, portrait: same four-person idea recomposed for the tall board,
// independently verified by its own sweep (scripts/reach_sweep_l2_portrait.ts,
// deleted once verification passed) against three vertical timber walls:
//   - p1 has a wide direct-hit band (58.5°-73.25°) — the easy rescue.
//   - p2/p3/p4 all have an EMPTY direct-hit band at full draw; each has a
//     genuine bounce band (p2 73-75.75°+bonus, p3 73-74.5°+bonus, p4
//     73-77.5°) reached by bouncing off the right wall.
//   - a spectacular bonus: 73-73.25° cuts all four ropes in one arrow, and
//     73.5-75.75° cuts three.
// Same partial-draw caveat as landscape applies (disclosed, not chased).
const L2_PORTRAIT: Profile = buildLevelProfile(
  "portrait",
  2,
  480,
  960,
  { x: 100, y: 660 },
  90,
  800,
  [
    { id: "wallA", a: { x: 230, y: 800 }, b: { x: 230, y: 400 } },
    { id: "wallC", a: { x: 320, y: 800 }, b: { x: 320, y: 150 } },
    { id: "wallB", a: { x: 350, y: 800 }, b: { x: 350, y: 150 } },
  ],
  [
    buildPersonGeometry("p1", { x: 180, y: 420 }, 140, 0, 12, 800),
    buildPersonGeometry("p2", { x: 410, y: 80 }, 100, 0, 12, 800),
    buildPersonGeometry("p3", { x: 380, y: 120 }, 100, 0, 12, 800),
    buildPersonGeometry("p4", { x: 440, y: 40 }, 100, 0, 12, 800),
  ],
);

const PROFILES: Record<Level, Record<ProfileKind, Profile>> = {
  1: { landscape: L1_LANDSCAPE, portrait: L1_PORTRAIT },
  2: { landscape: L2_LANDSCAPE, portrait: L2_PORTRAIT },
};

function pickOrientation(): ProfileKind {
  return window.innerWidth >= window.innerHeight ? "landscape" : "portrait";
}

function pickProfile(level: Level): Profile {
  return PROFILES[level][pickOrientation()];
}

let currentLevel: Level = 1;
let profile: Profile = pickProfile(currentLevel);

const MIN_DRAG_TO_FIRE = 8;
const START_ARROWS = 5;
const PERSON_VISUAL_SCALE = 1.3;

/** Rope's lower end and the person's center for one person's geometry, both
 * derived from the same pendulum angle around its anchor — this is what
 * keeps them connected without storing either point independently. */
function pendulumPointsFor(geom: PersonGeometry, theta: number): { ropeEnd: Point; personCenter: Point } {
  const dir = pendulumDirection(theta);
  return {
    ropeEnd: { x: geom.anchor.x + dir.x * geom.ropeLength, y: geom.anchor.y + dir.y * geom.ropeLength },
    personCenter: { x: geom.anchor.x + dir.x * geom.pivotRadius, y: geom.anchor.y + dir.y * geom.pivotRadius },
  };
}

interface EmbeddedArrow {
  position: Point;
  angle: number;
}

/** An arrow embedded in a person, stored relative to that person's own
 * (unrotated) body frame so it moves and rotates rigidly with the body. */
interface PersonEmbeddedArrow {
  localOffset: Point;
  localAngle: number;
}

/** One person's live runtime state, one per `profile.persons[i]`. Every
 * person has exactly one rope, so a rope cut always immediately triggers
 * that person's fall — there's no "still held by another rope" state to
 * track, unlike the old two-rope-one-person Level 2. */
interface PersonRuntime {
  id: string;
  ropeId: string;
  center: Point;
  radius: number;
  pendulum: PendulumState;
  falling: boolean;
  landed: boolean;
  fallVelocity: Point;
  flinchUntil: number;
  embeddedArrows: PersonEmbeddedArrow[];
}

type Status = "ready" | "failed" | "won";

interface GameState {
  ropes: RopeSegment[];
  people: PersonRuntime[];
  arrowsRemaining: number;
  flying: ArrowState | null;
  flyingAngle: number;
  embedded: EmbeddedArrow[];
  dragging: boolean;
  dragVector: Point;
  status: Status;
}

function freshState(): GameState {
  const ropes: RopeSegment[] = profile.persons.map((p) => ({ id: p.ropeId, a: p.anchor, b: p.anchor, cut: false }));
  const people: PersonRuntime[] = profile.persons.map((p, i) => {
    const pendulum: PendulumState = { theta: 0, omega: 0 };
    const { ropeEnd, personCenter } = pendulumPointsFor(p, pendulum.theta);
    ropes[i] = { ...ropes[i], b: ropeEnd };
    return {
      id: p.id,
      ropeId: p.ropeId,
      center: personCenter,
      radius: p.radius,
      pendulum,
      falling: false,
      landed: false,
      fallVelocity: { x: 0, y: 0 },
      flinchUntil: 0,
      embeddedArrows: [],
    };
  });

  return {
    ropes,
    people,
    arrowsRemaining: START_ARROWS,
    flying: null,
    flyingAngle: 0,
    embedded: [],
    dragging: false,
    dragVector: { x: 0, y: 0 },
    status: "ready",
  };
}

let state = freshState();

const board = document.getElementById("board") as HTMLDivElement;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const restartButton = document.getElementById("restart") as HTMLButtonElement;
const failMeme = document.getElementById("fail-meme") as HTMLImageElement;

const SVG_NS = "http://www.w3.org/2000/svg";

/** A miniature arrow silhouette (shaft + head + fletching), the same shape
 * language as the canvas glyph (see drawArrowGlyph), for the remaining-
 * arrows HUD — recognisable arrows instead of rounded dash pips. */
function createArrowPip(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.classList.add("arrow-pip");

  // Fins flare backward and outward from the shaft's edges, off the
  // centerline (never meeting at a single tail point, or they'd visually
  // fuse into a second arrowhead pointing the other way).
  const fletchTop = document.createElementNS(SVG_NS, "polygon");
  fletchTop.setAttribute("class", "pip-fletch");
  fletchTop.setAttribute("points", "15,14 8,10 15,10");
  svg.appendChild(fletchTop);

  const fletchBottom = document.createElementNS(SVG_NS, "polygon");
  fletchBottom.setAttribute("class", "pip-fletch");
  fletchBottom.setAttribute("points", "15,18 8,22 15,22");
  svg.appendChild(fletchBottom);

  const shaft = document.createElementNS(SVG_NS, "rect");
  shaft.setAttribute("class", "pip-shaft");
  shaft.setAttribute("x", "8");
  shaft.setAttribute("y", "14");
  shaft.setAttribute("width", "16");
  shaft.setAttribute("height", "4");
  svg.appendChild(shaft);

  const head = document.createElementNS(SVG_NS, "polygon");
  head.setAttribute("class", "pip-head");
  head.setAttribute("points", "22,9 30,16 22,23");
  svg.appendChild(head);

  return svg;
}

for (let i = 0; i < START_ARROWS; i++) {
  hud.appendChild(createArrowPip());
}

function renderHud() {
  const pips = hud.querySelectorAll(".arrow-pip");
  pips.forEach((pip, i) => {
    pip.classList.toggle("spent", i >= state.arrowsRemaining);
  });
}

function showOverlay(label: string, showMeme = false) {
  restartButton.textContent = label;
  failMeme.hidden = !showMeme;
  overlay.hidden = false;
}

restartButton.addEventListener("click", () => {
  // Replays whichever level is currently active — Level 2's AGAIN/RESTART
  // does not send the player back to the start screen or Level 1.
  state = freshState();
  overlay.hidden = true;
  renderHud();
});

/** Swaps the active level's profile/state and clears the ready-to-play UI —
 * shared by the initial load and every level intro. */
function startLevel(level: Level) {
  currentLevel = level;
  profile = pickProfile(currentLevel);
  state = freshState();
  overlay.hidden = true;
  renderHud();
}

/** Top-level presentation phase, independent of the per-level `state.status`
 * ("ready"/"won"/"failed"): gates player input and the win/fail check so the
 * start screen, level-intro cards, and the L1->L2 sequence are all
 * non-interactive beats layered over a scene that keeps rendering (and, at
 * "start", idling) underneath them. */
type AppPhase = "start" | "intro" | "playing" | "sequence";
let appPhase: AppPhase = "start";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const cardEl = document.getElementById("card") as HTMLDivElement;
const cardTitleEl = cardEl.querySelector(".card-title") as HTMLSpanElement;
const cardSubtitleEl = cardEl.querySelector(".card-subtitle") as HTMLSpanElement;

/** Shows a two-line title card (optionally in the red/orange "hype" variant
 * used only for the Level 2 escalation beats), holds it for `durationMs`,
 * then fades it out. Resolves once it's fully hidden again, so callers can
 * `await` a sequence of these back-to-back. */
function showCard(title: string, subtitle: string, variant: "" | "hype", durationMs: number): Promise<void> {
  cardTitleEl.textContent = title;
  cardSubtitleEl.textContent = subtitle;
  cardEl.className = "card" + (variant ? ` ${variant}` : "");
  cardEl.hidden = false;
  return new Promise((resolve) => {
    requestAnimationFrame(() => cardEl.classList.add("show"));
    window.setTimeout(() => {
      cardEl.classList.remove("show");
      window.setTimeout(() => {
        cardEl.hidden = true;
        resolve();
      }, 200);
    }, durationMs);
  });
}

/** Every level starts with a brief, automatic title card (no click needed)
 * before input is enabled — shared by the start screen's Level 1 launch and
 * the end of the Level 2 sequence below. ~1.5s readable hold so a first-time
 * player has time to actually read it, not just notice it flash by. */
async function introAndStart(level: Level) {
  appPhase = "intro";
  startLevel(level);
  const [title, subtitle] = level === 1 ? ["LEVEL 1", "FIRST RESCUE"] : ["LEVEL 2", "RICOCHET RESCUE"];
  await showCard(title, subtitle, "", 1500);
  appPhase = "playing";
}

/** The dramatic Level 1 -> Level 2 handoff: hold on the rescue, a short
 * shake/flash impact beat, two hype cards ("DIFFICULTY SPIKE" then the
 * top-10% challenge line — in-game hype copy, not a measured statistic),
 * then the normal Level 2 title card via `introAndStart`. Paced deliberately
 * slow (~6s total) so each beat is fully readable before the next replaces
 * it — this is a dramatic pause, not a loading delay. */
async function runLevelTwoSequence() {
  appPhase = "sequence";
  await sleep(850); // hold on the successful rescue
  board.classList.add("impact");
  await sleep(450); // shake/flash impact beat
  board.classList.remove("impact");
  await showCard("DIFFICULTY SPIKE", "", "hype", 1300);
  await showCard("BEAT LEVEL 2.", "ENTER THE TOP 10%.", "hype", 1700);
  await introAndStart(2);
}

const startScreen = document.getElementById("start-screen") as HTMLDivElement;
const startButton = document.getElementById("start-button") as HTMLButtonElement;

startButton.addEventListener("click", () => {
  startScreen.classList.add("hide");
  window.setTimeout(() => {
    startScreen.hidden = true;
  }, 250);
  introAndStart(1);
});

// --- layout: #board is sized in real CSS px to a box that preserves the
// active profile's WORLD_W:WORLD_H exactly and is centred in the viewport
// (see styles.css's flex-centred body); the canvas fills that box 1:1, so
// scale is uniform and offsetX/offsetY are always ~0. ---
let scale = 1;
let offsetX = 0;
let offsetY = 0;

function resize() {
  const nextProfile = pickProfile(currentLevel);
  const busy = appPhase === "intro" || appPhase === "sequence";
  if (!busy && nextProfile.kind !== profile.kind) {
    // A landscape<->portrait flip is a different scene composition, not a
    // resize of the same one — restart cleanly under the new geometry
    // rather than trying to migrate live pendulum/arrow state across it.
    profile = nextProfile;
    state = freshState();
    overlay.hidden = true;
    renderHud();
  }

  const { WORLD_W, WORLD_H } = profile;
  const maxW = window.innerWidth * 0.96;
  const maxH = window.innerHeight * 0.92;
  const worldAspect = WORLD_W / WORLD_H;
  let boardW = maxW;
  let boardH = boardW / worldAspect;
  if (boardH > maxH) {
    boardH = maxH;
    boardW = boardH * worldAspect;
  }
  board.style.width = `${boardW}px`;
  board.style.height = `${boardH}px`;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = cssW / WORLD_W;
  offsetX = 0;
  offsetY = 0;
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
  if (appPhase !== "playing" || state.status !== "ready" || state.flying) return;
  const { ANCHOR, HOTSPOT_RADIUS } = profile;
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
  const { ANCHOR, HOTSPOT_RADIUS } = profile;
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
  const { ANCHOR } = profile;
  state.dragging = false;
  canvas.classList.remove("aiming");
  canvas.releasePointerCapture(e.pointerId);
  const drag = state.dragVector;
  const pulled = Math.hypot(drag.x, drag.y);
  state.dragVector = { x: 0, y: 0 };
  if (pulled < MIN_DRAG_TO_FIRE) return; // treated as no shot, no arrow spent
  state.arrowsRemaining -= 1;
  state.flying = { position: { ...ANCHOR }, velocity: launchVelocity(drag), embedded: false, bounces: 0 };
  renderHud();
}

canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

// --- update ---
let lastT = performance.now();

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function update(now: number) {
  const { ground, walls, WORLD_W } = profile;
  const dt = Math.min((now - lastT) / 1000, 1 / 30);
  lastT = now;

  // While a person's rope is intact, their position and that rope's
  // collision/rendered endpoint both come from `theta` this frame, never
  // from an independently-stored point.
  for (let i = 0; i < state.people.length; i++) {
    const runtime = state.people[i];
    const geom = profile.persons[i];
    if (runtime.falling || runtime.landed) continue;
    runtime.pendulum = stepPendulum(runtime.pendulum, geom.pivotRadius, dt);
    const { ropeEnd, personCenter } = pendulumPointsFor(geom, runtime.pendulum.theta);
    const ropeIndex = state.ropes.findIndex((r) => r.id === geom.ropeId);
    if (ropeIndex !== -1 && !state.ropes[ropeIndex].cut) {
      state.ropes[ropeIndex] = { ...state.ropes[ropeIndex], b: ropeEnd };
    }
    runtime.center = personCenter;
  }

  if (state.flying) {
    const incomingVelocity = state.flying.velocity;
    state.flyingAngle = Math.atan2(incomingVelocity.y, incomingVelocity.x);
    // A rescued (landed) person is no longer a target — everyone still
    // hanging or mid-fall stays hittable, one arrow may still cut/hit
    // several of them in a single pass (stepArrow already resolves that
    // chronologically).
    const peopleHitboxes: PersonHitbox[] = state.people
      .filter((p) => !p.landed)
      .map((p) => ({ id: p.id, center: p.center, radius: p.radius }));
    const result = stepArrow(state.flying, state.ropes, peopleHitboxes, ground, walls, dt);
    state.ropes = result.ropes;
    for (const event of result.events) {
      if (event.type === "rope") {
        const person = state.people.find((p) => p.ropeId === event.ropeId);
        const geom = person && profile.persons.find((g) => g.id === person.id);
        if (person && geom && !person.falling && !person.landed) {
          // Constraint removed: the person keeps whatever linear velocity
          // the swing implied at this instant and free-falls from there.
          person.falling = true;
          const tangent = pendulumTangent(person.pendulum.theta);
          const speed = person.pendulum.omega * geom.pivotRadius;
          person.fallVelocity = { x: tangent.x * speed, y: tangent.y * speed };
        }
      } else if (event.type === "person") {
        const person = state.people.find((p) => p.id === event.personId);
        if (person) {
          person.flinchUntil = now + 150;
          if (!person.falling) {
            person.pendulum = applyImpulse(person.pendulum, incomingVelocity);
          }
          const worldOffset = { x: event.at.x - person.center.x, y: event.at.y - person.center.y };
          person.embeddedArrows.push({
            localOffset: rotateVector(worldOffset, -person.pendulum.theta),
            localAngle: state.flyingAngle - person.pendulum.theta,
          });
        }
      }
    }
    if (result.arrow.embedded) {
      const embeddedInPerson = result.events.some((e) => e.type === "person");
      if (!embeddedInPerson) {
        state.embedded.push({ position: result.arrow.position, angle: state.flyingAngle });
      }
      state.flying = null;
    } else {
      state.flying = result.arrow;
    }
  }

  for (let i = 0; i < state.people.length; i++) {
    const runtime = state.people[i];
    const geom = profile.persons[i];
    if (runtime.falling && !runtime.landed) {
      runtime.fallVelocity.y += PHYSICS.gravity * dt;
      runtime.center.x = clamp(runtime.center.x + runtime.fallVelocity.x * dt, runtime.radius, WORLD_W - runtime.radius);
      runtime.center.y += runtime.fallVelocity.y * dt;
      if (runtime.center.y >= geom.landY) {
        runtime.center.y = geom.landY;
        runtime.landed = true;
      }
    }
  }

  // Win = every person landed. Fail = arrows exhausted AND not everyone
  // landed — but only once the world has actually settled (no arrow still
  // flying, no one still mid-fall), so a shot that cuts the last rope on
  // the last arrow gets to actually land before FAILED can fire.
  if (appPhase === "playing" && state.status === "ready") {
    if (state.people.every((p) => p.landed)) {
      state.status = "won";
      if (currentLevel === 1) {
        runLevelTwoSequence();
      } else {
        showOverlay("AGAIN");
      }
    } else {
      const settled = state.flying === null && state.people.every((p) => p.landed || !p.falling);
      if (state.arrowsRemaining <= 0 && settled) {
        state.status = "failed";
        showOverlay("RESTART", currentLevel === 2);
      }
    }
  }

  draw(now);
  renderHud();
  requestAnimationFrame(update);
}

// --- draw helpers (visual dressing only — none of this reads or writes
// game state beyond what's needed to render it) ---

function roundedRectPath(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Shared arrow silhouette: a filled shaft, a triangular head, and two
 * fletching triangles at the tail — drawn along local +x with the tip at
 * `tipOffset` and the tail at `tipOffset - length`. Callers translate/rotate
 * to the arrow's actual world position and heading before calling this, so
 * every arrow in the game (nocked, flying, embedded in ground or person)
 * shares one consistent illustrated shape instead of four near-duplicated
 * stroked-line blocks. */
function drawArrowGlyph(length: number, tipOffset = 0, fill = "#4a3826", outline = "#2e1c10") {
  const headLen = Math.min(10, length * 0.35);
  const headW = 7;
  const shaftW = 2.6;
  const fletchLen = Math.min(9, length * 0.3);
  const fletchW = 6;
  const tipX = tipOffset;
  const tailX = tipOffset - length;

  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.rect(tailX, -shaftW / 2, length - headLen, shaftW);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX, 0);
  ctx.lineTo(tipX - headLen, -headW / 2);
  ctx.lineTo(tipX - headLen, headW / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Fins flare backward and outward from the shaft's edges, off the
  // centerline — they must never meet at the tail's centerpoint, or the
  // two fins visually fuse into a second arrowhead pointing the other way.
  ctx.beginPath();
  ctx.moveTo(tailX + fletchLen, -shaftW / 2);
  ctx.lineTo(tailX, -fletchW / 2);
  ctx.lineTo(tailX + fletchLen, -fletchW / 2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(tailX + fletchLen, shaftW / 2);
  ctx.lineTo(tailX, fletchW / 2);
  ctx.lineTo(tailX + fletchLen, fletchW / 2);
  ctx.closePath();
  ctx.fill();
}

/** A thin tapered filled quad between two points — used for limbs (arms,
 * legs) so they read as solid illustrated shapes rather than stroked lines. */
function drawTaperedLimb(a: Point, b: Point, widthA: number, widthB: number, fill: string, outline = "#2e1c10") {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(a.x + (nx * widthA) / 2, a.y + (ny * widthA) / 2);
  ctx.lineTo(b.x + (nx * widthB) / 2, b.y + (ny * widthB) / 2);
  ctx.lineTo(b.x - (nx * widthB) / 2, b.y - (ny * widthB) / 2);
  ctx.lineTo(a.x - (nx * widthA) / 2, a.y - (ny * widthA) / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A small filled shoe at the end of a leg, oriented along the leg's own
 * direction so it reads as a foot rather than a bare stick end. */
function drawFoot(pt: Point, dirAngle: number, size: number, fill: string) {
  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(dirAngle);
  ctx.beginPath();
  ctx.ellipse(size * 0.15, 0, size * 0.9, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#2e1c10";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Static background art: a light casual-daytime sky, a soft distant hill
 * silhouette, and a small fixed set of rounded clouds. Purely decorative —
 * deterministic every frame, reads no game state beyond the active profile's
 * world size/ground so it always fills the current composition exactly. */
function drawBackground() {
  const { WORLD_W, ground } = profile;
  const sky = ctx.createLinearGradient(0, 0, 0, ground.y);
  sky.addColorStop(0, "#aee1f2");
  sky.addColorStop(1, "#e8f6ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, ground.y);

  ctx.fillStyle = "#bfe0c8";
  ctx.beginPath();
  ctx.moveTo(0, ground.y);
  ctx.quadraticCurveTo(WORLD_W * 0.2, ground.y - 60, WORLD_W * 0.45, ground.y - 26);
  ctx.quadraticCurveTo(WORLD_W * 0.72, ground.y + 8, WORLD_W, ground.y - 40);
  ctx.lineTo(WORLD_W, ground.y);
  ctx.closePath();
  ctx.fill();

  const clouds: Point[] = [
    { x: WORLD_W * 0.16, y: ground.y * 0.16 },
    { x: WORLD_W * 0.52, y: ground.y * 0.1 },
    { x: WORLD_W * 0.85, y: ground.y * 0.3 },
  ];
  const puffs: Array<[number, number, number]> = [
    [-18, 4, 15],
    [0, -6, 19],
    [18, 4, 15],
    [32, 6, 11],
    [-30, 7, 10],
  ];
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  for (const c of clouds) {
    for (const [dx, dy, r] of puffs) {
      ctx.beginPath();
      ctx.arc(c.x + dx, c.y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The safe landing platform: a grass-topped mound over an earth base,
 * unmistakably a place to land rather than generic floor fill. */
function drawPlatform() {
  const { WORLD_W, WORLD_H, ground } = profile;
  ctx.fillStyle = "#5c4326";
  ctx.fillRect(0, ground.y, WORLD_W, WORLD_H - ground.y);
  ctx.strokeStyle = "rgba(46, 28, 16, 0.25)";
  ctx.lineWidth = 2;
  for (let x = 10; x < WORLD_W; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, ground.y + 14);
    ctx.lineTo(x + 6, ground.y + 30);
    ctx.stroke();
  }

  const grassDepth = 22;
  const bumpAt = (x: number) => ground.y - grassDepth * 0.5 + Math.sin(x * 0.14) * 3;
  ctx.beginPath();
  ctx.moveTo(0, ground.y + 6);
  ctx.lineTo(0, bumpAt(0));
  for (let x = 0; x <= WORLD_W; x += 24) ctx.lineTo(x, bumpAt(x));
  ctx.lineTo(WORLD_W, ground.y + 6);
  ctx.closePath();
  const grassGrad = ctx.createLinearGradient(0, ground.y - grassDepth, 0, ground.y + 6);
  grassGrad.addColorStop(0, "#8fce5c");
  grassGrad.addColorStop(1, "#5b9c3a");
  ctx.fillStyle = grassGrad;
  ctx.fill();
  ctx.strokeStyle = "#3f6e28";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, bumpAt(0));
  for (let x = 0; x <= WORLD_W; x += 24) ctx.lineTo(x, bumpAt(x));
  ctx.stroke();

  for (let x = 6; x < WORLD_W; x += 20) {
    const baseY = bumpAt(x);
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x - 3, baseY - 8);
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + 3, baseY - 7);
    ctx.stroke();
  }
}

/** One person's rescue gallows: filled timber posts (with grain ticks)
 * reaching the platform on either side of their anchor, a diagonal
 * cross-brace, and a crossbeam with beam-end overhangs and bolt joints — a
 * constructed structure, not flat rectangles. Every person gets their own
 * small independent gallows (rather than one wide shared crossbeam) since
 * Level 2's four people sit at very different positions/heights — a single
 * beam spanning all of them wouldn't read as one coherent structure. For
 * Level 1's lone person this reproduces the original single-gallows look
 * exactly (one anchor, one pair of posts). Static background geometry — it
 * never reads from live state. */
function drawPersonGallows(geom: PersonGeometry, groundY: number) {
  const topY = geom.anchor.y;
  const postW = 16;
  const postL = geom.anchor.x - 40;
  const postR = geom.anchor.x + 40;
  const beamH = 20;
  const overhang = 14;

  function post(cx: number) {
    ctx.fillStyle = "#7a4e2c";
    ctx.fillRect(cx - postW / 2, topY, postW, groundY - topY);
    ctx.strokeStyle = "#3a2414";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - postW / 2, topY, postW, groundY - topY);
    ctx.strokeStyle = "rgba(46, 28, 16, 0.35)";
    ctx.lineWidth = 1;
    for (let y = topY + 16; y < groundY; y += 26) {
      ctx.beginPath();
      ctx.moveTo(cx - postW / 2 + 2, y);
      ctx.lineTo(cx + postW / 2 - 2, y);
      ctx.stroke();
    }
  }
  post(postL);
  post(postR);

  ctx.strokeStyle = "#5c3a20";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(postL, topY + 40);
  ctx.lineTo(postR, groundY - 30);
  ctx.stroke();
  ctx.strokeStyle = "#3a2414";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(postL, topY + 40);
  ctx.lineTo(postR, groundY - 30);
  ctx.stroke();

  ctx.fillStyle = "#8a5a2e";
  ctx.fillRect(postL - postW / 2 - overhang, topY - beamH, postR - postL + postW + overhang * 2, beamH);
  ctx.strokeStyle = "#3a2414";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(postL - postW / 2 - overhang, topY - beamH, postR - postL + postW + overhang * 2, beamH);
  for (const cx of [postL, postR]) {
    ctx.beginPath();
    ctx.arc(cx, topY - beamH / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#2e1c10";
    ctx.fill();
  }
}

function drawScaffold() {
  const { ground } = profile;
  for (const geom of profile.persons) {
    drawPersonGallows(geom, ground.y);
  }
}

/** Renders each placed puzzle obstacle (Level 2's blocking panels) as a
 * riveted iron/steel plate — cool gunmetal tones, a specular sheen, rivet
 * lines, and yellow/black hazard edging — deliberately unlike
 * `drawScaffold`'s warm timber, so material alone tells the player which
 * structures are load-bearing wood (the rescue gallows) and which are hard,
 * unyielding puzzle geometry a shot can be blocked by or ricochet off.
 * Static background geometry, one plate per `profile.obstacles` entry. */
function drawObstaclePanel(wall: Wall) {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const thickness = 20;
  const hx = (nx * thickness) / 2;
  const hy = (ny * thickness) / 2;

  ctx.beginPath();
  ctx.moveTo(wall.a.x + hx, wall.a.y + hy);
  ctx.lineTo(wall.b.x + hx, wall.b.y + hy);
  ctx.lineTo(wall.b.x - hx, wall.b.y - hy);
  ctx.lineTo(wall.a.x - hx, wall.a.y - hy);
  ctx.closePath();
  const grad = ctx.createLinearGradient(wall.a.x - hx, wall.a.y - hy, wall.a.x + hx, wall.a.y + hy);
  grad.addColorStop(0, "#9aa4ad");
  grad.addColorStop(0.28, "#5c6670");
  grad.addColorStop(0.5, "#454e57");
  grad.addColorStop(0.72, "#5c6670");
  grad.addColorStop(1, "#2e353c");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#15181b";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // specular sheen band down the middle — reads as polished hard metal
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wall.a.x + hx * 0.3, wall.a.y + hy * 0.3);
  ctx.lineTo(wall.b.x + hx * 0.3, wall.b.y + hy * 0.3);
  ctx.stroke();
  ctx.restore();

  // rivets running down both long edges
  for (let d = 12; d < len; d += 26) {
    const t = d / len;
    const px = wall.a.x + dx * t;
    const py = wall.a.y + dy * t;
    for (const s of [0.72, -0.72]) {
      ctx.beginPath();
      ctx.arc(px + hx * s, py + hy * s, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#1e2226";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + hx * s - 0.6, py + hy * s - 0.6, 1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // yellow/black hazard edging along both long edges — the same visual
  // shorthand as industrial "solid, will deflect" markings, making these
  // ricochet surfaces read as obviously hard at a glance, no text needed
  const stripe = 10;
  const bandOuter = 1.0;
  const bandInner = 0.7;
  for (let d = 0; d < len; d += stripe) {
    const t0 = d / len;
    const t1 = Math.min(len, d + stripe) / len;
    const on = Math.floor(d / stripe) % 2 === 0;
    ctx.fillStyle = on ? "#f4c430" : "#181a1c";
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(wall.a.x + dx * t0 + hx * s * bandOuter, wall.a.y + dy * t0 + hy * s * bandOuter);
      ctx.lineTo(wall.a.x + dx * t1 + hx * s * bandOuter, wall.a.y + dy * t1 + hy * s * bandOuter);
      ctx.lineTo(wall.a.x + dx * t1 + hx * s * bandInner, wall.a.y + dy * t1 + hy * s * bandInner);
      ctx.lineTo(wall.a.x + dx * t0 + hx * s * bandInner, wall.a.y + dy * t0 + hy * s * bandInner);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawObstacles() {
  for (const wall of profile.obstacles) {
    drawObstaclePanel(wall);
  }
}

/** Every person's rope: tied to their own gallows at their own anchor,
 * rendered with a braided texture instead of a bare stroke. A rope's lower
 * end is always its matching `state.ropes[i].b` — the same point the
 * physical/collision model uses — so there is no separate drawn endpoint
 * that could drift out of sync. */
function drawRope() {
  for (const geom of profile.persons) {
    const seg = state.ropes.find((r) => r.id === geom.ropeId);
    if (!seg) continue;
    if (seg.cut) {
      // A short cut stub still hanging from the beam — no longer connects
      // to anything, so it isn't drawn from live pendulum state.
      ctx.strokeStyle = "#8a5a2e";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(geom.anchor.x, geom.anchor.y);
      ctx.lineTo(geom.anchor.x + 4, geom.anchor.y + 28);
      ctx.stroke();
      ctx.lineCap = "butt";
      continue;
    }

    const end = seg.b;
    const dx = end.x - geom.anchor.x;
    const dy = end.y - geom.anchor.y;
    const ropeLen = Math.hypot(dx, dy);
    ctx.strokeStyle = "#8a5a2e";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(geom.anchor.x, geom.anchor.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#6b4423";
    ctx.lineWidth = 1.5;
    for (let d = 6; d < ropeLen; d += 9) {
      const t = d / ropeLen;
      const px = geom.anchor.x + dx * t;
      const py = geom.anchor.y + dy * t;
      const nx = -dy / ropeLen;
      const ny = dx / ropeLen;
      ctx.beginPath();
      ctx.moveTo(px - nx * 3, py - ny * 3);
      ctx.lineTo(px + nx * 3, py + ny * 3);
      ctx.stroke();
    }
  }
}

/** A recognisable hanging figure — filled torso, tapered limbs, footed
 * legs, and a head with a layered hair shape — built around the same
 * center/radius the physics hitbox uses; only the drawing gets richer, the
 * hitbox geometry is untouched. Every local offset is rotated by the live
 * pendulum angle before being added to the center, so the whole body
 * swings/falls as one rigid figure. Called once per person. */
function drawPerson(now: number, geom: PersonGeometry, runtime: PersonRuntime) {
  const p = runtime.center;
  const r = runtime.radius;
  const theta = runtime.pendulum.theta;
  const at = (local: Point): Point => {
    const w = rotateVector(local, theta);
    return { x: p.x + w.x, y: p.y + w.y };
  };
  const flinching = now < runtime.flinchUntil;
  const skin = flinching ? "#e88a6a" : "#e8c07a";
  const vest = flinching ? "#c94f2f" : "#d97b3f";
  const vestLight = flinching ? "#e8785a" : "#f0a25e";
  const trousers = "#4a3826";
  const hair = "#3a2414";

  const tie = at({ x: 0, y: -geom.tieOffset });
  const tieL = tie;
  const tieR = tie;

  const vr = r * PERSON_VISUAL_SCALE;
  const shoulderL = at({ x: -vr * 0.28, y: -vr * 0.48 });
  const shoulderR = at({ x: vr * 0.28, y: -vr * 0.48 });
  const hipL = at({ x: -vr * 0.18, y: vr * 0.58 });
  const footL = at({ x: -vr * 0.42, y: vr * 1.35 });
  const hipR = at({ x: vr * 0.18, y: vr * 0.58 });
  const footR = at({ x: vr * 0.42, y: vr * 1.35 });

  // legs (drawn first, so the torso overlaps their tops)
  drawTaperedLimb(hipL, footL, vr * 0.34, vr * 0.2, trousers);
  drawTaperedLimb(hipR, footR, vr * 0.34, vr * 0.2, trousers);
  drawFoot(footL, Math.atan2(footL.y - hipL.y, footL.x - hipL.x), vr * 0.4, "#241206");
  drawFoot(footR, Math.atan2(footR.y - hipR.y, footR.x - hipR.x), vr * 0.4, "#241206");

  // arms bound up to the rope
  drawTaperedLimb(tieL, shoulderL, vr * 0.16, vr * 0.24, skin);
  drawTaperedLimb(tieR, shoulderR, vr * 0.16, vr * 0.24, skin);

  // torso — a rounded, filled body drawn in a rotated local frame (fill
  // paths need the same translate/rotate treatment fillRect used to need),
  // with a collar/hem detail and a soft highlight for volume.
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(theta);
  const torsoW = vr * 0.95;
  const torsoH = vr * 1.2;
  const torsoX = -torsoW / 2;
  const torsoY = -vr * 0.52;
  roundedRectPath(torsoX, torsoY, torsoW, torsoH, vr * 0.24);
  const torsoGrad = ctx.createLinearGradient(torsoX, torsoY, torsoX + torsoW, torsoY + torsoH);
  torsoGrad.addColorStop(0, vestLight);
  torsoGrad.addColorStop(1, vest);
  ctx.fillStyle = torsoGrad;
  ctx.fill();
  ctx.strokeStyle = "#2e1c10";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = "rgba(46, 28, 16, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(torsoX + torsoW * 0.16, torsoY + torsoH * 0.2);
  ctx.lineTo(torsoX + torsoW * 0.84, torsoY + torsoH * 0.2);
  ctx.moveTo(torsoX + torsoW * 0.1, torsoY + torsoH * 0.82);
  ctx.lineTo(torsoX + torsoW * 0.9, torsoY + torsoH * 0.82);
  ctx.stroke();
  const torsoHighlight = ctx.createRadialGradient(
    torsoX + torsoW * 0.35,
    torsoY + torsoH * 0.28,
    1,
    torsoX + torsoW * 0.35,
    torsoY + torsoH * 0.28,
    torsoW * 0.7,
  );
  torsoHighlight.addColorStop(0, "rgba(255, 255, 255, 0.3)");
  torsoHighlight.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = torsoHighlight;
  roundedRectPath(torsoX, torsoY, torsoW, torsoH, vr * 0.24);
  ctx.fill();
  ctx.restore();

  // head + layered hair/fringe
  const head = at({ x: 0, y: -vr * 0.9 });
  const headR = vr * 0.42;
  const headGrad = ctx.createRadialGradient(
    head.x - headR * 0.3,
    head.y - headR * 0.3,
    headR * 0.1,
    head.x,
    head.y,
    headR,
  );
  headGrad.addColorStop(0, "#f2d9a8");
  headGrad.addColorStop(1, skin);
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fillStyle = headGrad;
  ctx.fill();
  ctx.strokeStyle = "#2e1c10";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(theta);
  ctx.beginPath();
  ctx.moveTo(-headR * 0.95, -headR * 0.1);
  ctx.quadraticCurveTo(-headR * 0.6, -headR * 1.15, 0, -headR * 1.05);
  ctx.quadraticCurveTo(headR * 0.6, -headR * 1.15, headR * 0.95, -headR * 0.1);
  ctx.quadraticCurveTo(headR * 0.5, -headR * 0.5, 0, -headR * 0.45);
  ctx.quadraticCurveTo(-headR * 0.5, -headR * 0.5, -headR * 0.95, -headR * 0.1);
  ctx.closePath();
  ctx.fillStyle = hair;
  ctx.fill();
  ctx.strokeStyle = "#1c1008";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // arrows embedded in the body — move/rotate rigidly with it
  for (const a of runtime.embeddedArrows) {
    const world = at(a.localOffset);
    ctx.save();
    ctx.translate(world.x, world.y);
    ctx.rotate(theta + a.localAngle);
    drawArrowGlyph(20, 6, "#3d2b1a");
    ctx.restore();
  }
}

/** The bow's fixed rig: a filled timber post reaching the platform plus
 * angled braces, matching the scaffold's constructed-timber look. String/
 * nock/preview logic lives in draw() below and is untouched. */
function drawBowStand() {
  const { ANCHOR, ground } = profile;
  const postW = 14;
  const postTopY = ANCHOR.y + 34;
  ctx.fillStyle = "#7a4e2c";
  ctx.fillRect(ANCHOR.x - postW / 2, postTopY, postW, ground.y - postTopY);
  ctx.strokeStyle = "#3a2414";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ANCHOR.x - postW / 2, postTopY, postW, ground.y - postTopY);
  ctx.strokeStyle = "rgba(46, 28, 16, 0.35)";
  ctx.lineWidth = 1;
  for (let y = postTopY + 14; y < ground.y; y += 22) {
    ctx.beginPath();
    ctx.moveTo(ANCHOR.x - postW / 2 + 2, y);
    ctx.lineTo(ANCHOR.x + postW / 2 - 2, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#6b4423";
  ctx.strokeStyle = "#3a2414";
  ctx.lineWidth = 1;
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.translate(ANCHOR.x, ground.y);
    ctx.rotate(dir * 0.5);
    ctx.fillRect(-4, -46, 8, 46);
    ctx.strokeRect(-4, -46, 8, 46);
    ctx.restore();
  }
}

// --- draw ---
function draw(now: number) {
  const { ANCHOR, ground } = profile;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  drawBackground();
  drawPlatform();
  drawObstacles();
  drawScaffold();
  drawBowStand();
  drawRope();
  for (let i = 0; i < profile.persons.length; i++) {
    drawPerson(now, profile.persons[i], state.people[i]);
  }

  // ground-embedded arrows (arrows embedded in a person are drawn inside
  // drawPerson, since they must move/rotate with that body)
  for (const a of state.embedded) {
    ctx.save();
    ctx.translate(a.position.x, a.position.y);
    ctx.rotate(a.angle);
    drawArrowGlyph(20, 6);
    ctx.restore();
  }

  // trajectory preview while aiming
  if (state.dragging) {
    const v = launchVelocity(state.dragVector);
    ctx.fillStyle = "rgba(90, 65, 40, 0.4)";
    for (let t = 0.05; t <= 0.6; t += 0.05) {
      const p = previewPoint(ANCHOR, v, t);
      if (p.y > ground.y) break;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // bow + string — one continuous laminated-wood limb (curving from tip to
  // tip through the riser, the same proven two-curve technique as before,
  // just with a deeper belly, a lighter/darker wood-grain gradient, and a
  // dark tip cap with a visible nock groove at each end) plus a twisted
  // double-strand string with a serving wrap at the nock — a constructed
  // weapon rather than a lens-shaped diagram. The belly deepens and the
  // nocked arrow's glow shifts hotter as the draw deepens, so pulling back
  // gives direct, continuous feedback on shot power without any HUD text.
  const pull = state.dragging ? state.dragVector : { x: 0, y: 0 };
  const pullFrac = state.dragging ? Math.min(1, Math.hypot(pull.x, pull.y) / PHYSICS.maxDrawDistance) : 0;
  const idlePulse = state.dragging || state.flying ? 0 : 0.5 + 0.5 * Math.sin(now / 500);
  ctx.save();
  ctx.translate(ANCHOR.x, ANCHOR.y);

  const tipAngle = Math.PI * 0.32;
  const tipR = 78;
  const tipTop = { x: tipR * Math.cos(-tipAngle), y: tipR * Math.sin(-tipAngle) };
  const tipBottom = { x: tipR * Math.cos(tipAngle), y: tipR * Math.sin(tipAngle) };
  const outerBulge = 96 + pullFrac * 18;
  const innerBulge = 52 + pullFrac * 8;

  ctx.beginPath();
  ctx.moveTo(tipTop.x, tipTop.y);
  ctx.quadraticCurveTo(outerBulge, 0, tipBottom.x, tipBottom.y);
  ctx.quadraticCurveTo(innerBulge, 0, tipTop.x, tipTop.y);
  ctx.closePath();
  const bowGrad = ctx.createLinearGradient(innerBulge, -tipR, outerBulge, tipR);
  bowGrad.addColorStop(0, "#e8c087");
  bowGrad.addColorStop(0.35, "#a4703c");
  bowGrad.addColorStop(0.65, "#8a5a2e");
  bowGrad.addColorStop(1, "#5c3a20");
  ctx.fillStyle = bowGrad;
  ctx.fill();
  ctx.strokeStyle = "#2a1608";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // gloss line along the string-facing (inner) edge, plus a couple of
  // fainter lamination lines echoing the same curve, for a polished,
  // layered-wood look instead of a flat fill
  ctx.strokeStyle = "rgba(255, 240, 210, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tipTop.x, tipTop.y);
  ctx.quadraticCurveTo(outerBulge - 6, 0, tipBottom.x, tipBottom.y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(46, 28, 16, 0.3)";
  ctx.lineWidth = 1;
  for (const k of [0.3, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(tipTop.x, tipTop.y);
    ctx.quadraticCurveTo(innerBulge + (outerBulge - innerBulge) * k, 0, tipBottom.x, tipBottom.y);
    ctx.stroke();
  }

  // dark tip caps with a visible nock groove, where the string attaches —
  // reads as a deliberate recurve tip rather than the limb just tapering off
  for (const [tip, dir] of [
    [tipTop, Math.atan2(tipTop.y, tipTop.x)],
    [tipBottom, Math.atan2(tipBottom.y, tipBottom.x)],
  ] as const) {
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(dir);
    ctx.fillStyle = "#241a12";
    ctx.beginPath();
    ctx.ellipse(-2, 0, 7, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9c2b6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2, -2.8);
    ctx.lineTo(-2, 2.8);
    ctx.stroke();
    ctx.restore();
  }

  // riser / grip — wrapped-leather handle bridging the two limbs, with a
  // small wood shelf where the arrow rests
  ctx.fillStyle = "#3a2414";
  ctx.fillRect(-9, -18, 20, 36);
  ctx.strokeStyle = "#1c0f06";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-9, -18, 20, 36);
  ctx.strokeStyle = "rgba(200, 170, 120, 0.5)";
  ctx.lineWidth = 1;
  for (let y = -12; y <= 12; y += 6) {
    ctx.beginPath();
    ctx.moveTo(-9, y);
    ctx.lineTo(11, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#5c3a20";
  ctx.fillRect(2, -4, 14, 4);
  ctx.strokeStyle = "#1c0f06";
  ctx.lineWidth = 1;
  ctx.strokeRect(2, -4, 14, 4);

  // string — a twisted double strand plus a thicker center serving wrap at
  // the nock, brightening slightly as tension builds
  const nock = { x: pull.x, y: pull.y };
  const tension = 0.55 + pullFrac * 0.45;
  ctx.strokeStyle = `rgba(232, 220, 195, ${tension})`;
  ctx.lineWidth = 1.6;
  for (const off of [-0.6, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(tipTop.x, tipTop.y + off);
    ctx.lineTo(nock.x, nock.y + off);
    ctx.lineTo(tipBottom.x, tipBottom.y + off);
    ctx.stroke();
  }
  ctx.strokeStyle = "#2a1608";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(nock.x - 6, nock.y);
  ctx.lineTo(nock.x + 6, nock.y);
  ctx.stroke();

  // nocked arrow (idle glow when nothing has happened yet, so the eye
  // lands here first; the glow shifts from a soft idle amber to a hotter
  // orange-red as the draw deepens, making shot power legible with no text)
  if (!state.flying) {
    const glow = 10 + idlePulse * 12 + pullFrac * 10;
    ctx.save();
    ctx.shadowColor =
      pullFrac > 0.01
        ? `rgba(255, ${Math.round(180 - pullFrac * 90)}, 60, 0.95)`
        : "rgba(255, 210, 110, 0.95)";
    ctx.shadowBlur = glow;
    const dir = state.dragging ? Math.atan2(-nock.y, -nock.x) : 0;
    ctx.translate(nock.x, nock.y);
    ctx.rotate(dir);
    drawArrowGlyph(34, 34);
    ctx.restore();
  }
  ctx.restore();

  // flying arrow
  if (state.flying) {
    ctx.save();
    ctx.translate(state.flying.position.x, state.flying.position.y);
    ctx.rotate(state.flyingAngle);
    drawArrowGlyph(32, 16);
    ctx.restore();
  }

  ctx.restore();
}

requestAnimationFrame((t) => {
  lastT = t;
  requestAnimationFrame(update);
});
