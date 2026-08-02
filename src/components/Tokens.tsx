import { equipmentSpec } from '../data/equipment';
import { DEFAULT_COLORS, inkOn, lineSpec } from '../data/notation';
import {
  angleOnCurve,
  controlPoint,
  lineEnds,
  pointOnCurve,
  trimToTokens,
  wavyPath,
  type Point,
} from '../lib/geometry';
import { isRef, type Diagram, type LineShape, type PlayerShape, type Team } from '../types/diagram';

/**
 * Player tokens.
 *
 * Your team is a triangle pointing UP — the same direction the notation has your
 * team attacking, so the token itself carries the direction of play. The
 * opposition is a disc, which attacks down.
 *
 * Two shapes rather than two colours, so a diagram survives being printed in
 * grey or read by someone who cannot separate the two hues.
 */
export function PlayerToken({
  team,
  number,
  x,
  y,
  selected,
  colors = DEFAULT_COLORS,
}: {
  team: Team;
  number: number;
  x: number;
  y: number;
  selected?: boolean;
  colors?: { own: string; opp: string };
}) {
  const r = 24;
  const fill = team === 'own' ? colors.own : colors.opp;

  // An equilateral triangle about the token centre, corners softened so it does
  // not read as a hazard sign next to the opposition disc.
  const tri = (() => {
    const R = r * 1.42;
    const pts = [-90, 30, 150].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R };
    });
    const k = 0.16;
    let d = '';
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      const prev = pts[(i + 2) % 3];
      const next = pts[(i + 1) % 3];
      const a = { x: p.x + (prev.x - p.x) * k, y: p.y + (prev.y - p.y) * k };
      const b = { x: p.x + (next.x - p.x) * k, y: p.y + (next.y - p.y) * k };
      d += `${i === 0 ? 'M' : 'L'}${a.x.toFixed(1)},${a.y.toFixed(1)} Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} `;
    }
    return `${d}Z`;
  })();

  return (
    <g transform={`translate(${x} ${y})`} className="token">
      {selected && <circle r={r + 8} className="selRing" />}
      {team === 'own' ? <path d={tri} fill={fill} /> : <circle r={r} fill={fill} />}
      <text
        // A triangle is widest near its base, so the number sits below the
        // centroid where there is room for two digits.
        y={team === 'own' ? 10 : 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={inkOn(fill)}
        fontSize={team === 'own' ? 17 : 22}
        fontWeight={700}
      >
        {number}
      </text>
    </g>
  );
}

/** Arrow head, drawn as a filled triangle so it scales and prints cleanly. */
function ArrowHead({ at, angle, fill }: { at: Point; angle: number; fill: string }) {
  return (
    <path
      d="M0,0 L-17,-8 L-17,8 Z"
      fill={fill}
      transform={`translate(${at.x} ${at.y}) rotate(${angle})`}
    />
  );
}

export function LineMark({
  diagram,
  line,
  selected,
}: {
  diagram: Diagram;
  line: LineShape;
  selected?: boolean;
}) {
  const spec = lineSpec(line.type);
  const { a, b } = lineEnds(diagram, line);
  // Pull the ends back off any token they are attached to, or the arrow head
  // vanishes underneath the player it is pointing at.
  const trimmed = trimToTokens(a, b, isRef(line.from), isRef(line.to));
  const c = controlPoint(trimmed.a, trimmed.b, line.bend);
  const head = pointOnCurve(trimmed.a, c, trimmed.b, 1);
  const angle = angleOnCurve(trimmed.a, c, trimmed.b, 1);

  const d = spec.wavy
    ? wavyPath(trimmed.a, c, trimmed.b)
    : `M${trimmed.a.x},${trimmed.a.y} Q${c.x},${c.y} ${trimmed.b.x},${trimmed.b.y}`;

  return (
    <g className="lineMark">
      {selected && (
        <path d={d} fill="none" stroke="#2f80ed" strokeWidth={11} strokeOpacity={0.28} />
      )}
      <path
        d={d}
        fill="none"
        stroke={spec.stroke}
        strokeWidth={3.5}
        strokeDasharray={spec.dash}
        strokeLinecap="round"
      />
      <ArrowHead at={head} angle={angle} fill={spec.stroke} />
    </g>
  );
}

