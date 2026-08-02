import type { LineType, Team } from '../types/diagram';

/**
 * Standard soccer coaching notation.
 *
 * These conventions — solid for a pass, dashed for a run off the ball, a wavy
 * line for carrying it, an arrow head at the end point — are long-standing and
 * near-universal in coach education. They are described here in this app's own
 * words rather than quoted from any one federation's handout.
 */

export interface LineSpec {
  type: LineType;
  /** Keyboard shortcut — the first letter of what the line stands for. */
  key: string;
  /** What the coach is drawing. The stroke follows from this, not the reverse. */
  label: string;
  /** One line of help, shown in the palette and the legend. */
  meaning: string;
  stroke: string;
  /** SVG dash pattern, or undefined for a continuous stroke. */
  dash?: string;
  /** True for the wavy stroke used when a player carries the ball. */
  wavy?: boolean;
}

export const LINE_SPECS: LineSpec[] = [
  {
    type: 'pass',
    key: 'p',
    label: 'Pass or shot',
    meaning: 'Solid line. Its length is the distance; the arrow head is where the ball ends up.',
    stroke: '#111418',
  },
  {
    type: 'dribble',
    key: 'd',
    label: 'Dribble',
    meaning: 'Wavy line. A player travelling with the ball at their feet.',
    stroke: '#111418',
    wavy: true,
  },
  {
    type: 'run',
    key: 'r',
    label: 'Run off the ball',
    meaning: 'Dashed line. Player movement without the ball.',
    stroke: '#111418',
    dash: '14 10',
  },
  {
    type: 'tactical',
    key: 't',
    label: 'Tactical arrow',
    meaning: "Solid red line. A player's area of influence, with or without the ball.",
    stroke: '#d21f3c',
  },
];

export const lineSpec = (t: LineType): LineSpec =>
  LINE_SPECS.find((s) => s.type === t) ?? LINE_SPECS[0];

export interface TeamSpec {
  team: Team;
  label: string;
  hint: string;
}

export const TEAM_SPECS: TeamSpec[] = [
  { team: 'own', label: 'Your team', hint: 'Attacks up the page' },
  { team: 'opp', label: 'Opposition', hint: 'Attacks down the page' },
];

/**
 * Shirt numbers grouped the way coaches name positions. Players are placed by
 * positional number so a diagram reads without a separate key.
 */
export const NUMBER_GROUPS: { name: string; numbers: number[] }[] = [
  { name: 'Goalkeeper', numbers: [1] },
  { name: 'Full backs', numbers: [2, 3] },
  { name: 'Centre backs', numbers: [4, 5] },
  { name: 'Midfielders', numbers: [6, 8, 10] },
  { name: 'Wide forwards', numbers: [7, 11] },
  { name: 'Centre forward', numbers: [9] },
];

export const ALL_NUMBERS: number[] = NUMBER_GROUPS.flatMap((g) => g.numbers);


/** Kit colours offered as presets. Any colour can still be picked directly. */
export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#1c6bba' },
  { name: 'Red', hex: '#d21f3c' },
  { name: 'Black', hex: '#1d232b' },
  { name: 'White', hex: '#f2f4f7' },
  { name: 'Yellow', hex: '#e8b21f' },
  { name: 'Green', hex: '#2e8b4f' },
  { name: 'Orange', hex: '#e8761f' },
  { name: 'Purple', hex: '#6b4fa8' },
];

export const DEFAULT_COLORS = { own: '#1c6bba', opp: '#d21f3c' };

/** Readable label colour for a given kit colour. */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  // Rec. 601 luma; light kits need dark numbers or they vanish.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#14171c' : '#ffffff';
}
