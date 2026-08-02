import { equipmentSpec } from '../data/equipment';
import { DEFAULT_COLORS, inkOn, lineSpec } from '../data/notation';
import {
  angleOnCurve,
  textBox,
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
  rot = 0,
  scale = 1,
  colors = DEFAULT_COLORS,
}: {
  team: Team;
  number: number;
  x: number;
  y: number;
  rot?: number;
  scale?: number;
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
    <g transform={`translate(${x} ${y}) scale(${scale})`} className="token">
      <g transform={`rotate(${rot})`}>
        {team === 'own' ? <path d={tri} fill={fill} /> : <circle r={r} fill={fill} />}
      </g>
      {/* The number stays upright however the token is turned — a rotated
          shirt number is unreadable, and it is the shape that carries facing. */}
      <text
        // A triangle is widest near its base, so the number sits below the
        // centroid where there is room for two digits.
        y={team === 'own' ? 6 : 1}
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
  rot = 0,
  scale = 1,
}: {
  item: string;
  x: number;
  y: number;
  rot?: number;
  scale?: number;
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
        // Drawn as a front elevation — posts, crossbar, netting and feet — which
        // is how a goal is recognisable at this size. A plan view of one is just
        // a rectangle with lines in it.
        const frame = '#2a3038';
        const mesh = '#2a3038';
        const foot = h * 0.16;
        const top = -h / 2;
        const ground = h / 2 - foot;
        const left = -w / 2;
        const right = w / 2;
        const cols = item === 'goal' ? 13 : 8;
        const rows = 4;
        return (
          <>
            <rect
              x={left}
              y={top}
              width={w}
              height={ground - top}
              fill="#fff"
              fillOpacity={0.5}
            />
            {Array.from({ length: cols - 1 }, (_, i) => {
              const x = left + (w * (i + 1)) / cols;
              return (
                <line key={`v${i}`} x1={x} y1={top} x2={x} y2={ground}
                  stroke={mesh} strokeWidth={0.5} strokeOpacity={0.5} />
              );
            })}
            {Array.from({ length: rows - 1 }, (_, i) => {
              const y = top + ((ground - top) * (i + 1)) / rows;
              return (
                <line key={`h${i}`} x1={left} y1={y} x2={right} y2={y}
                  stroke={mesh} strokeWidth={0.5} strokeOpacity={0.5} />
              );
            })}
            {/* Posts and crossbar over the netting. */}
            <path
              d={`M${left},${ground} L${left},${top} L${right},${top} L${right},${ground}`}
              fill="none"
              stroke={frame}
              strokeWidth={2.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* Ground line, then the feet the frame stands on. */}
            <line x1={left} y1={ground} x2={right} y2={ground}
              stroke={frame} strokeWidth={1.6} />
            {[left + 2, right - 2].map((x) => (
              <line key={x} x1={x} y1={ground} x2={x} y2={h / 2}
                stroke={frame} strokeWidth={2} strokeLinecap="round" />
            ))}
          </>
        );
      }
      case 'inside-goal': {
        // A small goal set inside the field, seen face on.
        const gy = h / 2 - 3;
        return (
          <>
            <rect x={-w / 2} y={-h / 2} width={w} height={gy + h / 2} fill="#fff" fillOpacity={0.45} />
            {Array.from({ length: 8 }, (_, i) => (
              <line key={`v${i}`} x1={-w / 2 + ((i + 1) * w) / 9} y1={-h / 2} x2={-w / 2 + ((i + 1) * w) / 9} y2={gy}
                stroke={stroke} strokeWidth={0.5} strokeOpacity={0.5} />
            ))}
            {[0.34, 0.68].map((t) => (
              <line key={t} x1={-w / 2} y1={-h / 2 + (gy + h / 2) * t} x2={w / 2} y2={-h / 2 + (gy + h / 2) * t}
                stroke={stroke} strokeWidth={0.5} strokeOpacity={0.5} />
            ))}
            <path d={`M${-w / 2},${gy} L${-w / 2},${-h / 2} L${w / 2},${-h / 2} L${w / 2},${gy}`}
              fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
            <line x1={-w / 2} y1={gy} x2={w / 2} y2={gy} stroke={stroke} strokeWidth={1.4} />
          </>
        );
      }
      case 'goal-toppled':
      case 'mini-goal-toppled': {
        // Flat on the grass: the frame from above with the net spread behind it.
        const barY = -h / 2 + 2;
        return (
          <>
            <rect x={-w / 2} y={barY} width={w} height={h - 4} fill="#fff" fillOpacity={0.32}
              stroke={stroke} strokeWidth={1} strokeDasharray="3 2" />
            {Array.from({ length: 7 }, (_, i) => (
              <line key={i} x1={-w / 2 + ((i + 1) * w) / 8} y1={barY} x2={-w / 2 + ((i + 1) * w) / 8} y2={h / 2 - 2}
                stroke={stroke} strokeWidth={0.5} strokeOpacity={0.45} />
            ))}
            {/* The crossbar, now lying along the near edge. */}
            <line x1={-w / 2} y1={barY} x2={w / 2} y2={barY} stroke={stroke} strokeWidth={3.2} strokeLinecap="round" />
            <line x1={-w / 2} y1={barY} x2={w / 2} y2={barY} stroke="#e8ecf1" strokeWidth={1.6} strokeLinecap="round" />
          </>
        );
      }
      case 'ball': {
        // A truncated icosahedron read from above: one black pentagon at the
        // centre, five more cut off by the rim, joined by the seams between.
        const R = w / 2;
        const pent = (cx: number, cy: number, rad: number, rot: number) =>
          Array.from({ length: 5 }, (_, i) => {
            const a = ((i * 72 + rot - 90) * Math.PI) / 180;
            return `${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`;
          }).join(' ');
        const clipId = `ball-${Math.round(R * 100)}`;
        return (
          <>
            <defs>
              <clipPath id={clipId}>
                <circle r={R - 0.8} />
              </clipPath>
            </defs>
            <circle r={R} fill="#fff" stroke={stroke} strokeWidth={1.6} />
            <g clipPath={`url(#${clipId})`}>
              <polygon points={pent(0, 0, R * 0.34, 0)} fill={stroke} />
              {Array.from({ length: 5 }, (_, i) => {
                const a = ((i * 72 - 90) * Math.PI) / 180;
                const cx = Math.cos(a) * R * 0.92;
                const cy = Math.sin(a) * R * 0.92;
                return (
                  <polygon
                    key={i}
                    points={pent(cx, cy, R * 0.34, i * 72 + 36)}
                    fill={stroke}
                  />
                );
              })}
              {Array.from({ length: 5 }, (_, i) => {
                const a = ((i * 72 - 90 + 36) * Math.PI) / 180;
                return (
                  <line
                    key={`s${i}`}
                    x1={Math.cos(a) * R * 0.32}
                    y1={Math.sin(a) * R * 0.32}
                    x2={Math.cos(a) * R}
                    y2={Math.sin(a) * R}
                    stroke={stroke}
                    strokeWidth={1.3}
                  />
                );
              })}
            </g>
          </>
        );
      }
      case 'cap':
        // A flat disc marker: a low dome sitting on a wider rim.
        return (
          <>
            <ellipse cy={1} rx={w / 2} ry={h / 2} fill="#c25c12" />
            <ellipse rx={w / 2} ry={h / 2} fill={orange} stroke={stroke} strokeWidth={1.1} />
            <ellipse cy={-1} rx={w / 2 - 5} ry={h / 2 - 4} fill="#fff" fillOpacity={0.3} />
          </>
        );
      case 'cone': {
        // A training cone in elevation: a narrow tapered body standing on a
        // wider base plate, with the usual reflective band. The body used to be
        // almost as wide as its base, which read as an orange blob rather than
        // as a cone.
        const baseY = h / 2 - 5;
        const bodyHalf = w * 0.3;
        const tipY = -h / 2 + 1;
        const clipId = `cone-${Math.round(w * 10)}`;
        const body = `M0,${tipY}
          C ${bodyHalf * 0.42},${tipY + h * 0.34} ${bodyHalf * 0.7},${baseY - h * 0.28} ${bodyHalf},${baseY}
          L ${-bodyHalf},${baseY}
          C ${-bodyHalf * 0.7},${baseY - h * 0.28} ${-bodyHalf * 0.42},${tipY + h * 0.34} 0,${tipY} Z`;
        return (
          <>
            <defs>
              <clipPath id={clipId}>
                <path d={body} />
              </clipPath>
            </defs>
            {/* Base plate, drawn first so the body sits on it. */}
            <rect
              x={-w / 2}
              y={baseY}
              width={w}
              height={5}
              rx={2}
              fill="#c25c12"
              stroke={stroke}
              strokeWidth={1}
            />
            <path d={body} fill={orange} stroke={stroke} strokeWidth={1.1} strokeLinejoin="round" />
            <g clipPath={`url(#${clipId})`}>
              <rect x={-w} y={-h * 0.06} width={w * 2} height={h * 0.2} fill="#fff" fillOpacity={0.82} />
              {/* A soft highlight down the lit side. */}
              <rect x={-bodyHalf} y={tipY} width={bodyHalf * 0.5} height={h} fill="#fff" fillOpacity={0.16} />
            </g>
          </>
        );
      }
      case 'dummy': {
        // A free-kick mannequin: head, tapered body, weighted base.
        const baseY = h / 2 - 4;
        return (
          <>
            <ellipse cy={baseY + 2} rx={w * 0.46} ry={3} fill="#1d232b" fillOpacity={0.28} />
            <path
              d={`M0,${-h / 2 + 11}
                  C ${w * 0.2},${-h / 2 + 13} ${w * 0.3},${h * 0.1} ${w * 0.34},${baseY}
                  L ${-w * 0.34},${baseY}
                  C ${-w * 0.3},${h * 0.1} ${-w * 0.2},${-h / 2 + 13} 0,${-h / 2 + 11} Z`}
              fill={orange}
              stroke={stroke}
              strokeWidth={1.1}
              strokeLinejoin="round"
            />
            <circle cy={-h / 2 + 7} r={6} fill={orange} stroke={stroke} strokeWidth={1.1} />
            <rect x={-w * 0.46} y={baseY} width={w * 0.92} height={4} rx={2} fill="#2a3038" />
          </>
        );
      }
      case 'ladder': {
        // An agility ladder lies flat, so it is drawn from above: two rails and
        // the rungs between them.
        const rungs = 7;
        return (
          <>
            {Array.from({ length: rungs }, (_, i) => {
              const x = -w / 2 + (w * (i + 1)) / (rungs + 1);
              return (
                <line key={i} x1={x} y1={-h / 2 + 1} x2={x} y2={h / 2 - 1}
                  stroke="#f2c14e" strokeWidth={2.4} strokeLinecap="round" />
              );
            })}
            {[-h / 2 + 1, h / 2 - 1].map((y) => (
              <line key={y} x1={-w / 2} y1={y} x2={w / 2} y2={y}
                stroke="#e0a828" strokeWidth={2.8} strokeLinecap="round" />
            ))}
          </>
        );
      }
      case 'pole': {
        // A slalom pole standing in its base.
        const baseY = h / 2 - 3;
        const bands = 4;
        return (
          <>
            <ellipse cy={baseY + 1} rx={w * 0.55} ry={2.6} fill="#1d232b" fillOpacity={0.25} />
            <rect x={-2} y={-h / 2} width={4} height={baseY + h / 2} rx={2} fill="#eceff3"
              stroke={stroke} strokeWidth={0.9} />
            {Array.from({ length: bands }, (_, i) => (
              <rect key={i} x={-2} y={-h / 2 + ((i * 2 + 1) * (baseY + h / 2)) / (bands * 2)}
                width={4} height={(baseY + h / 2) / (bands * 2)} fill={orange} />
            ))}
            <ellipse cy={baseY} rx={w * 0.5} ry={2.6} fill="#2a3038" />
          </>
        );
      }
      case 'ring': {
        // A flat agility ring on the grass.
        return (
          <>
            <ellipse rx={w / 2} ry={h / 2} fill="none" stroke="#1d232b" strokeWidth={5} strokeOpacity={0.18} />
            <ellipse rx={w / 2} ry={h / 2} fill="none" stroke={orange} strokeWidth={3.4} />
            <ellipse rx={w / 2} ry={h / 2} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1.1} />
          </>
        );
      }
      case 'mat':
        return (
          <>
            <rect x={-w / 2} y={-h / 2 + 2} width={w} height={h - 2} rx={4} fill="#155a91" />
            <rect x={-w / 2} y={-h / 2} width={w} height={h - 3} rx={4} fill="#2a80c4"
              stroke={stroke} strokeWidth={1} />
            <rect x={-w / 2 + 5} y={-h / 2 + 4} width={w - 10} height={h - 11} rx={2}
              fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1} />
          </>
        );
      case 'flag': {
        // A corner flag: pole, pennant with a fold, weighted foot.
        const poleX = -w / 2 + 5;
        const footY = h / 2 - 2;
        return (
          <>
            <ellipse cx={poleX} cy={footY + 1} rx={7} ry={2.6} fill="#1d232b" fillOpacity={0.25} />
            <line x1={poleX} y1={-h / 2} x2={poleX} y2={footY} stroke="#c9ced6" strokeWidth={2.4}
              strokeLinecap="round" />
            <path
              d={`M${poleX + 1},${-h / 2 + 1}
                  L ${w / 2},${-h / 2 + 8}
                  Q ${poleX + (w / 2 - poleX) * 0.55},${-h / 2 + 11} ${poleX + 1},${-h / 2 + 17} Z`}
              fill={orange}
              stroke={stroke}
              strokeWidth={0.9}
              strokeLinejoin="round"
            />
            <ellipse cx={poleX} cy={footY} rx={6} ry={2.6} fill="#2a3038" />
          </>
        );
      }
      case 'bench': {
        // A touchline bench from the side: seat, legs, a little shadow.
        const seatY = -h / 2 + 4;
        const seatH = h * 0.3;
        return (
          <>
            <rect x={-w / 2 + 3} y={h / 2 - 2} width={w - 6} height={2.5} rx={1.2}
              fill="#1d232b" fillOpacity={0.22} />
            {[-1, 1].map((sx) => (
              <rect key={sx} x={sx * (w / 2 - 12) - 1.6} y={seatY + seatH} width={3.2}
                height={h / 2 - seatY - seatH - 1} rx={1.4} fill="#8a9099" />
            ))}
            <rect x={-w / 2} y={seatY} width={w} height={seatH} rx={2.5} fill="#d8ab63"
              stroke={stroke} strokeWidth={1} />
            <line x1={-w / 2 + 3} y1={seatY + seatH * 0.55} x2={w / 2 - 3} y2={seatY + seatH * 0.55}
              stroke={stroke} strokeOpacity={0.22} strokeWidth={0.9} />
          </>
        );
      }
      default:
        return <circle r={Math.min(w, h) / 2} fill={orange} stroke={stroke} strokeWidth={1.4} />;
    }
  };

  return (
    <g transform={`translate(${x} ${y})`} className="token">
      <g transform={`rotate(${rot}) scale(${scale})`}>{body()}</g>
    </g>
  );
}

/**
 * A free label.
 *
 * Drawn with a white halo behind the glyphs via paint-order, so it stays
 * readable on dark grass, on a pale court and in line-art mode without needing
 * to know which surface is underneath.
 */
export function TextMark({
  shape,
  selected,
}: {
  shape: { x: number; y: number; text: string; size: number };
  selected?: boolean;
}) {
  const { w, h } = textBox(shape);
  return (
    <g className="token">
      {selected && (
        <rect
          x={shape.x - w / 2 - 6}
          y={shape.y - h / 2 - 4}
          width={w + 12}
          height={h + 8}
          rx={4}
          className="selRing"
        />
      )}
      <text
        x={shape.x}
        y={shape.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={shape.size}
        fontWeight={700}
        fill="#14171c"
        stroke="#fff"
        strokeWidth={shape.size * 0.18}
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {shape.text}
      </text>
    </g>
  );
}

export function PlayerMark({
  shape,
  colors,
}: {
  shape: PlayerShape;
  colors: { own: string; opp: string };
}) {
  return (
    <PlayerToken
      team={shape.team}
      number={shape.number}
      x={shape.x}
      y={shape.y}
      rot={shape.rot}
      scale={shape.scale}
      colors={colors}
    />
  );
}
