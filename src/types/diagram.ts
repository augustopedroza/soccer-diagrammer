/**
 * A training-session diagram.
 *
 * Coordinates are 0–1000 normalized to the surface box, never pixels, so a
 * diagram drawn on a laptop renders identically on a phone, in print and in an
 * exported image.
 */

export type Sport = 'soccer' | 'futsal';
export type Crop = 'full' | 'three-quarter' | 'half' | 'penalty-box';
export type Facing = 'up' | 'down' | 'left' | 'right';
export type SurfaceStyle = 'shaded' | 'line';

export interface Surface {
  sport: Sport;
  crop: Crop;
  facing: Facing;
  style: SurfaceStyle;
}

/**
 * The four standard coaching line types. Each carries a meaning, and the stroke
 * follows from it — a coach picks the action, not the appearance.
 */
export type LineType = 'pass' | 'dribble' | 'run' | 'tactical';

export type Team = 'own' | 'opp';

/** Either a fixed point on the surface, or a player this end follows. */
export type Endpoint = { x: number; y: number } | { ref: string };

export interface PlayerShape {
  k: 'player';
  id: string;
  team: Team;
  number: number;
  x: number;
  y: number;
}

export interface LineShape {
  k: 'line';
  id: string;
  type: LineType;
  from: Endpoint;
  to: Endpoint;
  /** Perpendicular bow, in surface units. 0 is a straight line. */
  bend: number;
  /** Last resolved position of each end, so an anchor can be released safely. */
  lastFrom: { x: number; y: number };
  lastTo: { x: number; y: number };
}

export interface KitShape {
  k: 'kit';
  id: string;
  item: string;
  x: number;
  y: number;
}

export type Shape = PlayerShape | LineShape | KitShape;

/** Kit colours. Shape still distinguishes the teams, so a diagram survives
 *  being printed in grey or read by someone who cannot separate two hues. */
export interface TeamColors {
  own: string;
  opp: string;
}

export interface Diagram {
  title: string;
  surface: Surface;
  colors: TeamColors;
  shapes: Shape[];
}

/**
 * Shapes are stored in the surface's own box, whose size comes from
 * `surfaceBox()`. These are only the outer bounds used for validation — a
 * coordinate can never exceed the longest a box can be.
 */
export const MAX_COORD = 1000;

export function isRef(e: Endpoint): e is { ref: string } {
  return 'ref' in e;
}
