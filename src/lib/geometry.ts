import {
  MAX_SCALE,
  MIN_SCALE,
  isRef,
  type Diagram,
  type Endpoint,
  type LineShape,
  type PlayerShape,
  type Shape,
} from '../types/diagram';

export interface Point {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const clampToBox = (p: Point, box: { w: number; h: number }): Point => ({
  x: clamp(p.x, 0, box.w),
  y: clamp(p.y, 0, box.h),
});

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Player tokens are ~46 units across; this is the radius used for snapping. */
export const PLAYER_RADIUS = 26;

export function players(d: Diagram): PlayerShape[] {
  return d.shapes.filter((s): s is PlayerShape => s.k === 'player');
}

export function playerById(d: Diagram, id: string): PlayerShape | undefined {
  return players(d).find((p) => p.id === id);
}

/**
 * Where an endpoint actually is right now.
 *
 * An anchored end follows its player. If that player has been deleted the line
 * falls back to where the end was last drawn, so a dangling reference degrades
 * to a fixed line rather than collapsing to the origin.
 */
export function resolveEnd(d: Diagram, e: Endpoint, fallback: Point): Point {
  if (!isRef(e)) return { x: e.x, y: e.y };
  const p = playerById(d, e.ref);
  return p ? { x: p.x, y: p.y } : fallback;
}

export function lineEnds(d: Diagram, l: LineShape): { a: Point; b: Point } {
  return {
    a: resolveEnd(d, l.from, l.lastFrom),
    b: resolveEnd(d, l.to, l.lastTo),
  };
}

/**
 * The quadratic control point for a bowed line.
 *
 * `bend` is a signed perpendicular offset from the midpoint of the chord, so a
 * curve keeps its shape when either end moves — which is what makes an anchored
 * curve still look right after dragging the player it is attached to.
 */
export function controlPoint(a: Point, b: Point, bend: number): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (!bend) return { x: mx, y: my };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector, doubled because a quadratic curve passes through
  // the midpoint of control and chord, not through the control point itself.
  return { x: mx + (-dy / len) * bend * 2, y: my + (dx / len) * bend * 2 };
}

/** Signed perpendicular distance of `p` from the chord a→b. */
export function bendFor(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return 0;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return ((p.x - mx) * -dy + (p.y - my) * dx) / len;
}