/** Equipment, all inline so the app makes no requests and needs no assets. */
export function KitMark({
  item,
  x,
  y,
  selected,
}: {
  item: string;
  x: number;
  y: number;
  selected?: boolean;
}) {
  const spec = equipmentSpec(item);
  if (!spec) return null;
  const { w, h } = spec;
  const orange = '#e8761f';
  const stroke = '#1d232b';

  const body = () => {
    // Drawn top-down with a low, consistent light source, so a diagram reads as
    // a plan view rather than a mix of icons borrowed from different sets.
    switch (item) {
      case 'goal':
      case 'mini-goal': {
        const d = h * 0.55;
        return (
          <>
            <path d={`M${-w / 2},${h / 2} L${-w / 2 + d * 0.35},${-h / 2} L${w / 2 - d * 0.35},${-h / 2} L${w / 2},${h / 2} Z`} fill="#fff" fillOpacity={0.5} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
            {Array.from({ length: 7 }, (_, i) => {
              const t = (i + 1) / 8;
              return <line key={`v${i}`} x1={-w / 2 + w * t} y1={h / 2} x2={-w / 2 + d * 0.35 + (w - d * 0.7) * t} y2={-h / 2} stroke={stroke} strokeWidth={0.7} strokeOpacity={0.5} />;
            })}
            {Array.from({ length: 3 }, (_, i) => {
              const t = (i + 1) / 4;
              const inset = d * 0.35 * t;
              return <line key={`h${i}`} x1={-w / 2 + inset} y1={h / 2 - h * t} x2={w / 2 - inset} y2={h / 2 - h * t} stroke={stroke} strokeWidth={0.7} strokeOpacity={0.5} />;
            })}
            <line x1={-w / 2} y1={h / 2} x2={w / 2} y2={h / 2} stroke={stroke} strokeWidth={2.6} />
          </>
        );
      }
      case 'inside-goal':
        return (
          <>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} fill="#fff" fillOpacity={0.5} stroke={stroke} strokeWidth={2} />
            {Array.from({ length: 6 }, (_, i) => (
              <line key={i} x1={-w / 2 + ((i + 1) * w) / 7} y1={-h / 2} x2={-w / 2 + ((i + 1) * w) / 7} y2={h / 2} stroke={stroke} strokeWidth={0.7} strokeOpacity={0.5} />
            ))}
            <line x1={-w / 2} y1={h / 2} x2={w / 2} y2={h / 2} stroke={stroke} strokeWidth={2.6} />
          </>
        );
      case 'goal-toppled':
      case 'mini-goal-toppled':
        return (
          <>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill="#e6eaef" stroke={stroke} strokeWidth={2} />
            <line x1={-w / 2 + 4} y1={0} x2={w / 2 - 4} y2={0} stroke={stroke} strokeWidth={1} strokeOpacity={0.45} strokeDasharray="4 3" />
          </>
        );
      case 'ball':
        return (
          <>
            <circle r={w / 2} fill="#fff" stroke={stroke} strokeWidth={1.8} />
            <path d="M0,-6.5 L6.2,-2 L3.8,5.3 L-3.8,5.3 L-6.2,-2 Z" fill={stroke} />
            {[0, 72, 144, 216, 288].map((a) => (
              <line key={a} x1={0} y1={0} x2={Math.sin((a * Math.PI) / 180) * 12} y2={-Math.cos((a * Math.PI) / 180) * 12}
                stroke={stroke} strokeWidth={1.5} transform="rotate(36)" strokeOpacity={0.85} />
            ))}
          </>
        );
      case 'cap':
        return (
          <>
            <ellipse rx={w / 2} ry={h / 2} fill={orange} stroke={stroke} strokeWidth={1.4} />
            <ellipse rx={w / 2 - 4} ry={h / 2 - 3} fill="#fff" fillOpacity={0.28} />
          </>
        );
      case 'cone':
        return (
          <>
            <ellipse cy={h / 2 - 3} rx={w / 2} ry={4.5} fill="#c25c12" />
            <path d={`M0,${-h / 2} Q${w * 0.16},${-h * 0.1} ${w / 2 - 1},${h / 2 - 4} Q0,${h / 2 + 2} ${-w / 2 + 1},${h / 2 - 4} Q${-w * 0.16},${-h * 0.1} 0,${-h / 2} Z`} fill={orange} stroke={stroke} strokeWidth={1.2} />
            <path d={`M-2,${-h / 2 + 2} Q${-w * 0.12},${h * 0.1} ${-w * 0.22},${h / 2 - 5}`} stroke="#fff" strokeOpacity={0.45} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          </>
        );
      case 'dummy':
        return (
          <>
            <ellipse cy={h / 2 - 2} rx={w / 2} ry={4} fill="#2c2f36" fillOpacity={0.35} />
            <path d={`M0,${-h / 2} a7.5,7.5 0 0 1 0,15 l${w * 0.28},${h * 0.5} a4,4 0 0 1 -4,4 l${-w * 0.56},0 a4,4 0 0 1 -4,-4 Z`} fill={orange} stroke={stroke} strokeWidth={1.3} strokeLinejoin="round" />
          </>
        );
      case 'ladder':
        return (
          <>
            <line x1={-w / 2} y1={-h / 2 + 2} x2={w / 2} y2={-h / 2 + 2} stroke={orange} strokeWidth={2.6} />
            <line x1={-w / 2} y1={h / 2 - 2} x2={w / 2} y2={h / 2 - 2} stroke={orange} strokeWidth={2.6} />
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1={-w / 2 + (i * w) / 7} y1={-h / 2 + 2} x2={-w / 2 + (i * w) / 7} y2={h / 2 - 2} stroke={orange} strokeWidth={2.2} />
            ))}
          </>
        );
      case 'pole':
        return (
          <>
            <ellipse cy={h / 2 - 2} rx={9} ry={4} fill="#2c2f36" fillOpacity={0.3} />
            <rect x={-w / 2} y={-h / 2} width={w} height={h - 3} rx={5} fill="#dfe4ea" stroke={stroke} strokeWidth={1.3} />
            {[0.25, 0.55, 0.85].map((t) => (
              <rect key={t} x={-w / 2} y={-h / 2 + (h - 3) * t} width={w} height={(h - 3) * 0.12} fill={orange} />
            ))}
          </>
        );
      case 'ring':
        return (
          <>
            <ellipse rx={w / 2} ry={h / 2} fill="none" stroke={orange} strokeWidth={4} />
            <ellipse rx={w / 2} ry={h / 2} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1.4} />
          </>
        );
      case 'mat':
        return (
          <>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill="#1f6fb2" stroke={stroke} strokeWidth={1.4} />
            <rect x={-w / 2 + 4} y={-h / 2 + 4} width={w - 8} height={h - 8} rx={2} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1.2} />
          </>
        );
      case 'flag':
        return (
          <>
            <ellipse cy={h / 2 - 2} rx={7} ry={3.5} fill="#2c2f36" fillOpacity={0.3} />
            <line x1={-w / 2 + 4} y1={-h / 2} x2={-w / 2 + 4} y2={h / 2 - 2} stroke="#8a9099" strokeWidth={2.6} strokeLinecap="round" />
            <path d={`M${-w / 2 + 5},${-h / 2 + 1} L${w / 2 - 1},${-h / 2 + 9} L${-w / 2 + 5},${-h / 2 + 17} Z`} fill={orange} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
          </>
        );
      case 'bench':
        return (
          <>
            <rect x={-w / 2} y={-h / 2} width={w} height={h * 0.5} rx={2.5} fill="#d0a05a" stroke={stroke} strokeWidth={1.3} />
            <line x1={-w / 2 + 3} y1={-h / 2 + h * 0.25} x2={w / 2 - 3} y2={-h / 2 + h * 0.25} stroke={stroke} strokeOpacity={0.3} strokeWidth={1} />
            {[-1, 1].map((sx) => (
              <line key={sx} x1={sx * (w / 2 - 9)} y1={0} x2={sx * (w / 2 - 9)} y2={h / 2} stroke="#8a9099" strokeWidth={2.6} strokeLinecap="round" />
            ))}
          </>
        );
      default:
        return <circle r={Math.min(w, h) / 2} fill={orange} stroke={stroke} strokeWidth={1.4} />;
    }
  };

  return (
    <g transform={`translate(${x} ${y})`} className="token">
      {selected && <rect x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} className="selRing" rx={5} />}
      {body()}
    </g>
  );
}

export function PlayerMark({
  shape,
  selected,
  colors,
}: {
  shape: PlayerShape;
  selected?: boolean;
  colors: { own: string; opp: string };
}) {
  return (
    <PlayerToken
      team={shape.team}
      number={shape.number}
      x={shape.x}
      y={shape.y}
      selected={selected}
      colors={colors}
    />
  );
}
