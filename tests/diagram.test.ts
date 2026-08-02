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
  bendFor,
  controlPoint,
  lineEnds,
  playerAt,
  resolveEnd,
  textBox,
} from '../src/lib/geometry';
import { ALL_NUMBERS } from '../src/data/notation';
import { EQUIPMENT } from '../src/data/equipment';
import { FORMATIONS, placements } from '../src/data/formations';
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
    d.shapes = [{ k: 'text', id: 't1', x: 100, y: 200, text: 'Overload here', size: 32 }];
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
    expect(r.diagram.shapes[0]).toMatchObject({ id: 'ok', size: 32 });
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
