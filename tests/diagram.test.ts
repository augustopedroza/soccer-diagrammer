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
  bendFor,
  confineToBox,
  controlPoint,
  hitTest,
  lineEnds,
  lineGeometry,
  playerAt,
  resolveEnd,
  textBox,
  transformed,
} from '../src/lib/geometry';
import { ALL_NUMBERS } from '../src/data/notation';
import { EQUIPMENT } from '../src/data/equipment';
import { FORMATIONS, MAX_SIDE, SMALL_SIDED, placements, smallSidedSpots } from '../src/data/formations';
import type { Diagram } from '../src/types/diagram';

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
    const r = parse(serialize(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram).toEqual(d);
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
    expect(r.diagram.surface).toEqual({ sport: 'soccer', crop: 'full', facing: 'up', style: 'shaded' });
    expect(r.diagram.shapes.map((s) => s.id)).toEqual(['ok']);
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
    expect(r.diagram.shapes[0]).toMatchObject({ from: { x: 100, y: 100 } });
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
    expect(r.diagram.shapes).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
});

describe('labels', () => {
  it('round-trips a label with its size', () => {
    const d = emptyDiagram();
    d.shapes = [{ k: 'text', id: 't1', x: 100, y: 200, text: 'Overload here', size: 32, rot: 30 }];
    const r = parse(serialize(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.shapes[0]).toEqual(d.shapes[0]);
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
    const t = r.diagram.shapes[0] as { text: string };
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
    expect(r.diagram.shapes).toHaveLength(1);
    expect(r.diagram.shapes[0]).toMatchObject({ id: 'ok', size: 22 });
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
    const [a, b] = r.diagram.shapes as { scale: number }[];
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
    const r = parse(serialize(withBlank()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.shapes).toEqual(withBlank().shapes);
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
    expect((r.diagram.shapes[0] as { number: number | null }).number).toBeNull();
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
    expect(r.diagram.shapes).toHaveLength(0);
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
    const r = parse(serialize(neutral('#e8b21f')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.diagram.shapes[0] as { color?: string }).color).toBe('#e8b21f');
  });

  it('leaves a player with no colour of its own alone', () => {
    const r = parse(serialize(neutral()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('color' in r.diagram.shapes[0]).toBe(false);
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
      expect(r.diagram.shapes).toHaveLength(1);
      expect((r.diagram.shapes[0] as { color?: string }).color).toBeUndefined();
    });
  }
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
