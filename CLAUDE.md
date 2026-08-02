# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A soccer/futsal session diagramming tool: place players and equipment on a
pitch, join them with the four standard coaching line types, print or export the
result. Vite + React 18 + TypeScript, no runtime dependencies beyond
`react`/`react-dom`, no network calls, no server, no accounts.

Split out of the private `C-License` visualizer (`../C-License`) and **public by
design**. That was checked rather than assumed: the diagramming standards sheet
carries **zero** confidentiality stamps, where the C-License decks carry 9–39
each. Nothing from those decks is in this repo — no PDFs (`*.pdf` is
gitignored), no U.S. Soccer wording. The notation is described in this app's own
words. Keep it that way: **do not paste C-License slide text into this repo**,
and do not add the PDFs even temporarily.

## Commands

```bash
npm install
npm run dev        # http://127.0.0.1:5174 — host is pinned; never add --host
npm run verify     # tsc --noEmit && vitest run   <- run this before committing
npm run build
npm run deploy     # build + wrangler pages deploy
```

Run one test file with `npx vitest run tests/diagram.test.ts`, one case with
`npx vitest run -t "name"`.

**Deploy with `npm run deploy`, never bare `wrangler pages deploy`.** The Pages
project's production branch is `unused-production`, so the script passes
`--branch=unused-production`. Without it wrangler infers `main` from git and the
upload lands as a **preview** — it succeeds, prints a URL, and production keeps
serving the old bundle. Verify afterwards by comparing hashes rather than
trusting the success message:

```bash
curl -s https://soccer-diagrammer.pages.dev/ | grep -o 'assets/index-[^"]*\.js'
ls dist/assets/*.js
```

## Architecture

Four files carry the app; everything else is data or types.

| File | Holds |
|---|---|
| `src/lib/geometry.ts` | All the maths. Pure, dependency-free, and the only place worth unit-testing. |
| `src/components/Canvas.tsx` | Pointer handling: one `<svg>`, one set of handlers, a `Drag` union for the seven gestures. |
| `src/components/Tokens.tsx` | Every mark that appears on the surface — players, lines, equipment, labels — as inline SVG. |
| `src/App.tsx` | State, undo/redo, keyboard, palettes. |

`src/components/Surface.tsx` draws every pitch and court from one parametric
component over `{sport, crop, facing, style}`; `src/lib/surfaceBox.ts` derives
its box. Markings come from real dimensions (68 × 105 m soccer; 20 × 40 m futsal
per FIFA Futsal Law 1), so a penalty area is the same penalty area in every
variant. Hand-drawing the variants separately is how markings drift apart.

### Coordinates

Shapes are stored in the surface's own box, not pixels — so a diagram drawn on a
laptop renders identically on a phone, in print and in an export. The element
fills its column and the drawing is letterboxed inside it by
`preserveAspectRatio`, which means **the element's bounding rect is not the
drawing's box**. Always map pointers with `getScreenCTM()` (`toSurface`), never
by scaling the rect.

`preserveAspectRatio` positions and scales but **does not clip**. The pitch is
always drawn full length, so a cropped surface needs the explicit
`<clipPath id="surface-clip">` or the rest of the pitch bleeds into the spare
element area — "Box" showed the halfway line before that existed.

## Invariants worth keeping

These each cost a bug to learn.

**One geometry for drawing, hit-testing and preview.** `strokeGeometry()` is
what the renderer draws, what `hitTest` measures against, and what the drag
preview shows. When they were separate, what you could click was not what you
could see.

**Trim along the curve, never the chord.** A line anchored to a player stops
short of it by `PLAYER_RADIUS * scale + TOKEN_GAP`, found by walking the curve
(coarse scan, then bisection) and taking that point's tangent for the arrow head.
Trimming the chord and re-bowing the result leaves a curved arrow's head beside
the player aiming past it, because a chord and its curve arrive from different
directions.

**The hold-off is a ring of clear air, so it scales with the player.** A fixed
distance leaves a small token marooned at the end of a gap. It also has to keep
the head outside the player's own hit radius, or the head can never be clicked —
the token under it wins every time.

**Rotate and scale work from a snapshot** taken when the drag starts, not from
the previous frame. Applying each move to the last result compounds rounding and
drags every clamped shape further every frame.

**A group is one object.** One frame around the whole selection, handles that act
on all of it, rotation about the group's centre (positions orbit the pivot), and
a draggable interior. `groupRot` lives in the component, not on the shapes: it
belongs to the selection, and a new selection starts square.

**Nothing may end up unreachable.** The pointer is clamped to the box, so a shape
outside it cannot be seen, clicked, marquee'd or deleted — but still exports and
prints. `confineToBox()` runs on every surface change and reports what it moved.

**Every tool disarms after use.** A tool that stays armed turns the next click —
usually meant to pick up what you just made — into another one of the same thing.

**Validate imports, never trust them.** `src/lib/file.ts` is the only untrusted
input: size-capped, shape-checked, every enum and id validated, unknown values
dropped and counted, colours matched against literal hex because they go
straight into an SVG attribute. Nothing is evaluated or rendered as markup.

## Data model notes

- `PlayerShape.number` is `number | null`. **Blank is a real state**, not a
  missing value: a 4v3 has four attackers, not the 2, 6, 8 and 10.
- Line ends are `{x, y}` or `{ref: playerId}`. An anchored end follows its
  player; a dangling ref degrades to `lastFrom`/`lastTo` rather than collapsing
  to the origin. Deleting a player *releases* its lines instead of deleting them.
- `bend` is a signed perpendicular offset from the chord midpoint, so a curve
  keeps its shape when either end moves.
- New shapes are placed at `DEFAULT_SCALE` (0.8), not 1.

## Testing

`tests/diagram.test.ts` (59 cases), vitest as a **devDependency only** — it must
never reach the bundle, or the zero-dependency claim stops being structurally
true. Tests live outside `src/` and cover `geometry.ts` and `file.ts`: anchoring,
curve trimming, hit-testing, group transforms, formations, small-sided layouts,
blank numbers, and hostile import files.

Interaction is verified in a browser rather than with a DOM test harness. Two
things will waste time if you do that:

- **React needs a tick between synthetic pointer events.** Dispatching
  `pointerdown`/`pointermove`/`pointerup` in one task makes the later handlers
  read a stale `drag`, and nothing happens.
- **A backgrounded tab clamps `setTimeout` to ≥1s** and throttles harder still
  after a few minutes hidden. Long `await` chains then time out, and any test of
  a sub-second window (the 900 ms shirt-number chase) measures the clamp instead
  of the code. Put both keystrokes in one task.

## Style

Comments say *why*, especially where the code encodes a decision or a bug that
was already paid for once. Match the surrounding density rather than adding
narration to obvious lines.
