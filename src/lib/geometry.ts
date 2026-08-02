import {
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
 * Shortens a line so it starts and ends at the edge of an anchored token rather
 * than at its centre — otherwise the arrow head disappears under the player.
 */
export function trimToTokens(
  a: Point,
  b: Point,
  trimA: boolean,
  trimB: boolean,
  r = PLAYER_RADIUS,
): { a: Point; b: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < r * 2.2) return { a, b };
  const ux = dx / len;
  const uy = dy / len;
  return {
    a: trimA ? { x: a.x + ux * r, y: a.y + uy * r } : a,
    b: trimB ? { x: b.x - ux * r, y: b.y - uy * r } : b,
  };
}

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
export function wavyPath(a: Point, c: Point, b: Point): string {
  const WAVELENGTH = 24; // surface units per full oscillation
  const AMP = 7;

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
  const { a, b } = lineEnds(d, l);
  const c = controlPoint(a, b, l.bend);
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

/** How close a click has to be to a stroke to count as hitting it. */
export const LINE_GRAB = 14;

/**
 * Topmost shape under a point.
 *
 * Tokens win over lines when they overlap: a line usually starts or ends on a
 * player, so testing lines first would make players nearly unclickable.
 */
export function hitTest(d: Diagram, p: Point, kitSize: (id: string) => Point): Shape | undefined {
  for (let i = d.shapes.length - 1; i >= 0; i--) {
    const s = d.shapes[i];
    if (s.k === 'player' && dist(p, s) <= PLAYER_RADIUS + 4) return s;
    if (s.k === 'kit') {
      const { x: w, y: h } = kitSize(s.item);
      if (Math.abs(p.x - s.x) <= w / 2 + 4 && Math.abs(p.y - s.y) <= h / 2 + 4) return s;
    }
  }
  let closest: { s: Shape; d: number } | undefined;
  for (const s of d.shapes) {
    if (s.k !== 'line') continue;
    const dd = distToLine(d, s, p);
    if (dd <= LINE_GRAB && (!closest || dd < closest.d)) closest = { s, d: dd };
  }
  return closest?.s;
}

/** The player a line end should attach to, if it was released over one. */
export function playerAt(d: Diagram, p: Point): PlayerShape | undefined {
  return players(d)
    .slice()
    .reverse()
    .find((pl) => dist(p, pl) <= PLAYER_RADIUS + 6);
}
