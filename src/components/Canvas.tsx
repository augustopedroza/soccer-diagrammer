import { useRef, useState } from 'react';
import { equipmentSpec } from '../data/equipment';
import { lineSpec } from '../data/notation';
import { surfaceBox } from '../lib/surfaceBox';
import {
  bendFor,
  clampToBox,
  controlPoint,
  dist,
  hitTest,
  lineEnds,
  playerAt,
  pointOnCurve,
  trimToTokens,
  wavyPath,
  type Point,
} from '../lib/geometry';
import { TEXT_SIZES, isRef, type Diagram, type LineType, type Shape, type Team } from '../types/diagram';
import { SurfaceSvg } from './Surface';
import { KitMark, LineMark, PlayerMark, TextMark } from './Tokens';

export type Tool =
  | { kind: 'select' }
  | { kind: 'player'; team: Team; number: number }
  | { kind: 'line'; type: LineType }
  | { kind: 'kit'; item: string }
  | { kind: 'text' };

interface Drag {
  mode: 'line' | 'move' | 'marquee' | 'endpoint' | 'bend' | 'rotate';
  start: Point;
  now: Point;
  shift: boolean;
  /** Sampled pointer path, used to read the bow out of a Shift drag. */
  path: Point[];
  /** For endpoint and bend drags: which line, and which end of it. */
  lineId?: string;
  end?: 'from' | 'to';
  /** For a rotate drag: the pointer angle it started at, and the angles then. */
  fromAngle?: number;
  rotWas?: Record<string, number>;
}

/** Half-size of the selection box around a shape, in surface units. */
const CHROME_PAD = 6;
/** How far above the box the rotate handle floats. */
const ROTATE_ARM = 26;

