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
