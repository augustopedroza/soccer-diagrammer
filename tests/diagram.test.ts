import { describe, expect, it } from 'vitest';
import {
  FILE_KIND,
  FILE_VERSION,
  MAX_BYTES,
  emptyDiagram,
  parse,
  serialize,
} from '../src/lib/file';
import {
  HEAD_GRAB,
  LINE_GRAB,
  PLAYER_RADIUS,
  TOKEN_GAP,
  alignDelta,
  bendFor,
  bendPoints,
  confineToBox,
  fitBends,
  controlPoint,
  hitTest,
  lineEnds,
  lineGeometry,
  playerAt,
  resolveEnd,
  textBox,
  transformed,
  translated,
} from '../src/lib/geometry';
import {
  addDiagram,
  diagramLabel,
  duplicateDiagram,
  moveDiagram,
  removeDiagram,
} from '../src/lib/session';
import { ALL_NUMBERS, LINE_SPECS, bibRing } from '../src/data/notation';
import { SHORTCUT_GROUPS } from '../src/data/shortcuts';
import { EQUIPMENT } from '../src/data/equipment';
import { FORMATIONS, MAX_SIDE, SMALL_SIDED, placements, smallSidedSpots } from '../src/data/formations';
import { MAX_BENDS, MAX_DIAGRAMS, type Diagram, type Session } from '../src/types/diagram';

/** A file holding one diagram, which is what most of these cases are about. */
const asSession = (d: Diagram): Session => ({ title: 'Tuesday', diagrams: [d] });
/** The first diagram out of a parse result, once it is known to be ok. */
const first = (r: { ok: true; session: Session }) => r.session.diagrams[0];

function withPlayers(): Diagram {
  const d = emptyDiagram();
  d.title = 'Tuesday — breaking lines';
  d.shapes = [
    { k: 'player', id: 'p1', team: 'own', number: 6, x: 300, y: 700, rot: 0, scale: 1 },
    { k: 'player', id: 'p2', team: 'own', number: 10, x: 600, y: 400, rot: 0, scale: 1 },
    { k: 'player', id: 'p3', team: 'opp', number: 4, x: 500, y: 500, rot: 0, scale: 1 },
    {
      k: 'line',
      id: 'l1',
      type: 'pass',
      from: { ref: 'p1' },
      to: { ref: 'p2' },
      bend: 0,
      lastFrom: { x: 300, y: 700 },
      lastTo: { x: 600, y: 400 },
    },
  ];
  return d;
}