const angleAt = (cx: number, cy: number, p: Point) =>
  (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;

/** How close a click has to be to a handle to grab it. */
const HANDLE_GRAB = 16;

let seq = 0;
const nextId = (p: string) => `${p}${++seq}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * The bow of a Shift drag, taken from how far the pointer strayed from the
 * straight line between where the drag started and where it ended.
 *
 * Reading it from the release point instead — which is what this did first —
 * always gives zero, because the release point is by definition on the chord.
 * So Shift appeared to do nothing.
 */
function bendFromPath(path: Point[], a: Point, b: Point): number {
  let best = 0;
  for (const p of path) {
    const d = bendFor(a, b, p);
    if (Math.abs(d) > Math.abs(best)) best = d;
  }
  return best;
}

/** The box drawn around a selected token, and used to place its rotate knob. */
function chromeBox(
  sh: { k: string; item?: string },
  kitSize: (id: string) => Point,
): { w: number; h: number } {
  if (sh.k === 'kit' && sh.item) {
    const { x: w, y: h } = kitSize(sh.item);
    return { w: w + CHROME_PAD * 2, h: h + CHROME_PAD * 2 };
  }
  // A player triangle is a little taller than it is wide.
  return { w: 60 + CHROME_PAD, h: 64 + CHROME_PAD };
}

export function Canvas({
  diagram,
  tool,
  selected,
  onSelect,
  onChange,
  onToolUsed,
}: {
  diagram: Diagram;
  tool: Tool;
  selected: ReadonlySet<string>;
  onSelect: (ids: ReadonlySet<string>) => void;
  onChange: (next: Diagram, commit: boolean) => void;
  onToolUsed: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
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

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toSurface(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (tool.kind === 'player' || tool.kind === 'kit' || tool.kind === 'text') {
      const shape: Shape =
        tool.kind === 'player'
          ? { k: 'player', id: nextId('p'), team: tool.team, number: tool.number, rot: 0, ...p }
          : tool.kind === 'kit'
            ? { k: 'kit', id: nextId('k'), item: tool.item, rot: 0, ...p }
            : { k: 'text', id: nextId('t'), text: 'Label', size: TEXT_SIZES[1], ...p };
      onChange({ ...diagram, shapes: [...diagram.shapes, shape] }, true);
      onSelect(new Set([shape.id]));
      onToolUsed();
      return;
    }

    if (tool.kind === 'line') {
      setDrag({ mode: 'line', start: p, now: p, shift: e.shiftKey, path: [p] });
      return;
    }

    // The rotate handle floats above a selected token and sits on top of
    // everything, so it is tested first.
    for (const sh of diagram.shapes) {
      if (!selected.has(sh.id) || (sh.k !== 'player' && sh.k !== 'kit')) continue;
      const b = chromeBox(sh, kitSize);
      const knob = { x: sh.x, y: sh.y - b.h / 2 - ROTATE_ARM };
      if (dist(p, knob) <= HANDLE_GRAB) {
        const rotWas: Record<string, number> = {};
        for (const t of diagram.shapes) {
          if (selected.has(t.id) && (t.k === 'player' || t.k === 'kit')) rotWas[t.id] = t.rot;
        }
        setDrag({
          mode: 'rotate',
          start: p,
          now: p,
          shift: e.shiftKey,
          path: [p],
          lineId: sh.id,
          fromAngle: angleAt(sh.x, sh.y, p),
          rotWas,
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

    const hit = hitTest(diagram, p, kitSize);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (!hit) {
      // Empty space starts a marquee. Without a modifier it also clears, so a
      // stray click does not silently keep an old selection alive.
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
    // Lines are positioned by their ends, so there is nothing to drag on one
    // directly — selecting it is the whole gesture.
    if (hit.k !== 'line') setDrag({ mode: 'move', start: p, now: p, shift: false, path: [p] });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toSurface(e);

    if (drag.mode === 'rotate' && drag.lineId && drag.rotWas && drag.fromAngle !== undefined) {
      const pivot = diagram.shapes.find((sh) => sh.id === drag.lineId);
      if (pivot && (pivot.k === 'player' || pivot.k === 'kit')) {
        const delta = angleAt(pivot.x, pivot.y, p) - drag.fromAngle;
        onChange(
          {
            ...diagram,
            shapes: diagram.shapes.map((sh) => {
              if (!(sh.k === 'player' || sh.k === 'kit')) return sh;
              const was = drag.rotWas?.[sh.id];
              if (was === undefined) return sh;
              // Shift snaps to 15 degrees, the way most editors do.
              const raw = was + delta;
              const snapped = e.shiftKey ? Math.round(raw / 15) * 15 : raw;
              return { ...sh, rot: ((snapped % 360) + 360) % 360 };
            }),
          },
          false,
        );
      }
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
            return { ...sh, bend: bendFor(a, b, p) };
          }),
        },
        false,
      );
    }

    if (drag.mode === 'move') {
      const dx = p.x - drag.now.x;
      const dy = p.y - drag.now.y;
      onChange(
        {
          ...diagram,
          shapes: diagram.shapes.map((s) =>
            selected.has(s.id) && (s.k === 'player' || s.k === 'kit' || s.k === 'text')
              ? { ...s, ...clampToBox({ x: s.x + dx, y: s.y + dy }, box) }
              : s,
          ),
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
        const shape: Shape = {
          k: 'line',
          id: nextId('l'),
          type: tool.type,
          from: fromPlayer ? { ref: fromPlayer.id } : { ...drag.start },
          to: toPlayer ? { ref: toPlayer.id } : { ...p },
          bend: drag.shift ? bendFromPath(drag.path, drag.start, p) : 0,
          lastFrom: { ...drag.start },
          lastTo: { ...p },
        };
        onChange({ ...diagram, shapes: [...diagram.shapes, shape] }, true);
        // Deliberately NOT selected: the tool stays armed for the next line, and
        // leaving it selected would make the next keystroke retype it instead of
        // starting a new one.
        onSelect(new Set());
        onToolUsed();
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
    }

    if (drag.mode === 'rotate') onChange(diagram, true);
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
    const bend = drag.shift ? bendFromPath(drag.path, a, b) : 0;
    const t = trimToTokens(a, b, !!playerAt(diagram, a), !!playerAt(diagram, b));
    const c = controlPoint(t.a, t.b, bend);
    const head = pointOnCurve(t.a, c, t.b, 1);
    const d = spec.wavy
      ? wavyPath(t.a, c, t.b)
      : `M${t.a.x},${t.a.y} Q${c.x},${c.y} ${t.b.x},${t.b.y}`;
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
          <KitMark key={s.id} item={s.item} x={s.x} y={s.y} rot={s.rot} />
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
      {/* Selection chrome for tokens: a box, corner marks and the rotate knob
          above it. Rotating from the drawing itself keeps the gesture where the
          object is rather than in a panel across the screen. */}
      {diagram.shapes.map((sh) => {
        if (!selected.has(sh.id) || (sh.k !== 'player' && sh.k !== 'kit')) return null;
        const b = chromeBox(sh, kitSize);
        const x = sh.x - b.w / 2;
        const y = sh.y - b.h / 2;
        const knobY = y - ROTATE_ARM;
        return (
          <g key={`c${sh.id}`} className="chrome">
            <rect x={x} y={y} width={b.w} height={b.h} className="chromeBox" />
            {[
              [x, y],
              [x + b.w, y],
              [x, y + b.h],
              [x + b.w, y + b.h],
            ].map(([hx, hy], i) => (
              <rect key={i} x={hx - 4} y={hy - 4} width={8} height={8} className="chromeCorner" />
            ))}
            <line x1={sh.x} y1={y} x2={sh.x} y2={knobY + 8} className="chromeArm" />
            <circle cx={sh.x} cy={knobY} r={9} className="chromeKnob" />
            <path
              d={`M ${sh.x - 4.6} ${knobY - 1.4}
                  A 4.6 4.6 0 1 1 ${sh.x - 2.4} ${knobY + 3.6}`}
              className="chromeKnobIcon"
            />
            <path
              d={`M ${sh.x - 7} ${knobY - 3.4} L ${sh.x - 2.4} ${knobY - 2.2} L ${sh.x - 4.2} ${knobY + 1.6} Z`}
              className="chromeKnobArrow"
            />
          </g>
        );
      })}

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
