import { useRef, useState } from 'react';
import { equipmentSpec } from '../data/equipment';
import { lineSpec } from '../data/notation';
import { surfaceBox } from '../lib/surfaceBox';
import {
  bendFor,
  clamp,
  clampToBox,
  controlPoint,
  dist,
  hitTest,
  lineEnds,
  PLAYER_RADIUS,
  TOKEN_GAP,
  fitBends,
  playerAt,
  pointOnCurve,
  polyPath,
  rotatePt,
  strokeGeometry,
  wavyAlong,
  textBox,
  transformed,
  wavyPath,
  type Point,
} from '../lib/geometry';
import { DEFAULT_SCALE, MAX_BENDS, ROTATE_STEP, TEXT_SIZES, isRef, type Diagram, type LineType, type Shape, type Team } from '../types/diagram';
import { SurfaceSvg } from './Surface';
import { KitMark, LineMark, PlayerMark, TextMark } from './Tokens';

export type Tool =
  | { kind: 'select' }
  | { kind: 'player'; team: Team; number: number }
  | { kind: 'line'; type: LineType }
  | { kind: 'kit'; item: string }
  | { kind: 'text' };

interface Drag {
  mode: 'line' | 'move' | 'marquee' | 'endpoint' | 'bend' | 'rotate' | 'scale';
  start: Point;
  now: Point;
  shift: boolean;
  /** Sampled pointer path: for a line drag, this is the line's shape. */
  path: Point[];
  /** For endpoint and bend drags: which line, and which end of it. */
  lineId?: string;
  end?: 'from' | 'to';
  /**
   * Rotate and scale work from the shapes as they were when the drag started,
   * not from the last frame. Applying each move to the previous result compounds
   * rounding — and with a group, drags every clamped shape a little further
   * every frame.
   */
  snapshot?: Shape[];
  /** The point a rotate or scale drag turns and grows about. */
  pivot?: Point;
  fromAngle?: number;
  fromDist?: number;
  /** The group frame's angle when the rotate drag started. */
  baseRot?: number;
}

/** Half-size of the selection box around a shape, in surface units. */
const CHROME_PAD = 6;
/** The same, around a group — wider, to keep its grips off its members. */
const GROUP_PAD = 18;
/** How far above the box the rotate handle floats. */
const ROTATE_ARM = 26;

