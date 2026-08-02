import type { Team } from '../types/diagram';

/**
 * Starting shapes, as explicit positions rather than tidy rows.
 *
 * Rows were the wrong model: a real shape is staggered. In a 4-3-3 the centre
 * backs sit deeper than the full backs, and the midfield is a triangle, not a
 * line. Interpolating evenly spaced bands produced something that looked like a
 * table of players rather than a team.
 *
 * Two rules hold across every shape here:
 *   - the 8 plays right and the 10 plays left, wherever both appear;
 *   - the 6 sits behind them and between them.
 *
 * `fx` runs 0..1 left to right as drawn; `fy` runs 0..1 from the far goal to
 * your own. A template is a starting point — everything it drops is an ordinary
 * token you can move, delete or renumber.
 */
export interface Placement {
  number: number;
  fx: number;
  fy: number;
}

export interface Formation {
  id: string;
  label: string;
  /**
   * How the central midfield is built.
   *
   * `triangle` is the 6 behind a 10 and an 8. `double-pivot` is the 6 and 8
   * paired with the 10 ahead of them — there the 10 is the furthest forward of
   * the three by definition, so the "6 between 10 and 8" rule cannot apply.
   * Instead the 6 holds the middle with the 8 close on its right.
   */
  midfield: 'triangle' | 'double-pivot';
  spots: Placement[];
}

const GK: Placement = { number: 1, fx: 0.5, fy: 0.93 };

/** Back four: centre backs deep, full backs pushed on. */
const BACK_FOUR: Placement[] = [
  { number: 5, fx: 0.34, fy: 0.85 },
  { number: 4, fx: 0.66, fy: 0.85 },
  { number: 3, fx: 0.14, fy: 0.72 },
  { number: 2, fx: 0.86, fy: 0.72 },
];

export const FORMATIONS: Formation[] = [
  {
    id: '4-3-3',
    midfield: 'triangle',
    label: '4-3-3',
    spots: [
      GK,
      ...BACK_FOUR,
      { number: 6, fx: 0.5, fy: 0.66 },
      { number: 10, fx: 0.36, fy: 0.5 },
      { number: 8, fx: 0.66, fy: 0.53 },
      { number: 11, fx: 0.13, fy: 0.35 },
      { number: 9, fx: 0.5, fy: 0.33 },
      { number: 7, fx: 0.88, fy: 0.35 },
    ],
  },
  {
    id: '4-4-2',
    midfield: 'triangle',
    label: '4-4-2',
    spots: [
      GK,
      ...BACK_FOUR,
      { number: 11, fx: 0.13, fy: 0.55 },
      { number: 6, fx: 0.38, fy: 0.6 },
      { number: 8, fx: 0.64, fy: 0.55 },
      { number: 7, fx: 0.88, fy: 0.55 },
      { number: 10, fx: 0.38, fy: 0.34 },
      { number: 9, fx: 0.62, fy: 0.32 },
    ],
  },
  {
    id: '4-2-3-1',
    midfield: 'double-pivot',
    label: '4-2-3-1',
    spots: [
      GK,
      ...BACK_FOUR,
      // A pivot is a pair, not two halves of the pitch: the 6 holds the middle
      // and the 8 plays just off its right shoulder.
      { number: 6, fx: 0.46, fy: 0.64 },
      { number: 8, fx: 0.62, fy: 0.62 },
      { number: 11, fx: 0.13, fy: 0.42 },
      { number: 10, fx: 0.5, fy: 0.45 },
      { number: 7, fx: 0.88, fy: 0.42 },
      { number: 9, fx: 0.5, fy: 0.28 },
    ],
  },
  {
    id: '4-1-4-1',
    midfield: 'triangle',
    label: '4-1-4-1',
    spots: [
      GK,
      ...BACK_FOUR,
      { number: 6, fx: 0.5, fy: 0.68 },
      { number: 11, fx: 0.13, fy: 0.48 },
      { number: 10, fx: 0.37, fy: 0.5 },
      { number: 8, fx: 0.65, fy: 0.48 },
      { number: 7, fx: 0.88, fy: 0.48 },
      { number: 9, fx: 0.5, fy: 0.3 },
    ],
  },
  {
    id: '3-5-2',
    midfield: 'triangle',
    label: '3-5-2',
    spots: [
      GK,
      { number: 5, fx: 0.28, fy: 0.84 },
      { number: 4, fx: 0.5, fy: 0.87 },
      { number: 3, fx: 0.72, fy: 0.84 },
      { number: 11, fx: 0.1, fy: 0.6 },
      { number: 2, fx: 0.9, fy: 0.6 },
      { number: 6, fx: 0.5, fy: 0.66 },
      { number: 10, fx: 0.36, fy: 0.5 },
      { number: 8, fx: 0.66, fy: 0.52 },
      { number: 9, fx: 0.42, fy: 0.3 },
      { number: 7, fx: 0.6, fy: 0.32 },
    ],
  },
];

/**
 * Small-sided games: N triangles against M discs.
 *
 * Nothing here is a formation — a 4v3 is a practice, not a shape, and the
 * players in one are whoever is standing there. So they go down **unnumbered**;
 * a number is something the coach adds when it means something.
 */
export interface SmallSided {
  own: number;
  opp: number;
}

export const MAX_SIDE = 11;

export const SMALL_SIDED: SmallSided[] = [
  { own: 1, opp: 1 },
  { own: 2, opp: 1 },
  { own: 2, opp: 2 },
  { own: 3, opp: 2 },
  { own: 3, opp: 3 },
  { own: 4, opp: 3 },
  { own: 4, opp: 4 },
  { own: 5, opp: 4 },
  { own: 5, opp: 5 },
];

export const sidedLabel = (s: SmallSided) => `${s.own}v${s.opp}`;

/**
 * Where N players of one side stand, as fractions of the visible box.
 *
 * Staggered rows rather than a line, deepest row first and carrying any odd
 * player, so a 3 reads as two behind one rather than as three in a row. Your
 * side fills the near half and the opposition the far one, which is what makes
 * a small-sided box read as a game rather than as a queue.
 */
export function smallSidedSpots(n: number, team: Team): { fx: number; fy: number }[] {
  const count = Math.max(1, Math.min(MAX_SIDE, Math.round(n)));
  const rows = Math.min(3, Math.ceil(count / 2));
  const per: number[] = [];
  const base = Math.floor(count / rows);
  let extra = count % rows;
  for (let r = 0; r < rows; r++) {
    per.push(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra--;
  }

  const out: { fx: number; fy: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const k = per[r];
    const fy = rows === 1 ? 0.72 : 0.86 - r * (0.3 / (rows - 1));
    for (let i = 0; i < k; i++) {
      out.push({ fx: k === 1 ? 0.5 : 0.2 + (i * 0.6) / (k - 1), fy });
    }
  }
  return team === 'own' ? out : out.map((p) => ({ fx: 1 - p.fx, fy: 1 - p.fy }));
}

/**
 * Positions for one team, as fractions of the visible box.
 *
 * Your team attacks up the page, so its keeper sits at the bottom. The
 * opposition is the same shape turned end to end, which is what makes two
 * templates on one pitch read as a match rather than as two teams facing the
 * same way. Mirroring both axes keeps each team's own left and right correct
 * from its own point of view.
 */
export function placements(formation: Formation, team: Team): Placement[] {
  if (team === 'own') return formation.spots;
  return formation.spots.map((p) => ({ ...p, fx: 1 - p.fx, fy: 1 - p.fy }));
}
