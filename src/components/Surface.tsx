import {
  CROP_FRACTION,
  FULL_LENGTH,
  cropOffset,
  facingRotation,
  pitchBox,
  surfaceBox,
} from '../lib/surfaceBox';
import type { Sport, Surface } from '../types/diagram';

/**
 * Every playing surface from one component.
 *
 * The picker is the product of four axes — sport x crop x facing x style, about
 * thirty combinations. Drawing those by hand is how markings drift out of sync,
 * so all of them derive from one full-pitch drawing plus a crop and a rotation.
 * A penalty area is therefore the same penalty area in every variant.
 */

const GREEN_A = '#6cb45c';
const GREEN_B = '#7cc06c';
const COURT_A = '#8ea9d6';
const COURT_B = '#9fbae2';
const LINE = '#ffffff';
const INK = '#4a5462';

/**
 * Pitch markings, laid out from real metre dimensions.
 *
 * Both surfaces are drawn 1000 units long, so one metre is 1000/length units and
 * the same scale applies across the width — the box aspect already matches the
 * real pitch. Deriving every mark from metres is what stops a penalty area being
 * "about right": it is 16.5 m because that is what 16.5 m is.
 *
 * Soccer: 68 x 105 m (Law 1 preferred).
 * Futsal: 20 x 40 m, markings per FIFA Futsal Law 1.
 */
function Marks({ sport, stroke }: { sport: Sport; stroke: string }) {
  const { w, h } = pitchBox(sport);
  const cx = w / 2;
  const m = { fill: 'none', stroke, strokeWidth: 3.5, strokeLinejoin: 'round' as const };
  const dot = 4.5;

  if (sport === 'futsal') {
    const u = h / 40; // units per metre
    const post = (3.16 / 2) * u; // half the distance between the posts
    const areaR = 6 * u;
    const pen = 6 * u;
    const pen2 = 10 * u;
    const circleR = 3 * u;
    const corner = 0.25 * u;

    return (
      <g>
        <rect x={4} y={4} width={w - 8} height={h - 8} {...m} />
        <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2} {...m} />
        <circle cx={cx} cy={h / 2} r={circleR} {...m} />
        <circle cx={cx} cy={h / 2} r={dot} fill={stroke} stroke="none" />

        {[0, 1].map((end) => {
          const top = end === 0;
          const gl = top ? 4 : h - 4;
          const dir = top ? 1 : -1;
          // A quarter circle centred on each post, radius 6 m, joined across the
          // goal by a straight 3.16 m segment at that depth.
          const d = `M ${cx - post - areaR} ${gl}
                     A ${areaR} ${areaR} 0 0 ${top ? 0 : 1} ${cx - post} ${gl + areaR * dir}
                     L ${cx + post} ${gl + areaR * dir}
                     A ${areaR} ${areaR} 0 0 ${top ? 0 : 1} ${cx + post + areaR} ${gl}`;
          return (
            <g key={end}>
              <path d={d} {...m} />
              <circle cx={cx} cy={gl + pen * dir} r={dot} fill={stroke} stroke="none" />
              <circle cx={cx} cy={gl + pen2 * dir} r={dot} fill={stroke} stroke="none" />
            </g>
          );
        })}

        {[
          [4, 4, 1, 1],
          [w - 4, 4, -1, 1],
          [4, h - 4, 1, -1],
          [w - 4, h - 4, -1, -1],
        ].map(([x, y, sx, sy], i) => (
          <path
            key={i}
            d={`M ${x + corner * sx} ${y} A ${corner} ${corner} 0 0 ${sx === sy ? 0 : 1} ${x} ${y + corner * sy}`}
            {...m}
          />
        ))}

        {/* The 5 m corner reference mark, on the goal line at each corner. */}
        {[0, 1].flatMap((end) =>
          [-1, 1].map((side) => {
            const gl = end === 0 ? 4 : h - 4;
            const x = side < 0 ? 4 + 5 * u : w - 4 - 5 * u;
            const dir = end === 0 ? 1 : -1;
            return (
              <line
                key={`c${end}${side}`}
                x1={x}
                y1={gl}
                x2={x}
                y2={gl + 8 * dir}
                {...m}
                strokeWidth={2.5}
              />
            );
          }),
        )}

        {/* Substitution zones: 5 m either side of halfway, marked by ticks that
            cross the touch line. */}
        {[-1, 1].flatMap((side) =>
          [5, 10].map((d) => (
            <line
              key={`s${side}${d}`}
              x1={4 - 5}
              y1={h / 2 + d * u * side}
              x2={4 + 5}
              y2={h / 2 + d * u * side}
              {...m}
              strokeWidth={2.5}
            />
          )),
        )}
        {[-1, 1].flatMap((side) =>
          [5, 10].map((d) => (
            <line
              key={`s2${side}${d}`}
              x1={w - 4 - 5}
              y1={h / 2 + d * u * side}
              x2={w - 4 + 5}
              y2={h / 2 + d * u * side}
              {...m}
              strokeWidth={2.5}
            />
          )),
        )}
      </g>
    );
  }

  const u = h / 105; // units per metre
  const boxW = 40.32 * u;
  const boxH = 16.5 * u;
  const sixW = 18.32 * u;
  const sixH = 5.5 * u;
  const spot = 11 * u;
  const circleR = 9.15 * u;
  const corner = 1 * u;

  return (
    <g>
      <rect x={4} y={4} width={w - 8} height={h - 8} {...m} />
      <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2} {...m} />
      <circle cx={cx} cy={h / 2} r={circleR} {...m} />
      <circle cx={cx} cy={h / 2} r={dot} fill={stroke} stroke="none" />

      {[0, 1].map((end) => {
        const top = end === 0;
        const gl = top ? 4 : h - 4;
        const dir = top ? 1 : -1;
        const boxEdge = gl + boxH * dir;
        const spotY = gl + spot * dir;
        // The D is the part of the 9.15 m circle around the penalty spot that
        // falls outside the penalty area, so it is clipped at the box edge.
        const dx = Math.sqrt(Math.max(0, circleR * circleR - (boxH - spot) * (boxH - spot)));
        return (
          <g key={end}>
            <rect x={cx - boxW / 2} y={top ? gl : gl - boxH} width={boxW} height={boxH} {...m} />
            <rect x={cx - sixW / 2} y={top ? gl : gl - sixH} width={sixW} height={sixH} {...m} />
            <circle cx={cx} cy={spotY} r={dot} fill={stroke} stroke="none" />
            <path
              d={`M ${cx - dx} ${boxEdge} A ${circleR} ${circleR} 0 0 ${top ? 0 : 1} ${cx + dx} ${boxEdge}`}
              {...m}
            />
          </g>
        );
      })}

      {[
        [4, 4, 1, 1],
        [w - 4, 4, -1, 1],
        [4, h - 4, 1, -1],
        [w - 4, h - 4, -1, -1],
      ].map(([x, y, sx, sy], i) => (
        <path
          key={i}
          d={`M ${x + corner * sx} ${y} A ${corner} ${corner} 0 0 ${sx === sy ? 0 : 1} ${x} ${y + corner * sy}`}
          {...m}
        />
      ))}
    </g>
  );
}

