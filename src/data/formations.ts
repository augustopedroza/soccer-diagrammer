import type { Team } from '../types/diagram';

/**
 * Starting shapes, as rows of shirt numbers from the back line forward.
 *
 * Numbers follow the usual continental convention — 1 in goal, 2 and 3 the full
 * backs, 4 and 5 centre backs, 6 holding, 7 and 11 wide, 9 centre forward, 10
 * between the lines. Each row reads left to right as the viewer sees it.
 *
 * A template is a starting point, not a prescription: everything it drops is an
 * ordinary player token you can move, delete or renumber afterwards.
 */
export interface Formation {
  id: string;
  label: string;
  /** Outfield rows, back to front. The goalkeeper is added separately. */
  rows: number[][];
}

export const FORMATIONS: Formation[] = [
  { id: '4-3-3', label: '4-3-3', rows: [[3, 5, 4, 2], [8, 6, 10], [11, 9, 7]] },
  { id: '4-4-2', label: '4-4-2', rows: [[3, 5, 4, 2], [11, 8, 6, 7], [10, 9]] },
  { id: '4-2-3-1', label: '4-2-3-1', rows: [[3, 5, 4, 2], [6, 8], [11, 10, 7], [9]] },
  { id: '4-1-4-1', label: '4-1-4-1', rows: [[3, 5, 4, 2], [6], [11, 8, 10, 7], [9]] },
  { id: '3-5-2', label: '3-5-2', rows: [[5, 4, 6], [3, 8, 10, 2], [11, 9]] },
];

/** Depth of each band, as a fraction of the box measured from the own goal. */
const KEEPER_DEPTH = 0.94;
const BACK_DEPTH = 0.78;
const FRONT_DEPTH = 0.3;

export interface Placement {
  number: number;
  /** 0..1 across the box, left to right as drawn. */
  fx: number;
  /** 0..1 down the box, 0 at the top. */
  fy: number;
}

/**
 * Positions for one team, as fractions of the visible box.
 *
 * Your team attacks up the page, so its goalkeeper sits at the bottom and the
 * shape builds upward. The opposition is the same shape mirrored, which is what
 * makes two templates on one pitch read as a match rather than as two teams
 * facing the same way.
 */
export function placements(formation: Formation, team: Team): Placement[] {
  const out: Placement[] = [{ number: 1, fx: 0.5, fy: KEEPER_DEPTH }];

  const bands = formation.rows.length;
  formation.rows.forEach((row, i) => {
    const t = bands === 1 ? 0 : i / (bands - 1);
    const fy = BACK_DEPTH + (FRONT_DEPTH - BACK_DEPTH) * t;
    row.forEach((number, j) => {
      // Inset from the touchlines so wide players are not drawn on the line.
      const fx = row.length === 1 ? 0.5 : 0.12 + (0.76 * j) / (row.length - 1);
      out.push({ number, fx, fy });
    });
  });

  if (team === 'own') return out;
  // Mirror end to end, and left to right with it, so numbering stays correct
  // from that team's own point of view.
  return out.map((p) => ({ ...p, fx: 1 - p.fx, fy: 1 - p.fy }));
}
