# Session Diagrammer

Draw soccer and futsal training-session diagrams using standard coaching notation.

Runs entirely in the browser. No accounts, no server, no network requests at
runtime — diagrams are saved by downloading a file and reopened from one.

## Notation

Four line types, each carrying a meaning rather than an appearance. You pick the
action; the stroke follows from it.

| Draw | Renders as |
|---|---|
| Pass or shot | solid line, arrow head |
| Dribble | wavy line, arrow head |
| Run off the ball | dashed line, arrow head |
| Tactical arrow | solid red line, arrow head |

Your team is a triangle pointing up — the way the notation has you attacking, so
the token itself carries the direction of play — and the opposition is a disc.
Two *shapes*, not just two colours, so a diagram survives being printed in grey
or read by someone who cannot separate the two hues. Kit colours are yours to
set.

Players can carry a positional number or none at all. A small-sided game is four
attackers, not the 2, 6, 8 and 10, so those go down blank.

## Drawing

- **Place** a player or a piece of equipment: pick it, then click the surface.
- **Draw a line**: press where it starts, release where it ends. The arrow head
  lands where you release.
- **Curve**: hold **Shift** and drag in an arc. The bow follows the path you drew.
- **Attach**: release a line end over a player and it anchors there. Move that
  player and the line follows, changing length and angle with them.
- **Select**: click, Shift-click to add, or drag a box on empty ground. Several
  things selected become one object: drag anywhere inside the frame to move them
  all, turn them by the handle above it, resize by a corner. `⌘A` selects all.
- **Number a player**: double-click it and press Enter, or type with it selected
  — 1 then 0 for the 10, 1 then 1 for the 11, 0 for none.
- **Undo / redo**: `⌘Z` and `⇧⌘Z`. Copy, cut, paste and duplicate are `⌘C`,
  `⌘X`, `⌘V`, `⌘D`.

Templates drop a small-sided game (1v1 up to 5v5, or any N v M) or a full
starting XI in one of five shapes. Labels, equipment and a printable sheet round
it out; a session is saved by downloading a file and reopened from one.

## Surfaces

Soccer and futsal, each as a full pitch, three quarters, a half or the penalty
area, facing any of four ways, shaded or as line art for printing. All of them
come from one parametric drawing, so a penalty area is the same penalty area in
every variant.

Markings derive from real dimensions rather than eyeballed fractions — a soccer
pitch at 68 x 105 m, and a futsal court at 20 x 40 m with the penalty area built
as FIFA's Futsal Law 1 describes it: two quarter circles of 6 m struck from the
posts, joined across the goal.

## Commands

```bash
npm install
npm run dev        # http://127.0.0.1:5174
npm run verify     # typecheck + tests
npm run build
npm run deploy
```