/** Point on the quadratic at t, used to place the arrow head and midpoint grab. */
export function pointOnCurve(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Tangent angle in degrees at t, so the arrow head points along the stroke. */
export function angleOnCurve(a: Point, c: Point, b: Point, t: number): number {
  const u = 1 - t;
  const dx = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x);
  const dy = 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Clear air between a token and a line anchored to it.
 *
 * Not decoration. Stopping exactly at the token's edge put the arrow head
 * inside the player's own hit radius, so the head — the end of the pass, and
 * the part of a line a coach reaches for — could never be clicked: the player
 * under it won every time.
 */
export const TOKEN_GAP = 12;

/** How far a dribble stroke swings off its centre line, in surface units. */
export const WAVE_AMP = 7;

/**
 * A wavy stroke for dribbles.
 *
 * The wave is driven by ARC LENGTH, not by the curve parameter. Driving it by
 * `t` — and deriving its frequency from the straight-line distance, as this did
 * first — means a bowed line is much longer than its chord, so the same number
 * of oscillations gets stretched across it and a strongly curved dribble
 * flattens into a lazy S instead of staying a dribble.
 *
 * Built from resolved geometry rather than an SVG filter, so it exports and
 * prints exactly as it appears.
 */
export function wavyPath(a: Point, c: Point, b: Point, amp = WAVE_AMP): string {
  const WAVELENGTH = 24; // surface units per full oscillation
  const AMP = amp;

  // Sample finely enough for the longest the curve could be.
  const bound = dist(a, c) + dist(c, b);
  const steps = Math.max(24, Math.min(480, Math.round(bound / 3)));

  const samples: { p: Point; t: number; s: number }[] = [];
  let run = 0;
  let prev = pointOnCurve(a, c, b, 0);
  samples.push({ p: prev, t: 0, s: 0 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = pointOnCurve(a, c, b, t);
    run += dist(p, prev);
    samples.push({ p, t, s: run });
    prev = p;
  }
  const total = run || 1;

  // Whole oscillations only, so the stroke starts and ends on the centre line
  // however long it is.
  const waves = Math.max(2, Math.round(total / WAVELENGTH));

  const pts = samples.map(({ p, t, s }) => {
    const ang = (angleOnCurve(a, c, b, t) * Math.PI) / 180;
    const u = s / total;
    // Taper to zero at both ends so it meets the token and the arrow head.
    const off = Math.sin(u * waves * Math.PI * 2) * AMP * Math.sin(Math.PI * u);
    return `${(p.x - Math.sin(ang) * off).toFixed(1)},${(p.y + Math.cos(ang) * off).toFixed(1)}`;
  });
  return `M${pts.join(' L')}`;
}

/**
 * The part of a quadratic between two parameters, as a quadratic of its own.
 *
 * Exact, not sampled: a Bézier segment is the same kind of curve as the whole,
 * so a trimmed line is still one `Q` command and still bows the way it was
 * drawn.
 */
function subCurve(a: Point, c: Point, b: Point, t0: number, t1: number): { a: Point; c: Point; b: Point } {
  const u0 = 1 - t0;
  const u1 = 1 - t1;
  return {
    a: pointOnCurve(a, c, b, t0),
    c: {
      x: u0 * u1 * a.x + (u0 * t1 + u1 * t0) * c.x + t0 * t1 * b.x,
      y: u0 * u1 * a.y + (u0 * t1 + u1 * t0) * c.y + t0 * t1 * b.y,
    },
    b: pointOnCurve(a, c, b, t1),
  };
}

export interface StrokeGeometry {
  a: Point;
  b: Point;
  c: Point;
  head: Point;
  angle: number;
}

/**
 * The stroke as it is actually drawn: ends pulled off any token they are
 * anchored to, the control point, and where the arrow head lands.
 *
 * The trim walks ALONG THE CURVE rather than along the chord between the ends.
 * Trimming the chord and then re-bowing it — which is what this did first —
 * leaves a curved arrow's head sitting beside the player with its point aimed
 * past them, because the chord and the curve arrive from different directions.
 * Walking the curve keeps the head on the stroke and pointing where the stroke
 * is going, which is at the player it is joined to.
 *
 * Deliberately shared with the renderer and the hit test, so what you can click
 * is what you can see.
 */
export function strokeGeometry(
  a: Point,
  b: Point,
  bend: number,
  /** How far to hold off each end, in surface units. 0 leaves that end alone. */
  rA: number,
  rB: number,
): StrokeGeometry {
  const c = controlPoint(a, b, bend);
  const STEPS = 96;

  /**
   * The parameter at which the curve first gets `r` away from `anchor`,
   * scanning from `end`.
   *
   * Coarse scan, then a few bisections. The scan alone leaves the gap as wide
   * as one step — on a long curve that is a visibly bigger gap than on a short
   * one, which makes the same rule look like two different rules.
   */
  const crossing = (anchor: Point, r: number, from: 0 | 1): number => {
    const at = (t: number) => dist(pointOnCurve(a, c, b, t), anchor);
    let prev: number = from;
    for (let i = 1; i <= STEPS; i++) {
      const t = from === 0 ? i / STEPS : 1 - i / STEPS;
      if (at(t) >= r) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          if (at(mid) >= r) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = t;
    }
    return from;
  };

  const t0 = rA > 0 ? crossing(a, rA, 0) : 0;
  const t1 = rB > 0 ? crossing(b, rB, 1) : 1;
  // Too short to trim: better a line that runs under a token than no line.
  // Too short to trim: better a line that runs under a token than one whose
  // head has crossed over its own tail.
  const short = t1 - t0 < 0.08;
  const from = short ? 0 : t0;
  const to = short ? 1 : t1;

  const sub = subCurve(a, c, b, from, to);
  return {
    ...sub,
    head: sub.b,
    // Tangent of the original curve at the trim point, which is the sub-curve's
    // own end tangent — so the head points along the stroke, into the token.
    angle: angleOnCurve(a, c, b, to),
  };
}

/**
 * How far a line should stop short of the token at one end.
 *
 * Scaled by that player's own size: the hold-off is meant to be a constant ring
 * of clear air around the token, so a fixed distance leaves a smaller player
 * marooned at the end of a gap.
 */
export function holdOff(d: Diagram, e: Endpoint): number {
  if (!isRef(e)) return 0;
  const p = playerById(d, e.ref);
  return PLAYER_RADIUS * (p?.scale ?? 1) + TOKEN_GAP;
}

export function lineGeometry(d: Diagram, l: LineShape): StrokeGeometry {
  const { a, b } = lineEnds(d, l);
  return strokeGeometry(a, b, l.bend, holdOff(d, l.from), holdOff(d, l.to));
}

/** Perpendicular distance from a point to a segment, clamped to its ends. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** How far a point is from a line's drawn path, sampled along the curve. */
export function distToLine(d: Diagram, l: LineShape, p: Point): number {
  const { a, b, c } = lineGeometry(d, l);
  let best = Infinity;
  let prev = pointOnCurve(a, c, b, 0);
  const N = 40;
  for (let i = 1; i <= N; i++) {
    const q = pointOnCurve(a, c, b, i / N);
    best = Math.min(best, distToSegment(p, prev, q));
    prev = q;
  }
  return best;
}

/**
 * Approximate box around a label. SVG will not tell us the rendered width
 * without measuring, and an estimate from the glyph count is close enough to
 * click accurately at these sizes.
 */
export function textBox(t: { text: string; size: number }): { w: number; h: number } {
  const chars = Math.max(1, t.text.length);
  return { w: chars * t.size * 0.56, h: t.size * 1.25 };
}

/** How close a click has to be to a stroke to count as hitting it. */
export const LINE_GRAB = 14;

/**
 * The arrow head's own target radius.
 *
 * Wider than the stroke tolerance because the head is what a coach points at —
 * it is the end of the pass, and it is a fatter mark than the line behind it.
 */
export const HEAD_GRAB = 20;

/**
 * Topmost shape under a point.
 *
 * Tokens win over lines when they overlap: a line usually starts or ends on a
 * player, so testing lines first would make players nearly unclickable.
 */
export function hitTest(d: Diagram, p: Point, kitSize: (id: string) => Point): Shape | undefined {
  for (let i = d.shapes.length - 1; i >= 0; i--) {
    const s = d.shapes[i];
    if (s.k === 'player' && dist(p, s) <= PLAYER_RADIUS * s.scale + 4) return s;
    if (s.k === 'kit') {
      const base = kitSize(s.item);
      const w = base.x * s.scale;
      const h = base.y * s.scale;
      if (Math.abs(p.x - s.x) <= w / 2 + 4 && Math.abs(p.y - s.y) <= h / 2 + 4) return s;
    }
    if (s.k === 'text') {
      const { w, h } = textBox(s);
      if (Math.abs(p.x - s.x) <= w / 2 + 6 && Math.abs(p.y - s.y) <= h / 2 + 6) return s;
    }
  }
  let closest: { s: Shape; d: number } | undefined;
  for (const s of d.shapes) {
    if (s.k !== 'line') continue;
    // The head counts as a hit on its own, and as the closest one — where two
    // arrows converge on the same player, the one you clicked the head of is
    // the one you meant.
    const dd = dist(p, lineGeometry(d, s).head) <= HEAD_GRAB ? 0 : distToLine(d, s, p);
    if (dd <= LINE_GRAB && (!closest || dd < closest.d)) closest = { s, d: dd };
  }
  return closest?.s;
}

/**
 * Brings everything back inside the drawing box.
 *
 * Cropping to a smaller field used to strand whatever fell outside it: the
 * shapes were still in the diagram and still printed into an export, but they
 * were off the viewBox, so they could not be seen, clicked, marquee'd or
 * deleted — the pointer itself is clamped to the box. Work you cannot reach is
 * worse than work that has moved, and this is undoable.
 */
export function confineToBox(
  shapes: Shape[],
  box: { w: number; h: number },
): { shapes: Shape[]; moved: number } {
  let moved = 0;
  const outside = (p: Point) => p.x < 0 || p.y < 0 || p.x > box.w || p.y > box.h;
  const next = shapes.map((s) => {
    if (s.k === 'line') {
      const from = isRef(s.from) ? s.from : s.from;
      const to = isRef(s.to) ? s.to : s.to;
      const wasOut =
        (!isRef(from) && outside(from)) ||
        (!isRef(to) && outside(to)) ||
        outside(s.lastFrom) ||
        outside(s.lastTo);
      if (!wasOut) return s;
      moved++;
      return {
        ...s,
        from: isRef(from) ? from : clampToBox(from, box),
        to: isRef(to) ? to : clampToBox(to, box),
        lastFrom: clampToBox(s.lastFrom, box),
        lastTo: clampToBox(s.lastTo, box),
      };
    }
    if (!outside(s)) return s;
    moved++;
    return { ...s, ...clampToBox(s, box) };
  });
  return { shapes: next, moved };
}

/** The player a line end should attach to, if it was released over one. */
export function playerAt(d: Diagram, p: Point): PlayerShape | undefined {
  return players(d)
    .slice()
    .reverse()
    .find((pl) => dist(p, pl) <= PLAYER_RADIUS * pl.scale + 6);
}
const rad = (deg: number) => (deg * Math.PI) / 180;

export const rotatePt = (p: Point, pivot: Point, deg: number): Point => {
  const t = rad(deg);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(t) - dy * Math.sin(t),
    y: pivot.y + dx * Math.sin(t) + dy * Math.cos(t),
  };
};

export const scalePt = (p: Point, pivot: Point, k: number): Point => ({
  x: pivot.x + (p.x - pivot.x) * k,
  y: pivot.y + (p.y - pivot.y) * k,
});

/**
 * Turns and grows the whole selection about one pivot.
 *
 * Everything selected moves together — positions orbit the pivot, not just the
 * objects' own angles. Rotating each token in place instead leaves a back four
 * pointing a new way while still sitting in the old line, which is not what
 * "turn the shape" means.
 *
 * Anchored line ends are left alone: they follow their players, and those are
 * being moved here already.
 */
export function transformed(
  snapshot: Shape[],
  selected: ReadonlySet<string>,
  pivot: Point,
  deg: number,
  k: number,
  box: { w: number; h: number },
): Shape[] {
  const mapPt = (p: Point) => clampToBox(scalePt(rotatePt(p, pivot, deg), pivot, k), box);
  return snapshot.map((s) => {
    if (!selected.has(s.id)) return s;
    if (s.k === 'line') {
      return {
        ...s,
        from: isRef(s.from) ? s.from : mapPt(s.from),
        to: isRef(s.to) ? s.to : mapPt(s.to),
        lastFrom: mapPt(s.lastFrom),
        lastTo: mapPt(s.lastTo),
        // Bend is a perpendicular offset, so it is unaffected by rotation but
        // has to grow with the line or a curve straightens as it is scaled.
        bend: s.bend * k,
      };
    }
    const at = mapPt({ x: s.x, y: s.y });
    const rot = (((s.rot + deg) % 360) + 360) % 360;
    if (s.k === 'text') return { ...s, ...at, rot, size: clamp(s.size * k, 14, 90) };
    return { ...s, ...at, rot, scale: clamp(s.scale * k, MIN_SCALE, MAX_SCALE) };
  });
}