export function SurfaceSvg({ surface }: { surface: Surface }) {
  const box = surfaceBox(surface);
  const pitch = pitchBox(surface.sport);
  const visibleH = FULL_LENGTH * CROP_FRACTION[surface.crop];
  const stroke = surface.style === 'line' ? INK : LINE;
  const [bandA, bandB] = surface.sport === 'soccer' ? [GREEN_A, GREEN_B] : [COURT_A, COURT_B];
  const bandH = FULL_LENGTH / 10;

  /**
   * One transform for all four facings.
   *
   * Move to the centre of the visible box, turn, then step back by half the
   * cropped pitch and slide the crop into place. Because every step is about
   * the centre, a rotated box — where width and height swap — falls out of the
   * same expression instead of needing its own case. The previous version
   * special-cased rotation with hand-tuned offsets, and left and right drew
   * off-screen entirely.
   */
  const transform = [
    `translate(${box.w / 2} ${box.h / 2})`,
    `rotate(${facingRotation(surface)})`,
    `translate(${-pitch.w / 2} ${-visibleH / 2})`,
    `translate(0 ${-cropOffset(surface)})`,
  ].join(' ');

  return (
    <g transform={transform}>
      {surface.style === 'shaded' ? (
        <>
          <rect x={0} y={0} width={pitch.w} height={FULL_LENGTH} fill={bandA} />
          {/* Bands run the length of the pitch and are cut by the crop, so the
              striping stays continuous rather than restarting per variant. */}
          {Array.from({ length: 10 }, (_, i) =>
            i % 2 === 1 ? (
              <rect key={i} x={0} y={i * bandH} width={pitch.w} height={bandH} fill={bandB} />
            ) : null,
          )}
        </>
      ) : (
        <rect x={0} y={0} width={pitch.w} height={FULL_LENGTH} fill="#fff" />
      )}
      <Marks sport={surface.sport} stroke={stroke} />
    </g>
  );
}