describe('anchoring', () => {
  it('follows the player an end is attached to', () => {
    const d = withPlayers();
    const before = lineEnds(d, d.shapes[3] as never);
    expect(before.b).toEqual({ x: 600, y: 400 });

    // Move the 10. The line must move with it, not stay where it was drawn.
    const moved: Diagram = {
      ...d,
      shapes: d.shapes.map((s) => (s.id === 'p2' ? { ...s, x: 120, y: 150 } : s)),
    };
    const after = lineEnds(moved, moved.shapes[3] as never);
    expect(after.b).toEqual({ x: 120, y: 150 });
    expect(after.a).toEqual({ x: 300, y: 700 });
  });

  it('falls back to the last drawn point when the player is gone', () => {
    const d = withPlayers();
    const orphaned: Diagram = { ...d, shapes: d.shapes.filter((s) => s.id !== 'p2') };
    const ends = lineEnds(orphaned, orphaned.shapes[2] as never);
    // Not (0,0) — a dangling reference degrades to a fixed line.
    expect(ends.b).toEqual({ x: 600, y: 400 });
  });

  it('resolves a fixed end without consulting the players', () => {
    const d = emptyDiagram();
    expect(resolveEnd(d, { x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });

  it('only attaches when released over a token', () => {
    const d = withPlayers();
    expect(playerAt(d, { x: 300, y: 700 })?.id).toBe('p1');
    expect(playerAt(d, { x: 300, y: 640 })).toBeUndefined();
  });
});

describe('picking a line', () => {
  const kitSize = (id: string) => {
    const s = EQUIPMENT.find((e) => e.id === id);
    return { x: s?.w ?? 24, y: s?.h ?? 24 };
  };
  const line = (d: Diagram) => d.shapes.find((s) => s.k === 'line')!;

  it('draws the arrow head clear of the token it points at', () => {
    const d = withPlayers();
    const { head } = lineGeometry(d, line(d) as never);
    // Outside the player's own hit radius, or the head is unclickable however
    // wide its target is — the token under it wins first.
    expect(Math.hypot(head.x - 600, head.y - 400)).toBeGreaterThan(PLAYER_RADIUS + 4);
  });

  it('selects the line from its arrow head', () => {
    const d = withPlayers();
    const { head } = lineGeometry(d, line(d) as never);
    expect(hitTest(d, head, kitSize)?.id).toBe('l1');
  });

  it('gives the head a wider target than the stroke', () => {
    const d = withPlayers();
    const { head } = lineGeometry(d, line(d) as never);
    // Perpendicular to a 45-degree chord, further out than the stroke tolerance
    // but inside the head's own.
    const off = (LINE_GRAB + HEAD_GRAB) / 2 / Math.SQRT2;
    const beside = { x: head.x + off, y: head.y + off };
    expect(hitTest(d, beside, kitSize)?.id).toBe('l1');
  });

  it('still lets the player win where the two overlap', () => {
    const d = withPlayers();
    expect(hitTest(d, { x: 600, y: 400 }, kitSize)?.id).toBe('p2');
  });

  it('misses when the pointer is nowhere near the stroke', () => {
    const d = withPlayers();
    expect(hitTest(d, { x: 300, y: 400 }, kitSize)).toBeUndefined();
  });
});

describe('a curved arrow into a player', () => {
  const bowed = (bend: number): Diagram => {
    const d = withPlayers();
    return { ...d, shapes: d.shapes.map((s) => (s.k === 'line' ? { ...s, bend } : s)) };
  };
  const target = { x: 600, y: 400 };

  for (const bend of [0, 40, -90, 160]) {
    it(`points at the player it is joined to (bend ${bend})`, () => {
      const d = bowed(bend);
      const g = lineGeometry(d, d.shapes.find((s) => s.k === 'line') as never);

      // The head sits clear of the token, on the stroke.
      // The same gap however the line bows: a trim that stopped at the first
      // coarse sample left a long curve visibly further off its token than a
      // short one, which reads as two different rules.
      const gap = Math.hypot(g.head.x - target.x, g.head.y - target.y);
      expect(gap).toBeCloseTo(PLAYER_RADIUS + TOKEN_GAP, 1);

      // And it aims at the player: the angle it is drawn at, followed from the
      // head, lands on the token rather than sailing past it.
      const rad = (g.angle * Math.PI) / 180;
      const ahead = { x: g.head.x + Math.cos(rad) * gap, y: g.head.y + Math.sin(rad) * gap };
      expect(Math.hypot(ahead.x - target.x, ahead.y - target.y)).toBeLessThan(PLAYER_RADIUS * 0.6);
    });
  }

  it('leaves a line alone when it is too short to trim', () => {
    const d = withPlayers();
    const short: Diagram = {
      ...d,
      shapes: d.shapes.map((s) => (s.id === 'p2' ? { ...s, x: 310, y: 690 } : s)),
    };
    const g = lineGeometry(short, short.shapes.find((s) => s.k === 'line') as never);
    // Untrimmed rather than inverted: a line that runs under a token beats one
    // whose head has crossed over its own tail.
    expect(g.a).toEqual({ x: 300, y: 700 });
    expect(g.head).toEqual({ x: 310, y: 690 });
  });
});

describe('freehand', () => {
  const a = { x: 100, y: 100 };
  const b = { x: 500, y: 100 };
  /** A drag sampled along a path, the way the pointer would deliver it. */
  const along = (f: (u: number) => { x: number; y: number }, n = 40) =>
    Array.from({ length: n + 1 }, (_, i) => f(i / n));

  it('fits no bends to a drag that was meant to be straight', () => {
    // A steady hand with a few units of wobble — well under the tolerance.
    const path = along((u) => ({
      x: a.x + (b.x - a.x) * u,
      y: a.y + Math.sin(u * 9) * 4,
    }));
    expect(fitBends(path, a, b)).toEqual([]);
  });

  it('fits bends to a stroke that genuinely curves', () => {
    const path = along((u) => ({
      x: a.x + (b.x - a.x) * u,
      y: a.y + Math.sin(u * Math.PI) * 120,
    }));
    const bends = fitBends(path, a, b);
    expect(bends.length).toBeGreaterThan(0);
    // Offsets are perpendicular to the chord, which here runs left to right.
    expect(Math.max(...bends.map((w) => Math.abs(w.o)))).toBeGreaterThan(60);
    for (const w of bends) {
      expect(w.t).toBeGreaterThanOrEqual(0);
      expect(w.t).toBeLessThanOrEqual(1);
    }
  });

  it('never keeps more waypoints than the cap', () => {
    const path = along((u) => ({
      x: a.x + (b.x - a.x) * u,
      y: a.y + Math.sin(u * 30) * 60,
    }), 400);
    expect(fitBends(path, a, b, MAX_BENDS).length).toBeLessThanOrEqual(MAX_BENDS);
  });

  it('holds its shape when the players at its ends move', () => {
    // Relative storage is the whole point: the same waypoints, read against a
    // moved chord, still sit the same way along and across it.
    const bends = [{ t: 0.5, o: 60 }];
    const near = bendPoints(a, b, bends)[0];
    const moved = bendPoints({ x: 300, y: 300 }, { x: 700, y: 300 }, bends)[0];
    expect(near.x - a.x).toBeCloseTo(moved.x - 300, 6);
    expect(near.y - a.y).toBeCloseTo(moved.y - 300, 6);
  });

  it('still points its head at the player it is joined to', () => {
    const d = withPlayers();
    const freehand: Diagram = {
      ...d,
      shapes: d.shapes.map((s) =>
        s.k === 'line' ? { ...s, bends: [{ t: 0.35, o: 70 }, { t: 0.7, o: -40 }] } : s,
      ),
    };
    const g = lineGeometry(freehand, freehand.shapes.find((s) => s.k === 'line') as never);
    expect(g.points).toBeDefined();
    const gap = Math.hypot(g.head.x - 600, g.head.y - 400);
    expect(gap).toBeGreaterThan(PLAYER_RADIUS);
    const rad = (g.angle * Math.PI) / 180;
    const ahead = { x: g.head.x + Math.cos(rad) * gap, y: g.head.y + Math.sin(rad) * gap };
    expect(Math.hypot(ahead.x - 600, ahead.y - 400)).toBeLessThan(PLAYER_RADIUS);
  });

  it('round-trips its waypoints, and refuses malformed ones without losing the line', () => {
    const d = withPlayers();
    const freehand: Diagram = {
      ...d,
      shapes: d.shapes.map((s) => (s.k === 'line' ? { ...s, bends: [{ t: 0.4, o: 55 }] } : s)),
    };
    const round = parse(serialize(asSession(freehand)));
    expect(round.ok).toBe(true);
    if (round.ok) {
      const l = first(round).shapes.find((s) => s.k === 'line') as { bends?: unknown };
      expect(l.bends).toEqual([{ t: 0.4, o: 55 }]);
    }

    const raw = {
      kind: FILE_KIND,
      version: FILE_VERSION,
      diagram: {
        ...emptyDiagram(),
        shapes: [
          {
            k: 'line', id: 'l1', type: 'pass',
            from: { x: 0, y: 0 }, to: { x: 100, y: 100 },
            lastFrom: { x: 0, y: 0 }, lastTo: { x: 100, y: 100 },
            bend: 0,
            bends: [{ t: 5, o: 10 }, { t: 'x', o: 1 }, null, 'nope'],
          },
        ],
      },
    };
    const hostile = parse(JSON.stringify(raw));
    expect(hostile.ok).toBe(true);
    if (!hostile.ok) return;
    expect(first(hostile).shapes).toHaveLength(1);
    expect((first(hostile).shapes[0] as { bends?: unknown }).bends).toBeUndefined();
  });
});

describe('changing the surface', () => {
  it('brings stranded shapes back inside the new box', () => {
    const d = withPlayers();
    const { shapes, moved } = confineToBox(d.shapes, { w: 400, h: 400 });
    // All three players fall outside a 400x400 box, and so do the line's ends.
    expect(moved).toBe(4);
    for (const s of shapes) {
      if (s.k === 'line') continue;
      expect(s.x).toBeLessThanOrEqual(400);
      expect(s.y).toBeLessThanOrEqual(400);
    }
  });

  it('leaves a diagram that already fits completely alone', () => {
    const d = withPlayers();
    const { shapes, moved } = confineToBox(d.shapes, { w: 1000, h: 1000 });
    expect(moved).toBe(0);
    expect(shapes).toEqual(d.shapes);
  });

  it('keeps anchored ends anchored while it does so', () => {
    const d = withPlayers();
    const { shapes } = confineToBox(d.shapes, { w: 200, h: 200 });
    const l = shapes.find((s) => s.k === 'line') as { from: unknown; to: unknown };
    expect(l.from).toEqual({ ref: 'p1' });
    expect(l.to).toEqual({ ref: 'p2' });
  });
});

describe('moving and lining up', () => {
  const box = { w: 1000, h: 1200 };

  it('moves everything selected, and nothing else', () => {
    const d = withPlayers();
    const out = translated(d.shapes, new Set(['p1', 'l1']), 20, -30, box);
    const p1 = out.find((s) => s.id === 'p1') as { x: number; y: number };
    expect([p1.x, p1.y]).toEqual([320, 670]);
    expect(out.find((s) => s.id === 'p2')).toEqual(d.shapes.find((s) => s.id === 'p2'));
  });

  it('leaves an anchored line end where its player is', () => {
    const d = withPlayers();
    const out = translated(d.shapes, new Set(['l1']), 40, 40, box);
    const l = out.find((s) => s.id === 'l1') as { from: unknown; lastFrom: { x: number } };
    expect(l.from).toEqual({ ref: 'p1' });
    // The stored fallback still travels, so releasing the anchor later keeps it
    // where the coach last saw the line.
    expect(l.lastFrom.x).toBe(340);
  });

  it('keeps the selection on the field', () => {
    const d = withPlayers();
    const out = translated(d.shapes, new Set(['p1']), 5000, 5000, box);
    const p1 = out.find((s) => s.id === 'p1') as { x: number; y: number };
    expect([p1.x, p1.y]).toEqual([box.w, box.h]);
  });

  it('lines a dragged token up with one already on the pitch', () => {
    const d = withPlayers();
    // p1 is at (300,700); p3 at (500,500). Drag p1 to just under p3's column.
    const near = alignDelta(d.shapes, new Set(['p1']), 204, 0);
    expect(near.dx).toBe(200);
    expect(near.guideX).toBe(500);
  });

  it('leaves a drag alone when nothing is close', () => {
    const d = withPlayers();
    const far = alignDelta(d.shapes, new Set(['p1']), 120, 90);
    expect(far).toEqual({ dx: 120, dy: 90, guideX: undefined, guideY: undefined });
  });

  it('never aligns the selection to itself', () => {
    const d = withPlayers();
    // Everything selected: with no fixed shape to measure against there is
    // nothing to snap to, or a group could never leave its own alignment.
    const all = alignDelta(d.shapes, new Set(['p1', 'p2', 'p3', 'l1']), 3, 3);
    expect(all).toEqual({ dx: 3, dy: 3 });
  });
});

describe('transforming a selection', () => {
  const box = { w: 1000, h: 1200 };
  const both = new Set(['p1', 'p2']);

  it('turns the group about the pivot, not each token where it stands', () => {
    const d = withPlayers();
    const out = transformed(d.shapes, both, { x: 450, y: 550 }, 90, 1, box);
    const at = (id: string) => out.find((s) => s.id === id) as { x: number; y: number; rot: number };
    // A quarter turn clockwise about (450,550): (300,700) -> (300,400).
    expect(at('p1').x).toBeCloseTo(300, 6);
    expect(at('p1').y).toBeCloseTo(400, 6);
    expect(at('p2').x).toBeCloseTo(600, 6);
    expect(at('p2').y).toBeCloseTo(700, 6);
    expect(at('p1').rot).toBeCloseTo(90, 6);
  });

  it('grows the group away from the pivot and scales each token with it', () => {
    const d = withPlayers();
    const out = transformed(d.shapes, both, { x: 450, y: 550 }, 0, 2, box);
    const at = (id: string) => out.find((s) => s.id === id) as { x: number; y: number; scale: number };
    expect(at('p1').x).toBeCloseTo(150, 6);
    expect(at('p1').y).toBeCloseTo(850, 6);
    expect(at('p1').scale).toBeCloseTo(2, 6);
  });

  it('leaves anything not selected exactly as it was', () => {
    const d = withPlayers();
    const out = transformed(d.shapes, new Set(['p1']), { x: 450, y: 550 }, 90, 2, box);
    expect(out.find((s) => s.id === 'p2')).toEqual(d.shapes.find((s) => s.id === 'p2'));
    expect(out.find((s) => s.id === 'p3')).toEqual(d.shapes.find((s) => s.id === 'p3'));
  });

  it('keeps an anchored line anchored, and grows its bow with it', () => {
    const d = withPlayers();
    const curved = {
      ...d,
      shapes: d.shapes.map((s) => (s.k === 'line' ? { ...s, bend: 30 } : s)),
    };
    const out = transformed(curved.shapes, new Set(['p1', 'p2', 'l1']), { x: 450, y: 550 }, 0, 2, box);
    const l = out.find((s) => s.id === 'l1') as { from: unknown; bend: number };
    // Still a reference: an anchored end follows its player rather than being
    // rewritten to a point, or the line would come off the token it was joined to.
    expect(l.from).toEqual({ ref: 'p1' });
    expect(l.bend).toBeCloseTo(60, 6);
  });

  it('keeps the whole selection inside the surface', () => {
    const d = withPlayers();
    const out = transformed(d.shapes, both, { x: 450, y: 550 }, 0, 40, box);
    for (const s of out) {
      if (s.k === 'line') continue;
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(box.w);
      expect(s.y).toBeLessThanOrEqual(box.h);
    }
  });
});

describe('curves', () => {
  it('is straight at zero bend', () => {
    const c = controlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(c).toEqual({ x: 50, y: 0 });
  });

  it('bows perpendicular to the chord, and the sign follows the pointer', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const above = controlPoint(a, b, bendFor(a, b, { x: 50, y: -40 }));
    const below = controlPoint(a, b, bendFor(a, b, { x: 50, y: 40 }));
    expect(above.y).toBeLessThan(0);
    expect(below.y).toBeGreaterThan(0);
    expect(above.x).toBeCloseTo(50);
  });

  it('keeps its shape when an anchored end moves', () => {
    // A bend is stored relative to the chord, so the same value still reads as
    // the same curve after the player it is attached to is dragged.
    const bend = bendFor({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -30 });
    const moved = controlPoint({ x: 0, y: 0 }, { x: 0, y: 100 }, bend);
    expect(Math.hypot(moved.x - 0, moved.y - 50)).toBeGreaterThan(10);
  });

  it('does not divide by zero on a degenerate line', () => {
    expect(bendFor({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 })).toBe(0);
    expect(controlPoint({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toEqual({ x: 5, y: 5 });
  });
});

describe('save and open', () => {
  it('round-trips a diagram exactly', () => {
    const d = withPlayers();
    const r = parse(serialize(asSession(d)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r)).toEqual(d);
    expect(r.dropped).toBe(0);
  });

  const bad: [string, string][] = [
    ['nonsense', 'not json {{'],
    ['an array', '[1,2]'],
    ['null', 'null'],
    ['another app', '{"kind":"other","version":1}'],
    ['a future version', `{"kind":"${FILE_KIND}","version":99}`],
  ];
  for (const [label, text] of bad) {
    it(`refuses ${label} without throwing`, () => {
      const r = parse(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(8);
    });
  }

  it('refuses an oversized file', () => {
    expect(parse('x'.repeat(MAX_BYTES + 1)).ok).toBe(false);
  });

  it('drops shapes it cannot trust and counts them', () => {
    const r = parse(
      JSON.stringify({
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: {
          surface: { sport: 'hockey', crop: 'octagon', facing: 'sideways', style: 'neon' },
          shapes: [
            { k: 'player', id: 'ok', team: 'own', number: 9, x: 10, y: 10 },
            { k: 'player', id: 'bad-num', team: 'own', number: 47, x: 10, y: 10 },
            { k: 'player', id: 'off-field', team: 'own', number: 9, x: 99999, y: 10 },
            { k: 'kit', id: 'bad-kit', item: 'trebuchet', x: 5, y: 5 },
            { k: 'line', id: 'bad-line', type: 'telepathy', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
            { k: 'wat', id: 'x' },
          ],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Unknown enums fall back rather than propagating.
    expect(first(r).surface).toEqual({ sport: 'soccer', crop: 'full', facing: 'up', style: 'shaded' });
    expect(first(r).shapes.map((s) => s.id)).toEqual(['ok']);
    expect(r.dropped).toBe(5);
  });

  it('releases an anchor that points at a player not in the file', () => {
    const r = parse(
      JSON.stringify({
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: {
          shapes: [
            {
              k: 'line',
              id: 'l',
              type: 'run',
              from: { ref: 'ghost' },
              to: { x: 400, y: 400 },
              bend: 0,
              lastFrom: { x: 100, y: 100 },
              lastTo: { x: 400, y: 400 },
            },
          ],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r).shapes[0]).toMatchObject({ from: { x: 100, y: 100 } });
  });

  it('rejects duplicate ids, which would break selection and anchoring', () => {
    const r = parse(
      JSON.stringify({
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: {
          shapes: [
            { k: 'player', id: 'same', team: 'own', number: 9, x: 1, y: 1 },
            { k: 'player', id: 'same', team: 'opp', number: 4, x: 2, y: 2 },
          ],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r).shapes).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
});

describe('labels', () => {
  it('round-trips a label with its size', () => {
    const d = emptyDiagram();
    d.shapes = [{ k: 'text', id: 't1', x: 100, y: 200, text: 'Overload here', size: 32, rot: 30 }];
    const r = parse(serialize(asSession(d)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r).shapes[0]).toEqual(d.shapes[0]);
  });

  it('caps an absurdly long label rather than refusing the file', () => {
    const r = parse(
      JSON.stringify({
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: { shapes: [{ k: 'text', id: 't', x: 1, y: 1, text: 'a'.repeat(9000), size: 32 }] },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = first(r).shapes[0] as { text: string };
    expect(t.text.length).toBe(120);
  });

  it('falls back to a usable size and drops a label with no text', () => {
    const r = parse(
      JSON.stringify({
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: {
          shapes: [
            { k: 'text', id: 'ok', x: 1, y: 1, text: 'fine', size: 9999 },
            { k: 'text', id: 'bad', x: 1, y: 1, size: 32 },
          ],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r).shapes).toHaveLength(1);
    expect(first(r).shapes[0]).toMatchObject({ id: 'ok', size: 22 });
    expect(r.dropped).toBe(1);
  });

  it('keeps an out-of-range equipment scale inside its bounds', () => {
    const r = parse(
      JSON.stringify({
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: {
          shapes: [
            { k: 'kit', id: 'a', item: 'cone', x: 10, y: 10, rot: 0, scale: 99 },
            { k: 'kit', id: 'b', item: 'cone', x: 20, y: 20, rot: 0, scale: 1.5 },
          ],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = first(r).shapes as { scale: number }[];
    expect(a.scale).toBe(1);
    expect(b.scale).toBe(1.5);
  });

  it('sizes its hit box from the glyph count', () => {
    const short = textBox({ text: 'A', size: 32 });
    const long = textBox({ text: 'A much longer label', size: 32 });
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.h).toBe(short.h);
  });
});

describe('formations', () => {
  it('gives every shape eleven players, numbered 1-11 once each', () => {
    for (const f of FORMATIONS) {
      const nums = f.spots.map((p) => p.number).sort((a, b) => a - b);
      expect(nums, f.id).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }
  });

  it('keeps every player on the field', () => {
    for (const f of FORMATIONS) {
      for (const p of f.spots) {
        expect(p.fx, `${f.id} #${p.number}`).toBeGreaterThan(0.05);
        expect(p.fx, `${f.id} #${p.number}`).toBeLessThan(0.95);
        expect(p.fy, `${f.id} #${p.number}`).toBeGreaterThan(0.2);
        expect(p.fy, `${f.id} #${p.number}`).toBeLessThan(0.98);
      }
    }
  });

  it('always plays the 8 to the right of the 10', () => {
    for (const f of FORMATIONS) {
      const at = (n: number) => f.spots.find((p) => p.number === n)!;
      expect(at(8).fx, `${f.id}`).toBeGreaterThan(at(10).fx);
    }
  });

  it('puts the 6 behind and between them wherever the midfield is a triangle', () => {
    const triangles = FORMATIONS.filter((f) => f.midfield === 'triangle');
    expect(triangles.length).toBeGreaterThan(0);
    for (const f of triangles) {
      const at = (n: number) => f.spots.find((p) => p.number === n)!;
      const [eight, ten, six] = [at(8), at(10), at(6)];
      expect(six.fy, `${f.id}: 6 behind`).toBeGreaterThan(Math.max(eight.fy, ten.fy));
      expect(six.fx, `${f.id}: 6 between`).toBeGreaterThanOrEqual(ten.fx);
      expect(six.fx, `${f.id}: 6 between`).toBeLessThanOrEqual(eight.fx);
    }
  });

  it('pairs the double pivot: 6 central, 8 close on its right, both behind the 10', () => {
    const pivots = FORMATIONS.filter((x) => x.midfield === 'double-pivot');
    expect(pivots.length).toBeGreaterThan(0);
    // The widest 10-to-8 gap among the triangles, for comparison: a pivot has
    // to read as a pair rather than as two players split across the pitch.
    const widest = Math.max(
      ...FORMATIONS.filter((f) => f.midfield === 'triangle').map((f) => {
        const at = (n: number) => f.spots.find((p) => p.number === n)!;
        return at(8).fx - at(10).fx;
      }),
    );

    for (const f of pivots) {
      const at = (n: number) => f.spots.find((p) => p.number === n)!;
      const [six, eight, ten] = [at(6), at(8), at(10)];
      expect(six.fy, `${f.id}: 6 behind the 10`).toBeGreaterThan(ten.fy);
      expect(eight.fy, `${f.id}: 8 behind the 10`).toBeGreaterThan(ten.fy);
      expect(Math.abs(six.fx - 0.5), `${f.id}: 6 holds the middle`).toBeLessThanOrEqual(0.08);
      expect(eight.fx, `${f.id}: 8 on its right`).toBeGreaterThan(six.fx);
      expect(eight.fx - six.fx, `${f.id}: close together`).toBeLessThan(widest);
    }
  });

  it('puts the keeper deepest and behind the defence', () => {
    for (const f of FORMATIONS) {
      const keeper = f.spots.find((p) => p.number === 1)!;
      const outfield = f.spots.filter((p) => p.number !== 1);
      expect(keeper.fy, f.id).toBeGreaterThan(Math.max(...outfield.map((p) => p.fy)));
    }
  });

  it('mirrors the opposition end to end and side to side', () => {
    const f = FORMATIONS[0];
    const own = placements(f, 'own');
    const opp = placements(f, 'opp');
    // The opposition keeper is at the far end, not stacked on ours.
    const ownGk = own.find((p) => p.number === 1)!;
    const oppGk = opp.find((p) => p.number === 1)!;
    expect(oppGk.fy).toBeCloseTo(1 - ownGk.fy);
    for (let i = 0; i < own.length; i++) {
      expect(opp[i].fx).toBeCloseTo(1 - own[i].fx);
    }
  });
});

describe('small-sided games', () => {
  it('offers only sides of one to eleven', () => {
    for (const s of SMALL_SIDED) {
      for (const n of [s.own, s.opp]) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(MAX_SIDE);
      }
    }
  });

  it('places exactly the number of players asked for', () => {
    for (let n = 1; n <= MAX_SIDE; n++) {
      expect(smallSidedSpots(n, 'own')).toHaveLength(n);
      expect(smallSidedSpots(n, 'opp')).toHaveLength(n);
    }
  });

  it('keeps every player on the field', () => {
    for (let n = 1; n <= MAX_SIDE; n++) {
      for (const team of ['own', 'opp'] as const) {
        for (const p of smallSidedSpots(n, team)) {
          expect(p.fx).toBeGreaterThan(0.05);
          expect(p.fx).toBeLessThan(0.95);
          expect(p.fy).toBeGreaterThan(0.05);
          expect(p.fy).toBeLessThan(0.95);
        }
      }
    }
  });

  it('puts the two sides in opposite halves, so it reads as a game', () => {
    for (let n = 1; n <= MAX_SIDE; n++) {
      expect(smallSidedSpots(n, 'own').every((p) => p.fy > 0.5)).toBe(true);
      expect(smallSidedSpots(n, 'opp').every((p) => p.fy < 0.5)).toBe(true);
    }
  });

  it('staggers rather than lining players up, from three onwards', () => {
    for (let n = 3; n <= MAX_SIDE; n++) {
      const rows = new Set(smallSidedSpots(n, 'own').map((p) => p.fy));
      expect(rows.size).toBeGreaterThan(1);
    }
  });

  it('refuses to place a nonsense count, rather than an empty side', () => {
    expect(smallSidedSpots(0, 'own')).toHaveLength(1);
    expect(smallSidedSpots(99, 'own')).toHaveLength(MAX_SIDE);
  });
});

describe('blank shirt numbers', () => {
  const withBlank = (): Diagram => {
    const d = emptyDiagram();
    d.shapes = [
      { k: 'player', id: 'b1', team: 'own', number: null, x: 100, y: 100, rot: 0, scale: 1 },
      { k: 'player', id: 'b2', team: 'opp', number: 9, x: 200, y: 200, rot: 0, scale: 1 },
    ];
    return d;
  };

  it('round-trips a blank token', () => {
    const r = parse(serialize(asSession(withBlank())));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r).shapes).toEqual(withBlank().shapes);
    expect(r.dropped).toBe(0);
  });

  it('treats an absent number as blank, not as a broken record', () => {
    const raw = {
      kind: FILE_KIND,
      version: FILE_VERSION,
      diagram: {
        ...emptyDiagram(),
        shapes: [{ k: 'player', id: 'x', team: 'own', x: 10, y: 10, rot: 0, scale: 1 }],
      },
    };
    const r = parse(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(0);
    expect((first(r).shapes[0] as { number: number | null }).number).toBeNull();
  });

  it('still drops a number that is not a shirt number', () => {
    const raw = {
      kind: FILE_KIND,
      version: FILE_VERSION,
      diagram: {
        ...emptyDiagram(),
        shapes: [{ k: 'player', id: 'x', team: 'own', number: 47, x: 10, y: 10, rot: 0, scale: 1 }],
      },
    };
    const r = parse(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(first(r).shapes).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });
});

describe('a player in its own colour', () => {
  const neutral = (color?: string) => {
    const d = emptyDiagram();
    d.shapes = [
      { k: 'player', id: 'n1', team: 'own', number: null, x: 100, y: 100, rot: 0, scale: 1, ...(color ? { color } : {}) },
    ];
    return d;
  };

  it('round-trips the colour', () => {
    const r = parse(serialize(asSession(neutral('#e8b21f'))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((first(r).shapes[0] as { color?: string }).color).toBe('#e8b21f');
  });

  it('leaves a player with no colour of its own alone', () => {
    const r = parse(serialize(asSession(neutral())));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('color' in first(r).shapes[0]).toBe(false);
  });

  for (const bad of ['red', '#ffff', 'url(#x)', '<script>', 12, null]) {
    it(`refuses ${JSON.stringify(bad)} without dropping the player`, () => {
      const raw = {
        kind: FILE_KIND,
        version: FILE_VERSION,
        diagram: {
          ...emptyDiagram(),
          shapes: [
            { k: 'player', id: 'n1', team: 'own', number: 9, x: 10, y: 10, rot: 0, scale: 1, color: bad },
          ],
        },
      };
      const r = parse(JSON.stringify(raw));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // The player survives in the team kit — a bad swatch is not a reason to
      // lose someone off the pitch — and nothing but literal hex gets through,
      // because the value goes straight into an SVG fill.
      expect(first(r).shapes).toHaveLength(1);
      expect((first(r).shapes[0] as { color?: string }).color).toBeUndefined();
    });
  }
});

describe('a session of several diagrams', () => {
  const named = (title: string): Diagram => ({ ...emptyDiagram(), title });
  const three = (): Session => ({
    title: 'Tuesday',
    diagrams: [named('Warm-up'), named('4v3'), named('Game')],
  });

  it('round-trips every diagram, in order, under the session name', () => {
    const r = parse(serialize(three()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.title).toBe('Tuesday');
    expect(r.session.diagrams.map((d) => d.title)).toEqual(['Warm-up', '4v3', 'Game']);
  });

  it('opens a version 1 file as a session of one', () => {
    // The file a coach saved yesterday. Refusing it by version number would be
    // refusing their own work.
    const v1 = {
      kind: FILE_KIND,
      version: 1,
      diagram: {
        ...emptyDiagram(),
        title: 'Pressing',
        shapes: [{ k: 'player', id: 'p', team: 'own', number: 9, x: 10, y: 10, rot: 0, scale: 1 }],
      },
    };
    const r = parse(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.diagrams).toHaveLength(1);
    expect(r.session.diagrams[0].shapes).toHaveLength(1);
    // No session name of its own, so the diagram's is the closest thing to what
    // the coach called it.
    expect(r.session.title).toBe('Pressing');
  });

  it('refuses a version it does not know', () => {
    const r = parse(JSON.stringify({ kind: FILE_KIND, version: 99, diagrams: [] }));
    expect(r.ok).toBe(false);
  });

  it('never opens with nothing to draw on', () => {
    const r = parse(JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, diagrams: [] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.diagrams).toHaveLength(1);
  });

  it('caps the list and counts what it dropped', () => {
    const many = Array.from({ length: MAX_DIAGRAMS + 4 }, (_, i) => named(`D${i}`));
    const r = parse(serialize({ title: 'Big', diagrams: many }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.diagrams).toHaveLength(MAX_DIAGRAMS);
    expect(r.dropped).toBe(4);
  });

  it('adds and duplicates next to the one in hand, and shows it', () => {
    const s = three();
    const added = addDiagram(s, 0, emptyDiagram());
    expect(added.active).toBe(1);
    expect(added.session.diagrams.map((d) => d.title)).toEqual(['Warm-up', '', '4v3', 'Game']);

    const copied = duplicateDiagram(s, 1);
    expect(copied.active).toBe(2);
    expect(copied.session.diagrams[2].title).toBe('4v3 copy');
  });

  it('copies deeply enough that editing the copy cannot reach the original', () => {
    const s: Session = {
      title: 'x',
      diagrams: [
        {
          ...emptyDiagram(),
          shapes: [{ k: 'player', id: 'p', team: 'own', number: 9, x: 1, y: 1, rot: 0, scale: 1 }],
        },
      ],
    };
    const copied = duplicateDiagram(s, 0);
    const copy = copied.session.diagrams[1];
    (copy.shapes[0] as { x: number }).x = 999;
    expect((s.diagrams[0].shapes[0] as { x: number }).x).toBe(1);
  });

  it('refuses to grow past the cap rather than silently dropping one', () => {
    const full: Session = {
      title: 'full',
      diagrams: Array.from({ length: MAX_DIAGRAMS }, (_, i) => named(`D${i}`)),
    };
    expect(addDiagram(full, 0, emptyDiagram()).session).toBe(full);
  });

  it('shows the one that took its place when a diagram is deleted', () => {
    const s = three();
    const gone = removeDiagram(s, 1, emptyDiagram);
    expect(gone.session.diagrams.map((d) => d.title)).toEqual(['Warm-up', 'Game']);
    expect(gone.active).toBe(1);

    // Deleting the last one lands on the new last one rather than off the end.
    const end = removeDiagram(s, 2, emptyDiagram);
    expect(end.active).toBe(1);
  });

  it('empties the last diagram rather than leaving nothing to draw on', () => {
    const one: Session = { title: 'x', diagrams: [named('Only')] };
    const gone = removeDiagram(one, 0, emptyDiagram);
    expect(gone.session.diagrams).toHaveLength(1);
    expect(gone.session.diagrams[0].title).toBe('');
    expect(gone.active).toBe(0);
  });

  it('reorders, and follows the diagram that moved', () => {
    const s = three();
    const moved = moveDiagram(s, 2, 0);
    expect(moved.session.diagrams.map((d) => d.title)).toEqual(['Game', 'Warm-up', '4v3']);
    expect(moved.active).toBe(0);
    // Past either end is a no-op, not a wrap.
    expect(moveDiagram(s, 0, -1).session).toBe(s);
  });

  it('names an untitled diagram by its place in the session', () => {
    expect(diagramLabel(emptyDiagram(), 2)).toBe('Diagram 3');
    expect(diagramLabel(named('Rondo'), 0)).toBe('Rondo');
  });
});

describe('a bib that survives grey print', () => {
  it('rings a player wearing its own colour, in a contrasting ink', () => {
    // Light bib, dark ring; dark bib, light ring.
    expect(bibRing('#e8b21f', '#e8b21f')).toBe('#14171c');
    expect(bibRing('#1d232b', '#1d232b')).toBe('#ffffff');
  });

  it('leaves the team kit unringed, because the ring is what says "not one of these"', () => {
    expect(bibRing(undefined, '#1c6bba')).toBeUndefined();
  });
});

describe('the shortcuts panel', () => {
  const listed = SHORTCUT_GROUPS.flatMap((g) => g.items.flatMap((i) => i.keys));

  it('lists every line type by its own letter', () => {
    // The panel is the only place these are written down, so a fifth line type
    // added without one should fail here rather than ship undiscoverable.
    for (const spec of LINE_SPECS) {
      expect(listed).toContain(spec.key.toUpperCase());
    }
  });

  it('lists the keys that are not letters, which nothing else explains', () => {
    for (const k of ['↑', '[', '⌫', '⌘Z', '⌘S', '?']) {
      expect(listed).toContain(k);
    }
  });

  it('says what each shortcut does', () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const item of g.items) {
        expect(item.keys.length).toBeGreaterThan(0);
        expect(item.what.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('palettes', () => {
  it('offers 1-11 exactly once', () => {
    expect([...ALL_NUMBERS].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(ALL_NUMBERS).size).toBe(11);
  });

  it('gives every equipment item a unique id and a footprint', () => {
    const ids = EQUIPMENT.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EQUIPMENT) {
      expect(e.w, e.id).toBeGreaterThan(0);
      expect(e.h, e.id).toBeGreaterThan(0);
    }
  });
});
