# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so the deployed head is the only place a broken one shows up.

## The checks

`pnpm check` runs them, and `pnpm check:evidence` is the extra gate before you
ship. CI runs the same plus links, secrets and the deploy.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## Working conventions

- After visual or content changes, verify the rendered site and rerun
  `pnpm check`, `pnpm build`, and
  `pnpm dlx linkinator ./dist --silent --skip "^https?://(?!localhost|127)"`
  before committing.

## C5 current work — session handoff (L1 physical hanging-person system done, not yet committed)

This section is a practical continuation record, not a project plan. Read it
before touching this repo again; it replaces needing the prior conversation.

### The game

An archery rescue game: a person hangs from a rope in a fixed side-view scene.
The player drags the bow/string to aim (pointer down near the bow, drag,
release to fire) and cuts the rope to rescue them. No tutorial text of any
kind — the opening screen must make "drag to aim, release to shoot" obvious
through affordance and feedback alone (idle-pulsing nocked arrow, cursor
states, trajectory preview while dragging).

Intended visual composition (agreed, **not yet built** — see "not yet
approved" below): a fixed, non-scrolling puzzle-screen view per level, wooden
bow/structure materials, a recognisable hanging person (not an abstract
blob), a visually obvious safe platform/ground the person should land on, and
an obvious bow silhouette. Reference direction: wooden-structure archery-
rescue aesthetic, side-view, fixed composition per level (not a side-scroller).

### Agreed gameplay rules

- **5-arrow budget per level.** Every release consumes one arrow, whether it
  hits anything or not. Hitting the person is *not* an immediate loss — the
  arrow embeds and applies a physical impulse (see the pendulum section
  below), but the rescue isn't failed by a hit itself. The level is only
  lost when all 5 arrows are spent and the rescue isn't complete.
- **On failure**: explicit FAILED state, exactly one option (RESTART). No
  instant auto-retry, no level select, no other options. RESTART resets to 5
  fresh arrows, clears embedded arrows, restores the rope and person/obstacles
  to their initial positions.
- **On success**: explicit WON state, one option (AGAIN), same reset
  semantics as RESTART.
- **Rope cutting**: an arrow crossing an intact rope cuts it exactly once.
  An already-cut rope never re-triggers, even if re-crossed later in the same
  shot (e.g. after a ricochet).
- **Person hit**: physically real, not cosmetic. The arrow embeds at the
  actual collision point and stops (same as a ground hit) — it does **not**
  continue past the person. The hit also applies an impulse to the person's
  pendulum motion (see below). This supersedes an earlier "flinch only, arrow
  keeps flying" rule from Phase 1; see the physics-overhaul section for why.
- **Chronological multi-collision resolution**: within one shot, the arrow
  resolves collisions in order along its path — apply the earliest collision,
  continue from that point with remaining motion, repeat. A single shot may
  legitimately cut a rope, flinch the person, and hit a wall in sequence.
- **Embedding**: a missed arrow eventually embeds in the ground or a solid
  surface rather than flying forever, and stays visible until the level is
  restarted or completed — that visible accumulation is part of the feedback
  language (deliberately, so the player reads consequences without text).
- **Ricochet (not yet implemented)**: reserved for when L3 introduces solid
  walls/obstacles. `CollisionEvent` already has an unused `"wall"` variant and
  `PHYSICS.bounceRestitution` / `PHYSICS.maxBounces` are reserved constants so
  adding it won't reshape the architecture. No tutorial text for it either —
  the player discovers ricochet by seeing an arrow bounce.
- **Physics must never change between levels.** Difficulty comes only from
  geometry (rope/obstacle/ground layout), never from retuning gravity, draw
  power, or bounce behaviour per level. `PHYSICS` in `game/physics.ts` is the
  single source of truth, imported everywhere, never overridden.

### Planned level progression (design agreed, only L1 built)

1. **L1** (built, see below) — one exposed static rope; teaches drag/aim/
   release through play alone.
2. **L2** — two ropes supporting one person, offset (not collinear) — teaches
   "two controlled shots," not simultaneous multi-cuts.
3. **L3** — introduces a wall/obstacle so the player discovers ricochet by
   seeing it happen.
4. **L4** — requires a deliberate ricochet to reach a partially hidden rope.
5. **L5** — combines multiple ropes + obstacles under the same 5-arrow limit;
   a skilled one-arrow multi-cut becomes an optional efficiency reward here
   (not required, and not taught explicitly).
6. **Final** — adds a slowly moving/swinging rescue target so timing joins
   precision and ricochet skill.

### What Phase 0 / Phase 1 currently implement

- **Phase 0** — `game/physics.ts`: pure, DOM-free physics/collision core.
  `PHYSICS` constants (gravity, drawPower, maxDrawDistance, arrowRadius,
  embedSpeedThreshold, and reserved bounceRestitution/maxBounces for later
  ricochet — **untouched across every later session, including the physics
  overhaul below**), `launchVelocity`, `previewPoint`, `applyArrowToRope`
  (exactly-once cut), `applyArrowToPerson` (a hit test only — the caller
  decides whether it stops the arrow), `stepArrow` (the chronological
  multi-hit resolver per tick, including ground *and* person embedding via
  a dedicated `groundIntersection` — see bugs below). Also, since the
  physics-overhaul session: a separate `PENDULUM` constant, `PendulumState`,
  `rotateVector`/`pendulumDirection`/`pendulumTangent`, `stepPendulum`,
  `applyImpulse` — see "Physical hanging-person system" below.
- **Phase 1** — `index.html` / `styles.css` / `main.ts`: the actual playable
  L1. Canvas-rendered bow/rope/person/ground, pointer-based drag-aim-release-
  fire wired to the physics engine, icon-only arrow-pip HUD (no "Arrows: N"
  text), shared FAILED/WIN overlay with a single RESTART/AGAIN button, and a
  fixed 960×540 logical world scaled + letterboxed to fit any real viewport so
  gameplay/physics is identical regardless of screen size (only visual
  scale/offset differs).

### Tests

- `spec/rope-cutting.test.ts` — **the official focused spec test**, chosen to
  certify the one central rescue rule: an arrow intersecting an intact rope
  cuts it exactly once (cuts once, ignores an uncrossed rope, never re-cuts
  an already-cut rope even on a re-crossing path, stays cut across a sequence
  of hits).
- `game/physics.test.ts` — engineering sensor tests (not the official spec
  citation): launch velocity direction/scaling/clamping, ground embedding,
  no-op on an already-embedded arrow, rope-cut-then-ground-embed in one step,
  person-hit-embeds-and-stops (rewritten during the physics overhaul — see
  below, this asserts the *opposite* of the original "flinch, arrow keeps
  flying" test on purpose), plus a pendulum settle test and an
  impulse-direction test.
- `pnpm check` is currently green: 5 test files, 30 tests, typecheck clean,
  build succeeds.

### Physics constants (current, tuned once, do not retune per level)

In `game/physics.ts`: `gravity: 900`, `drawPower: 8`, `maxDrawDistance: 140`
(max launch speed 1120 px/s), `arrowRadius: 4`, `embedSpeedThreshold: 40`,
`bounceRestitution: 0.55` (reserved), `maxBounces: 3` (reserved). At full
draw from the L1 anchor (150,420) to the rope at x=700, roughly 32°–49°
elevation cuts the rope cleanly, ~30°–31° clips the person instead, and 50°+
overshoots and wastes the arrow — a real difficulty curve from geometry
alone, not from hidden retuning.

### Browser bugs found and fixed this session

1. **Overlay visible on cold load.** `.overlay { display: flex }` in
   `styles.css` beat the browser's default `[hidden] { display: none }` at
   equal specificity, so the RESTART button covered the whole screen before
   any input. Fixed with `.overlay:not([hidden]) { display: flex }`.
2. **Every arrow died on frame one (critical).** The ground plane was
   modelled as a segment from `{x: -Infinity}` to `{x: Infinity}` fed through
   the generic segment-intersection formula. That formula computes the
   ground segment's own `dy` (exactly 0) times `±Infinity`, which is `NaN` in
   IEEE 754 — and `NaN` silently passes every `t < 0 || t > 1` range guard
   because comparisons against `NaN` are always `false`. So "ground" always
   won as the earliest collision on the very first physics step, regardless
   of trajectory — no arrow ever actually flew. Fixed with a dedicated
   `groundIntersection` helper that solves the horizontal-plane crossing
   directly instead of reusing the generic solver with infinite sentinels.
   (A separate, now-moot finding: before this fix was even found, the original
   physics constants — gravity 1400, drawPower 6 — made the rope
   geometrically unreachable at any angle. That was fixed by retuning to the
   current constants above, verified by a numeric reachability search before
   ever touching the browser.)

### Browser verification results (Playwright, against built `dist/`)

Verified at both marking viewports, 1920×1080 and 390×844, after both bugs
above were fixed:
- Cold load: overlay correctly hidden, bow idle-pulsing, rope/person static —
  identical at both sizes.
- A well-aimed shot (full draw, ~40° elevation) cuts the rope, person falls,
  WON overlay ("AGAIN") appears; clicking it fully resets rope/person/arrows.
- Five deliberately weak/short shots exhaust all 5 arrows without reaching
  the rope; FAILED overlay ("RESTART") appears; clicking it fully resets.
- Physics behaved identically at both viewport sizes, as designed.

### Mobile letterboxing: improved, not eliminated (understand why before touching again)

The world grew from 960×540 (16:9) to **960×640**, via `Y_SHIFT = 50` in
`main.ts` — the whole scene (anchor/rope/beam/ground/person) is *translated*
down inside the taller world, not rescaled, so every distance/angle between
them is byte-for-byte what the handoff's tested elevation bands (32°–49°
cuts, ~30–31° clips, 50°+ overshoots) already verified. No reachability
re-check was needed as a result — a translation preserves all relative
geometry.

Worked out the actual math this session, which matters for anyone tempted to
"just make the world taller": with `WORLD_W` fixed at 960 (needed to keep the
1920×1080 fit exact), portrait fill is `390 / (WORLD_W / WORLD_H)`, i.e. it
scales *directly* with `WORLD_H`, but **any** increase big enough to
meaningfully close the portrait gap (e.g. reaching ~50% fill needs
`WORLD_H` ≈ 1039) introduces comparably large new letterbox bars on
1920×1080 (≈48% at that size) — because 1920×1080 (ratio 1.78) and 390×844
(ratio 0.46) are just too far apart for one fixed rectangle to fill both.
960×640 was chosen as a bounded trade: portrait empty-space fraction goes
from ~74% to ~65% (not "half", despite what the previous plan draft assumed
— corrected during implementation), landscape stays exactly full (960:640
still fits 1920×1080 with `scale = min(2, 1.6875) = 1.6875`, no landscape
letterbox at all since height is the binding dimension either way at that
size). **Do not chase eliminating the letterbox by resizing the world
further** without accepting a matching landscape cost — that's a hard
tradeoff, not a bug to fix away.

What *did* get fixed outright: `HOTSPOT_RADIUS` 70 → 110 world units, so the
bow's touch target is a comfortable ~44.7 CSS px at the 390×844 scale
(`0.406×`), up from ~28px — this was the concrete "hard to aim on a phone"
complaint, and it's now resolved independent of the letterbox trade above.
The remaining letterbox bars are also no longer flat black: `draw()` now
paints a full-canvas sky-gradient wash before the world transform, so the
bars read as an intentional frame around the scene rather than dead/broken
space (verified visually, see below).

### Visual design: built, not yet looked at by a human

`draw()` in `main.ts` was rebuilt this session per the agreed composition:
wooden bow on a fixed post-and-brace stand (gradient-toned limb, riser
block), a wooden crossbeam anchoring the rope with a braided-strand texture
(hatch marks along the strand, cut stub redrawn shorter when `rope.cut`), a
plank-surfaced platform (distinct lighter wood strip + seam lines over the
support-mass fill) as the obvious safe landing zone, and a person built from
head/vest-torso/bound-arms/legs primitives (orange vest as a visual "rescue
target" cue) instead of the old circle+rectangle blob. All of this is purely
in the drawing routine — `state.person.center`/`radius`, `ANCHOR`,
`ROPE_TOP/BOTTOM`, `ground.y` stay the single source of truth physics reads,
so none of the physics/hitbox/contract-test behavior changed.

Verified this session (temporary Playwright script, added then removed —
`playwright` was `pnpm add -D`'d, used, then `pnpm remove`'d; `package.json`/
`pnpm-lock.yaml` are back to their pre-session state, nothing added
permanently) against built `dist/`, served via `vite preview`:
- 1920×1080 and 390×844 cold load: overlay hidden, 0 console errors, new
  visuals render as designed at both sizes (screenshotted and eyeballed).
- A full-draw ~40° shot cuts the rope, person falls, WON/"AGAIN" appears.
- Five short/weak shots exhaust arrows without reaching the rope,
  FAILED/"RESTART" appears.

**Still true**: this has been machine-verified for function and screenshotted
by the agent, but **a human has not looked at it yet**. Don't treat the
current look as final/approved — it's ready for the user to actually play and
eyeball before any further visual iteration or before L2 starts.

### Physical hanging-person system (session after the visual pass)

After playing the visual pass, the user found the *model* wrong, not just the
look: the rope's lower endpoint and the person's position were two
independent fixed constants with nothing tying them together (a visible
gap), the person's only motion was a decorative sine-wave sway applied to
the *drawn* rope only (never touching `state.person.center` or any collision
geometry), an arrow-person hit was cosmetic (arrow kept flying through the
person, no embedding, no consequence), and a rope cut produced a vertical-
only kinematic drop disconnected from whatever swing was happening.

Fixed architecturally, not cosmetically, in `game/physics.ts` + `main.ts`:

- **Single source of truth**: the person is a damped pendulum,
  `PendulumState {theta, omega}`, `theta` measured from straight down at a
  fixed anchor (`ROPE_TOP`). Both the rope's rendered/collision lower
  endpoint and the person's center are derived, every frame, as two points
  along the *same* ray from that anchor (`pendulumDirection(theta)`), at
  different radii (`ROPE_LENGTH`, `PIVOT_RADIUS`). This makes the rope and
  the person geometrically incapable of desyncing — the gap is fixed by
  construction, not by tuning a drawn line length.
- **Real pendulum physics**: `stepPendulum` integrates a damped simple
  pendulum each frame (gravity restoring torque + damping, semi-implicit
  Euler) — no scripted sway. `applyImpulse` projects an arrow's incoming
  velocity onto the pendulum's tangent direction to produce an angular
  velocity kick, so a hit from one side swings the person away from it (unit-
  tested and browser-verified).
- **Arrow-person collision now stops the arrow.** In `stepArrow`, the person
  candidate's `stop` flag changed from `false` to `true` — same treatment as
  ground. The arrow embeds at the true hit point instead of passing through.
  This is the one deliberate, explained test-behavior change:
  `game/physics.test.ts`'s old "flinches the person without stopping" test
  now asserts the opposite (embeds and stops). `spec/rope-cutting.test.ts`
  (the official graded citation) is untouched and unaffected — it drives
  `applyArrowToRope` directly with literal fixed points, independent of this.
- **Embedded-in-person arrows** are stored as `{localOffset, localAngle}` in
  the person's own unrotated body frame, so at render time they're
  reconstructed via the live `theta` — this makes them move and rotate
  rigidly with the swinging/falling body, and supports multiple simultaneous
  embedded arrows with no special-casing.
- **Falling after a rope cut** is now real 2D projectile motion: at the cut
  instant, the pendulum's tangential linear velocity seeds a genuine fall
  velocity, integrated under `PHYSICS.gravity` (reused, not modified) — a
  person cut mid-swing arcs the way they were actually moving, rather than
  dropping straight down. `theta` freezes at cut time (no further spin during
  the fall). Landing on the platform still resolves WON exactly as before.
- `PHYSICS` itself (gravity, drawPower, maxDrawDistance, arrowRadius,
  embedSpeedThreshold, bounceRestitution, maxBounces) and the 5-arrow rule
  were **not touched**, per explicit instruction — the new `PENDULUM` tuning
  (damping, impulseScale) lives in its own separate constant.

No in-game debug/hitbox rectangles exist anywhere in the code (confirmed by
grep across `main.ts`/`styles.css`/`game/physics.ts`) — the red boxes in the
user's bug-report screenshot were annotations added on top of the image, not
a rendered overlay to remove.

Browser-verified (temporary Playwright script against built `dist/`, added
then fully removed — `package.json`/`pnpm-lock.yaml` confirmed back to their
exact pre-session state via `git diff --stat`, zero diff):
- The rope visibly stays connected to the person, with no gap, throughout an
  undisturbed swing and while resettling after a hit.
- Two separate arrow hits from below/left both produced a visible swing away
  from the hit side, each arrow visibly embedding and remaining attached,
  rotating with the body as it kept swinging.
- After the pendulum resettled, a rope-cutting shot released the constraint;
  the person fell in a genuine arc (visibly displaced sideways from the
  beam, not a straight drop), both embedded arrows still visibly attached
  throughout the fall.
- Landing on the platform produced the WON overlay with the "AGAIN" button,
  confirming the rescue-completion path still works end to end.

### Git / commit state (as of end of this session)

- Last two commits: `a7c72bd` harness carry-forward, `407c490` spec: no-
  tutorial contract test. Both already committed.
- **Uncommitted in the working tree right now**: `game/` (new — physics.ts,
  physics.test.ts), `spec/rope-cutting.test.ts` (new), and modified
  `CLAUDE.md`, `index.html`, `main.ts`, `styles.css`, `tsconfig.json` — all of
  Phase 0, Phase 1, the visual/mobile pass, and this session's physical
  hanging-person rework. Nothing has been committed across any of these
  sessions yet. `pnpm check` is green on this uncommitted tree (5 files, 30
  tests, typecheck clean, build succeeds), and
  `pnpm dlx linkinator ./dist --silent --skip "^https?://(?!localhost|127)"`
  is clean.
- Repo remains private; not pushed.

### Exact next task

Get a human to actually open the built site and play L1 before anything else
happens — specifically to sign off on the *physics* (does the pendulum swing
feel right, do hits feel consequential, does the fall read as a real drop),
not just the visuals (already flagged as unreviewed by a human in the
section above). Only after that sign-off should L1 see further iteration
(visual or physical) or should L2 begin. **Do not start L2, ricochet, or any
further level before that approval.**

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.
