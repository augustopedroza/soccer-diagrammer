import { useRef, useState } from 'react';
import { equipmentSpec } from '../data/equipment';
import { lineSpec } from '../data/notation';
import { surfaceBox } from '../lib/surfaceBox';
import {
  bendFor,
  clampToBox,
  controlPoint,
  hitTest,
  lineEnds,
  playerAt,
  pointOnCurve,
  trimToTokens,
  wavyPath,
  type Point,
} from '../lib/geometry';
import { isRef, type Diagram, type LineType, type Shape, type Team } from '../types/diagram';
import { SurfaceSvg } from './Surface';
import { KitMark, LineMark, PlayerMark } from './Tokens';

export type Tool =
  | { kind: 'select' }
  | { kind: 'player'; team: Team; number: number }
  | { kind: 'line'; type: LineType }
  | { kind: 'kit'; item: string };

interface Drag {
  mode: 'line' | 'move' | 'marquee';
  start: Point;
  now: Point;
  shift: boolean;
  /** Sampled pointer path, used to read the bow out of a Shift drag. */
  path: Point[];
}

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

  const toSurface = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return clampToBox(
      { x: ((e.clientX - r.left) / r.width) * box.w, y: ((e.clientY - r.top) / r.height) * box.h },
      box,
    );
  };

  const kitSize = (id: string) => {
    const s = equipmentSpec(id);
    return { x: s?.w ?? 24, y: s?.h ?? 24 };
  };

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toSurface(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (tool.kind === 'player' || tool.kind === 'kit') {
      const shape: Shape =
        tool.kind === 'player'
          ? { k: 'player', id: nextId('p'), team: tool.team, number: tool.number, ...p }
          : { k: 'kit', id: nextId('k'), item: tool.item, ...p };
      onChange({ ...diagram, shapes: [...diagram.shapes, shape] }, true);
      onSelect(new Set([shape.id]));
      onToolUsed();
      return;
    }

    if (tool.kind === 'line') {
      setDrag({ mode: 'line', start: p, now: p, shift: e.shiftKey, path: [p] });
      return;
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
    setDrag({ mode: 'move', start: p, now: p, shift: false, path: [p] });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toSurface(e);

    if (drag.mode === 'move') {
      const dx = p.x - drag.now.x;
      const dy = p.y - drag.now.y;
      onChange(
        {
          ...diagram,
          shapes: diagram.shapes.map((s) =>
            selected.has(s.id) && (s.k === 'player' || s.k === 'kit')
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
        onSelect(new Set([shape.id]));
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

  const lines = diagram.shapes.filter((s) => s.k === 'line');
  const rest = diagram.shapes.filter((s) => s.k !== 'line');

  return (
    <svg
      ref={svgRef}
      className={`canvas tool-${tool.kind}`}
      viewBox={`0 0 ${box.w} ${box.h}`}
      style={{ aspectRatio: `${box.w} / ${box.h}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      role="application"
      aria-label="Diagram canvas"
    >
      <SurfaceSvg surface={diagram.surface} />
      {/* Lines under tokens, so an arrow never covers the player it points at. */}
      {lines.map((l) =>
        l.k === 'line' ? (
          <LineMark key={l.id} diagram={diagram} line={l} selected={selected.has(l.id)} />
        ) : null,
      )}
      {rest.map((s) =>
        s.k === 'player' ? (
          <PlayerMark key={s.id} shape={s} selected={selected.has(s.id)} colors={diagram.colors} />
        ) : s.k === 'kit' ? (
          <KitMark key={s.id} item={s.item} x={s.x} y={s.y} selected={selected.has(s.id)} />
        ) : null,
      )}
      {preview}
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