const angleAt = (cx: number, cy: number, p: Point) =>
  (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Where the rotate knob sits once the object has been turned.
 *
 * The chrome rotates with the object — a box that stays square while its
 * contents lean looks like a bug — so the knob orbits with it and the hit test
 * has to follow rather than assume it is straight up.
 */
function knobAt(cx: number, cy: number, boxH: number, rot: number): Point {
  const d = boxH / 2 + ROTATE_ARM;
  return { x: cx + Math.sin(rad(rot)) * d, y: cy - Math.cos(rad(rot)) * d };
}

/** How close a click has to be to a handle to grab it. */
const HANDLE_GRAB = 16;

let seq = 0;
const nextId = (p: string) => `${p}${++seq}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** The box drawn around a selected token, and used to place its rotate knob. */
function chromeBox(sh: Shape, kitSize: (id: string) => Point): { w: number; h: number } {
  if (sh.k === 'kit') {
    const base = kitSize(sh.item);
    return { w: base.x * sh.scale + CHROME_PAD * 2, h: base.y * sh.scale + CHROME_PAD * 2 };
  }
  if (sh.k === 'text') {
    const t = textBox(sh);
    return { w: t.w + CHROME_PAD * 2, h: t.h + CHROME_PAD * 2 };
  }
  // A player triangle is a little taller than it is wide.
  const scale = sh.k === 'player' ? sh.scale : 1;
  return { w: (60 + CHROME_PAD) * scale, h: (64 + CHROME_PAD) * scale };
}

/** A box with corner grips and a rotate knob: what the handles act on. */
interface Frame {
  pivot: Point;
  w: number;
  h: number;
  rot: number;
  group: boolean;
}

/**
 * The frame the handles act on.
 *
 * One selected token gets its own box, turned with it. Several get a single box
 * around the lot. That box carries `groupRot` — the angle the group has been
 * turned through since it was selected — and is measured in that turned basis,
 * so it stays wrapped around the group instead of springing back to upright the
 * moment the contents lean. Lines count towards the extent but never define a
 * frame alone, since a line is edited by its ends.
 */
function selectionFrame(
  diagram: Diagram,
  selected: ReadonlySet<string>,
  kitSize: (id: string) => Point,
  groupRot: number,
): Frame | null {
  const picked = diagram.shapes.filter((s) => selected.has(s.id));
  const tokens = picked.filter((s) => s.k !== 'line');
  if (tokens.length === 0) return null;
  if (picked.length === 1 && tokens.length === 1) {
    const sh = tokens[0];
    const b = chromeBox(sh, kitSize);
    return { pivot: { x: sh.x, y: sh.y }, w: b.w, h: b.h, rot: sh.rot, group: false };
  }

  const pts: Point[] = [];
  for (const sh of picked) {
    if (sh.k === 'line') {
      const { a, b } = lineEnds(diagram, sh);
      pts.push(a, b);
      continue;
    }
    const b = chromeBox(sh, kitSize);
    // Corners of the token's own turned box, so a rotated item is fully inside.
    const theta = rad(sh.rot);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      pts.push({
        x: sh.x + ((sx * b.w) / 2) * Math.cos(theta) - ((sy * b.h) / 2) * Math.sin(theta),
        y: sh.y + ((sx * b.w) / 2) * Math.sin(theta) + ((sy * b.h) / 2) * Math.cos(theta),
      });
    }
  }

  // Measure in the group's own basis: unturn the points, take the bounds there,
  // then turn the resulting box back.
  const seed = {
    x: pts.reduce((t, p) => t + p.x, 0) / pts.length,
    y: pts.reduce((t, p) => t + p.y, 0) / pts.length,
  };
  const local = pts.map((p) => rotatePt(p, seed, -groupRot));
  const x1 = Math.min(...local.map((p) => p.x));
  const x2 = Math.max(...local.map((p) => p.x));
  const y1 = Math.min(...local.map((p) => p.y));
  const y2 = Math.max(...local.map((p) => p.y));
  return {
    pivot: rotatePt({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, seed, groupRot),
    // Roomier than a single token's box, so the corner grips sit clear of
    // whatever is at the edge of the group rather than on top of it — grabbing
    // the corner player to move the shape would otherwise resize it.
    w: Math.max(24, x2 - x1 + GROUP_PAD * 2),
    h: Math.max(24, y2 - y1 + GROUP_PAD * 2),
    rot: groupRot,
    group: true,
  };
}

/** Is this point inside the frame — including where the frame has been turned? */
function insideFrame(f: Frame, p: Point): boolean {
  const local = rotatePt(p, f.pivot, -f.rot);
  return (
    Math.abs(local.x - f.pivot.x) <= f.w / 2 && Math.abs(local.y - f.pivot.y) <= f.h / 2
  );
}

/** The four corner points of a frame, in surface coordinates. */
function frameCorners(f: Frame): Point[] {
  const theta = rad(f.rot);
  return [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => ({
    x: f.pivot.x + ((sx * f.w) / 2) * Math.cos(theta) - ((sy * f.h) / 2) * Math.sin(theta),
    y: f.pivot.y + ((sx * f.w) / 2) * Math.sin(theta) + ((sy * f.h) / 2) * Math.cos(theta),
  }));
}

export function Canvas({
  diagram,
  tool,
  selected,
  onSelect,
  onChange,
  onEditShape,
  onSelectExisting,
}: {
  diagram: Diagram;
  tool: Tool;
  selected: ReadonlySet<string>;
  onSelect: (ids: ReadonlySet<string>) => void;
  onChange: (next: Diagram, commit: boolean) => void;
  /** Double-click: edit that shape where it stands — a shirt number, a label. */
  onEditShape?: (id: string, at: { x: number; y: number }) => void;
  /** A line tool press landed on an existing line: hand the tool back. */
  onSelectExisting?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [groupRot, setGroupRot] = useState(0);
  const box = surfaceBox(diagram.surface);

  /**
   * Client point to surface coordinates, via the SVG's own screen matrix.
   *
   * The element fills its column and the drawing is letterboxed inside it by
   * preserveAspectRatio, so the element's bounding box is NOT the drawing's
   * box. Scaling by the rect would put every click slightly off wherever the
   * two differ; the CTM is exact by construction.
   */
  const toSurface = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return clampToBox({ x: local.x, y: local.y }, box);
  };

  const kitSize = (id: string) => {
    const s = equipmentSpec(id);
    return { x: s?.w ?? 24, y: s?.h ?? 24 };
  };

  /**
   * How far the group has been turned since it was selected.
   *
   * Kept here rather than on the shapes because it belongs to the selection,
   * not to the drawing: it exists only while these particular things are picked
   * out together, and a new selection starts square again.
   */
  const selKey = [...selected].sort().join(',');
  const lastSel = useRef(selKey);
  if (lastSel.current !== selKey) {
    lastSel.current = selKey;
    if (groupRot !== 0) setGroupRot(0);
  }

  const frame = selectionFrame(diagram, selected, kitSize, groupRot);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toSurface(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // The handles sit on top of everything, so they are tested first — before
    // the placement tools too. A tool that stays armed would otherwise turn a
    // press on a resize grip into another cone, since a grip sits outside the
    // token it belongs to and reads as empty grass.
    // With several things selected there is one frame around the lot, and both
    // handles act on all of them.
    if (frame) {
      const knob = knobAt(frame.pivot.x, frame.pivot.y, frame.h, frame.rot);
      if (dist(p, knob) <= HANDLE_GRAB) {
        setDrag({
          mode: 'rotate',
          start: p,
          now: p,
          shift: e.shiftKey,
          path: [p],
          snapshot: diagram.shapes,
          pivot: frame.pivot,
          fromAngle: angleAt(frame.pivot.x, frame.pivot.y, p),
          baseRot: frame.group ? groupRot : undefined,
        });
        return;
      }
      if (frameCorners(frame).some((c) => dist(p, c) <= HANDLE_GRAB)) {
        setDrag({
          mode: 'scale',
          start: p,
          now: p,
          shift: false,
          path: [p],
          snapshot: diagram.shapes,
          pivot: frame.pivot,
          fromDist: Math.max(6, dist(p, frame.pivot)),
        });
        return;
      }
    }

    // Handles on a selected line come first: they sit on top and are the whole
    // point of having selected it.
    for (const l of diagram.shapes) {
      if (l.k !== 'line' || !selected.has(l.id)) continue;
      const { a, b } = lineEnds(diagram, l);
      const c = controlPoint(a, b, l.bend);
      const mid = pointOnCurve(a, c, b, 0.5);
      if (dist(p, a) <= HANDLE_GRAB) {
        setDrag({ mode: 'endpoint', start: p, now: p, shift: false, path: [p], lineId: l.id, end: 'from' });
        return;
      }
      if (dist(p, b) <= HANDLE_GRAB) {
        setDrag({ mode: 'endpoint', start: p, now: p, shift: false, path: [p], lineId: l.id, end: 'to' });
        return;
      }
      if (dist(p, mid) <= HANDLE_GRAB) {
        setDrag({ mode: 'bend', start: p, now: p, shift: false, path: [p], lineId: l.id });
        return;
      }
    }

    if (tool.kind === 'player' || tool.kind === 'kit' || tool.kind === 'text') {
      // One rule for every tool: armed until you aim at something that is
      // already there. Pressing an existing shape picks it up and hands the tool
      // back, which is what makes a sticky tool safe — the click meant to grab
      // the player you just placed used to drop a second one on top of it.
      const existing = hitTest(diagram, p, kitSize);
      if (existing) {
        onSelect(new Set([existing.id]));
        onSelectExisting?.();
        setDrag({ mode: 'move', start: p, now: p, shift: false, path: [p] });
        return;
      }
      const shape: Shape =
        tool.kind === 'player'
          ? { k: 'player', id: nextId('p'), team: tool.team, number: tool.number, rot: 0, scale: DEFAULT_SCALE, ...p }
          : tool.kind === 'kit'
            ? { k: 'kit', id: nextId('k'), item: tool.item, rot: 0, scale: DEFAULT_SCALE, ...p }
            : { k: 'text', id: nextId('t'), text: 'Label', size: TEXT_SIZES[0], rot: 0, ...p };
      onChange({ ...diagram, shapes: [...diagram.shapes, shape] }, true);
      onSelect(new Set([shape.id]));
      return;
    }

    if (tool.kind === 'line') {
      // Pressing on an arrow that is already there picks it up instead of
      // drawing another one over it, and hands the tool back to Select — the
      // only reason to aim at an existing line is to work on it. Players do NOT
      // intercept this way, because a line usually starts on one.
      const existing = hitTest(diagram, p, kitSize);
      if (existing?.k === 'line') {
        onSelect(new Set([existing.id]));
        onSelectExisting?.();
        setDrag({ mode: 'move', start: p, now: p, shift: false, path: [p] });
        return;
      }
      setDrag({ mode: 'line', start: p, now: p, shift: false, path: [p] });
      return;
    }

    const hit = hitTest(diagram, p, kitSize);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (!hit) {
      // Inside a group's frame, empty space still drags the group. A gap
      // between two players is part of the thing you have hold of; treating it
      // as bare grass made a multi-selection undraggable except by its members,
      // and a drag there wiped the selection instead.
      if (!additive && frame?.group && insideFrame(frame, p)) {
        setDrag({ mode: 'move', start: p, now: p, shift: false, path: [p] });
        return;
      }
      // Otherwise empty space starts a marquee. Without a modifier it also
      // clears, so a stray click does not silently keep an old selection alive.
      if (!additive) onSelect(new Set());
      setDrag({ mode: 'marquee', start: p, now: p, shift: additive, path: [p] });
      return;
    }

    let next: ReadonlySet<string>;
    if (additive) {
      const s = new Set(selected);
      if (s.has(hit.id)) s.delete(hit.id);
      else s.add(hit.id);
      next = s;
    } else {
      // Grabbing one of several keeps the group, so moving many is one gesture.
      next = selected.has(hit.id) ? selected : new Set([hit.id]);
    }
    onSelect(next);
    // A line moves like anything else. Its anchored ends stay with their
    // players — those are not free to move — so dragging one that is pinned at
    // both ends does nothing, which is the honest result rather than a bug.
    setDrag({ mode: 'move', start: p, now: p, shift: false, path: [p] });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toSurface(e);

    if (drag.mode === 'rotate' && drag.snapshot && drag.pivot && drag.fromAngle !== undefined) {
      const raw = angleAt(drag.pivot.x, drag.pivot.y, p) - drag.fromAngle;
      // Shift snaps to 15 degrees, the way most editors do.
      const delta = e.shiftKey ? Math.round(raw / ROTATE_STEP) * ROTATE_STEP : raw;
      onChange(
        { ...diagram, shapes: transformed(drag.snapshot, selected, drag.pivot, delta, 1, box) },
        false,
      );
      // The frame turns with its contents. Measured from the angle the drag
      // started at, so it tracks the shapes exactly rather than accumulating.
      if (drag.baseRot !== undefined) setGroupRot(drag.baseRot + delta);
    }

    if (drag.mode === 'scale' && drag.snapshot && drag.pivot && drag.fromDist) {
      const ratio = clamp(dist(p, drag.pivot) / drag.fromDist, 0.05, 20);
      onChange(
        { ...diagram, shapes: transformed(drag.snapshot, selected, drag.pivot, 0, ratio, box) },
        false,
      );
    }

    if (drag.mode === 'endpoint' && drag.lineId) {
      onChange(
        {
          ...diagram,
          shapes: diagram.shapes.map((sh) => {
            if (sh.k !== 'line' || sh.id !== drag.lineId) return sh;
            // Dragging an end detaches it; releasing over a player re-attaches.
            return drag.end === 'from'
              ? { ...sh, from: { ...p }, lastFrom: { ...p } }
              : { ...sh, to: { ...p }, lastTo: { ...p } };
          }),
        },
        false,
      );
    }

    if (drag.mode === 'bend' && drag.lineId) {
      onChange(
        {
          ...diagram,
          shapes: diagram.shapes.map((sh) => {
            if (sh.k !== 'line' || sh.id !== drag.lineId) return sh;
            const { a, b } = lineEnds(diagram, sh);
            // Bowing from the midpoint replaces a drawn shape with one clean
            // arc. Keeping the waypoints would leave the handle apparently
            // doing nothing, since they are what describes the line.
            const { bends: _drop, ...rest } = sh;
            return { ...rest, bend: bendFor(a, b, p) };
          }),
        },
        false,
      );
    }

    if (drag.mode === 'move') {
      const dx = p.x - drag.now.x;
      const dy = p.y - drag.now.y;
      const shift = (q: Point) => clampToBox({ x: q.x + dx, y: q.y + dy }, box);
      onChange(
        {
          ...diagram,
          shapes: diagram.shapes.map((s) => {
            if (!selected.has(s.id)) return s;
            if (s.k === 'line') {
              // A selected line travels too, but only its free ends: an
              // anchored end is already following its player.
              return {
                ...s,
                from: isRef(s.from) ? s.from : shift(s.from),
                to: isRef(s.to) ? s.to : shift(s.to),
                lastFrom: shift(s.lastFrom),
                lastTo: shift(s.lastTo),
              };
            }
            return { ...s, ...shift(s) };
          }),
        },
        false,
      );
    }

    setDrag({
      ...drag,
      now: p,
      shift: drag.mode === 'line' ? e.shiftKey || drag.shift : drag.shift,
      path: drag.path.length < 400 ? [...drag.path, p] : drag.path,
    });
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toSurface(e);

    if (drag.mode === 'line' && tool.kind === 'line') {
      // A click without a drag is not a line.
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 24) {
        const fromPlayer = playerAt(diagram, drag.start);
        const toPlayer = playerAt(diagram, p);
        // The path IS the line. Anything close enough to straight fits no bends
        // at all, so an ordinary drag still produces an ordinary line.
        const freehand = fitBends(drag.path, drag.start, p, MAX_BENDS);
        const shape: Shape = {
          k: 'line',
          id: nextId('l'),
          type: tool.type,
          from: fromPlayer ? { ref: fromPlayer.id } : { ...drag.start },
          to: toPlayer ? { ref: toPlayer.id } : { ...p },
          bend: 0,
          ...(freehand.length > 0 ? { bends: freehand } : {}),
          lastFrom: { ...drag.start },
          lastTo: { ...p },
        };
        onChange({ ...diagram, shapes: [...diagram.shapes, shape] }, true);
        // Deliberately NOT selected. The tool stays armed for the next arrow,
        // and auto-selecting this one would drop three handles on top of the
        // players it was just joined to, and make the next line-type keystroke
        // retype it rather than arm the tool.
        onSelect(new Set());
      }
    }

    if (drag.mode === 'marquee') {
      const x1 = Math.min(drag.start.x, p.x);
      const x2 = Math.max(drag.start.x, p.x);
      const y1 = Math.min(drag.start.y, p.y);
      const y2 = Math.max(drag.start.y, p.y);
      if (x2 - x1 > 6 || y2 - y1 > 6) {
        const inside = diagram.shapes.filter((s) => {
          if (s.k === 'line') {
            // Both ends inside, so a marquee never half-grabs a line.
            const { a, b } = lineEnds(diagram, s);
            return [a, b].every((q) => q.x >= x1 && q.x <= x2 && q.y >= y1 && q.y <= y2);
          }
          return s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2;
        });
        const s = drag.shift ? new Set(selected) : new Set<string>();
        for (const sh of inside) s.add(sh.id);
        onSelect(s);
      }
    }

    if (drag.mode === 'endpoint' && drag.lineId) {
      const over = playerAt(diagram, p);
      onChange(
        {
          ...diagram,
          shapes: diagram.shapes.map((sh) => {
            if (sh.k !== 'line' || sh.id !== drag.lineId) return sh;
            const anchor = over ? { ref: over.id } : { ...p };
            return drag.end === 'from'
              ? { ...sh, from: anchor, lastFrom: { ...p } }
              : { ...sh, to: anchor, lastTo: { ...p } };
          }),
        },
        true,
      );
      // The gesture is finished, so let go of it. Leaving the line selected
      // kept three handles sitting on top of the players it had just been
      // joined to, hiding the thing you were looking at.
      onSelect(new Set());
    }

    if (drag.mode === 'rotate' || drag.mode === 'scale') onChange(diagram, true);
    if (drag.mode === 'bend') onChange(diagram, true);
    if (drag.mode === 'move') onChange(diagram, true);
    setDrag(null);
  }

  const preview = (() => {
    if (!drag) return null;

    if (drag.mode === 'marquee') {
      return (
        <rect
          x={Math.min(drag.start.x, drag.now.x)}
          y={Math.min(drag.start.y, drag.now.y)}
          width={Math.abs(drag.now.x - drag.start.x)}
          height={Math.abs(drag.now.y - drag.start.y)}
          className="marquee"
        />
      );
    }

    if (drag.mode !== 'line' || tool.kind !== 'line') return null;
    const spec = lineSpec(tool.type);
    const a = drag.start;
    const b = drag.now;
    const bends = fitBends(drag.path, a, b, MAX_BENDS);
    // Same geometry the finished line will use, so the preview does not jump
    // when the pointer comes up.
    const holdOffAt = (q: Point) => {
      const pl = playerAt(diagram, q);
      return pl ? PLAYER_RADIUS * pl.scale + TOKEN_GAP : 0;
    };
    const g = strokeGeometry(a, b, 0, holdOffAt(a), holdOffAt(b), bends);
    const head = g.head;
    const d = g.points
      ? spec.wavy
        ? wavyAlong(g.points)
        : polyPath(g.points)
      : spec.wavy
        ? wavyPath(g.a, g.c, g.b)
        : `M${g.a.x},${g.a.y} Q${g.c.x},${g.c.y} ${g.b.x},${g.b.y}`;
    return (
      <g opacity={0.75}>
        <path
          d={d}
          fill="none"
          stroke={spec.stroke}
          strokeWidth={3.5}
          strokeDasharray={spec.dash}
          strokeLinecap="round"
        />
        <circle cx={head.x} cy={head.y} r={5} fill={spec.stroke} />
      </g>
    );
  })();

  /**
   * The player a line end would attach to if released right now.
   *
   * Attaching is invisible otherwise — the line just happens to end near a
   * token — so it needs to be obvious before you let go, not after.
   */
  const snapTarget = (() => {
    if (!drag) return null;
    if (drag.mode === 'line') return playerAt(diagram, drag.now);
    if (drag.mode === 'endpoint') return playerAt(diagram, drag.now);
    return null;
  })();

  const lines = diagram.shapes.filter((s) => s.k === 'line');
  const rest = diagram.shapes.filter((s) => s.k !== 'line');

  return (
    <svg
      ref={svgRef}
      className={`canvas tool-${tool.kind}`}
      viewBox={`0 0 ${box.w} ${box.h}`}
      // Top-aligned, not centred. A short wide surface — the penalty box, or a
      // landscape crop — is much shorter than the working area, and centring it
      // left the diagram floating in the middle with dead space above it.
      // Pointer coordinates come from the screen matrix, so they follow this
      // without any adjustment.
      preserveAspectRatio="xMidYMin meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(e) => {
        // Renumbering where the player is, rather than across the screen in a
        // panel. The first click of the pair has already selected it.
        if (!onEditShape || tool.kind !== 'select') return;
        const hit = hitTest(diagram, toSurface(e), kitSize);
        if (hit?.k === 'player' || hit?.k === 'text') onEditShape(hit.id, { x: e.clientX, y: e.clientY });
      }}
      role="application"
      aria-label="Diagram canvas"
    >
      {/* preserveAspectRatio scales and positions the user coordinate system;
          it does NOT clip to the viewBox. The pitch is always drawn full length,
          so on a cropped surface the rest of it bled into the spare element area
          and "Box" showed the halfway line. Clip to the visible box. */}
      <defs>
        <clipPath id="surface-clip">
          <rect x={0} y={0} width={box.w} height={box.h} />
        </clipPath>
      </defs>
      <g clipPath="url(#surface-clip)">
        <SurfaceSvg surface={diagram.surface} />
      </g>
      {/* Lines under tokens, so an arrow never covers the player it points at. */}
      {lines.map((l) =>
        l.k === 'line' ? (
          <LineMark key={l.id} diagram={diagram} line={l} selected={selected.has(l.id)} />
        ) : null,
      )}
      {rest.map((s) =>
        s.k === 'player' ? (
          <PlayerMark key={s.id} shape={s} colors={diagram.colors} />
        ) : s.k === 'kit' ? (
          <KitMark key={s.id} item={s.item} x={s.x} y={s.y} rot={s.rot} scale={s.scale} />
        ) : s.k === 'text' ? (
          <TextMark key={s.id} shape={s} selected={selected.has(s.id)} />
        ) : null,
      )}
      {snapTarget && (
        <circle
          cx={snapTarget.x}
          cy={snapTarget.y}
          r={34}
          className="snapRing"
        />
      )}
      {preview}
      {/* When several things are selected each one still gets a thin outline, so
          it stays obvious what is in the group; the handles belong to the frame
          around the lot rather than to any one member. */}
      {frame?.group &&
        diagram.shapes.map((sh) => {
          if (!selected.has(sh.id) || sh.k === 'line') return null;
          const b = chromeBox(sh, kitSize);
          return (
            <rect
              key={`m${sh.id}`}
              x={-b.w / 2}
              y={-b.h / 2}
              width={b.w}
              height={b.h}
              className="chromeMember"
              transform={`translate(${sh.x} ${sh.y}) rotate(${sh.rot})`}
            />
          );
        })}

      {/* The frame: a box, corner grips and the rotate knob above it. Rotating
          from the drawing itself keeps the gesture where the objects are rather
          than in a panel across the screen. */}
      {frame && (
        <g
          className="chrome"
          transform={`translate(${frame.pivot.x} ${frame.pivot.y}) rotate(${frame.rot})`}
        >
          {/* The interior carries the grab cursor, so the whole selection reads
              as one thing you can pick up. Hit-testing is done in surface
              coordinates, so this only affects the cursor. */}
          {frame.group && (
            <rect
              x={-frame.w / 2}
              y={-frame.h / 2}
              width={frame.w}
              height={frame.h}
              className="chromeGrab"
            />
          )}
          <rect
            x={-frame.w / 2}
            y={-frame.h / 2}
            width={frame.w}
            height={frame.h}
            className="chromeBox"
          />
          {[
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sy], i) => (
            <rect
              key={i}
              x={(sx * frame.w) / 2 - 4}
              y={(sy * frame.h) / 2 - 4}
              width={8}
              height={8}
              className="chromeCorner"
            />
          ))}
          <line
            x1={0}
            y1={-frame.h / 2}
            x2={0}
            y2={-frame.h / 2 - ROTATE_ARM + 8}
            className="chromeArm"
          />
          <circle cx={0} cy={-frame.h / 2 - ROTATE_ARM} r={9} className="chromeKnob" />
          <path
            d={`M -4.6 ${-frame.h / 2 - ROTATE_ARM - 1.4} A 4.6 4.6 0 1 1 -2.4 ${-frame.h / 2 - ROTATE_ARM + 3.6}`}
            className="chromeKnobIcon"
          />
          <path
            d={`M -7 ${-frame.h / 2 - ROTATE_ARM - 3.4} L -2.4 ${-frame.h / 2 - ROTATE_ARM - 2.2} L -4.2 ${-frame.h / 2 - ROTATE_ARM + 1.6} Z`}
            className="chromeKnobArrow"
          />
        </g>
      )}

      {/* Line handles last, so they sit above every stroke and token. */}
      {diagram.shapes.map((l) => {
        if (l.k !== 'line' || !selected.has(l.id)) return null;
        const { a, b } = lineEnds(diagram, l);
        const c = controlPoint(a, b, l.bend);
        const mid = pointOnCurve(a, c, b, 0.5);
        return (
          <g key={`h${l.id}`} className="handles">
            <circle cx={a.x} cy={a.y} r={7} className="handle" />
            <circle cx={b.x} cy={b.y} r={7} className="handle" />
            <circle cx={mid.x} cy={mid.y} r={6} className="handle handleBend" />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Deleting a player releases any line attached to it, freezing that end where it
 * was last drawn. Deleting the line too would destroy work nobody asked to lose.
 */
export function deleteShapes(diagram: Diagram, ids: ReadonlySet<string>): Diagram {
  if (ids.size === 0) return diagram;
  const goingPlayers = new Set(
    diagram.shapes.filter((s) => s.k === 'player' && ids.has(s.id)).map((s) => s.id),
  );
  const shapes = diagram.shapes
    .filter((s) => !ids.has(s.id))
    .map((s) => {
      if (s.k !== 'line') return s;
      const releaseFrom = isRef(s.from) && goingPlayers.has(s.from.ref);
      const releaseTo = isRef(s.to) && goingPlayers.has(s.to.ref);
      if (!releaseFrom && !releaseTo) return s;
      const { a, b } = lineEnds(diagram, s);
      return {
        ...s,
        from: releaseFrom ? { ...a } : s.from,
        to: releaseTo ? { ...b } : s.to,
        lastFrom: { ...a },
        lastTo: { ...b },
      };
    });
  return { ...diagram, shapes };
}
