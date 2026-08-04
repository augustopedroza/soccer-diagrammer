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
  /**
   * Shirt number, or null for a blank token.
   *
   * Blank is a real state, not a missing value. A 4v3 has four attackers, not
   * the 2, 6, 8 and 10 — numbering them would claim positions the practice does
   * not specify.
   */
  number: number | null;
  x: number;
  y: number;
  /** Degrees clockwise. A rotated triangle shows which way a player faces. */
  rot: number;
  /** Multiplier on the token's size. */
  scale: number;
  /**
   * This player's own colour, overriding the team kit. Absent means the kit.
   *
   * Exists for neutrals — the bibs who play for whichever side has the ball, and
   * who belong to neither kit. Stored per player rather than as a third team
   * because a neutral is still one side's shape while it is playing.
   */
  color?: string;
}

/**
 * One waypoint on a line, held relative to the chord between its ends.
 *
 * `t` runs 0..1 from one end to the other and `o` is the perpendicular offset in
 * surface units. Relative on purpose, and for the same reason `bend` is: a line
 * anchored to players has to keep its shape when they move, and absolute
 * waypoints would skew or self-cross the moment a player was dragged.
 */
export interface Bend {
  t: number;
  o: number;
}

/** A freehand stroke is capped here; past this it is drawing, not diagramming. */
export const MAX_BENDS = 6;

export interface LineShape {
  k: 'line';
  id: string;
  type: LineType;
  from: Endpoint;
  to: Endpoint;
  /** Perpendicular bow, in surface units. 0 is a straight line. */
  bend: number;
  /**
   * Waypoints for a freehand line. When present these describe the shape and
   * `bend` is ignored — a single clean arc and a drawn stroke are different
   * things, and keeping both means neither has to approximate the other.
   */
  bends?: Bend[];
  /** Last resolved position of each end, so an anchor can be released safely. */
  lastFrom: { x: number; y: number };
  lastTo: { x: number; y: number };
}

export interface TextShape {
  k: 'text';
  id: string;
  x: number;
  y: number;
  text: string;
  /** Cap height in surface units. */
  size: number;
  /** Degrees clockwise, so a label can run along a touchline or a channel. */
  rot: number;
}

export interface KitShape {
  k: 'kit';
  id: string;
  item: string;
  x: number;
  y: number;
  /** Degrees clockwise. */
  rot: number;
  /** Multiplier on the item's footprint. Equipment varies in real life. */
  scale: number;
}

export type Shape = PlayerShape | LineShape | KitShape | TextShape;

/** Kit colours. Shape still distinguishes the teams, so a diagram survives
 *  being printed in grey or read by someone who cannot separate two hues. */
export interface TeamColors {
  own: string;
  opp: string;
}

export interface Diagram {
  /** This diagram's own name — an activity within the session. */
  title: string;
  surface: Surface;
  colors: TeamColors;
  shapes: Shape[];
}

/**
 * A session: several diagrams under one name.
 *
 * A session is three or four activities — a warm-up, a practice or two, a
 * game — and they belong together. Keeping each in its own file made the coach
 * the filing system.
 */
export interface Session {
  title: string;
  diagrams: Diagram[];
}

/** More than a session's worth; past this it is a folder, not a plan. */
export const MAX_DIAGRAMS = 12;

/**
 * Shapes are stored in the surface's own box, whose size comes from
 * `surfaceBox()`. These are only the outer bounds used for validation — a
 * coordinate can never exceed the longest a box can be.
 */
export const MAX_COORD = 1000;

export const ROTATE_STEP = 15;
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 3;

/**
 * How big a token or piece of equipment is when it is first placed.
 *
 * Below 1 deliberately: at full size a back four filled the width of the
 * penalty area, and a session diagram usually wants room for the shape rather
 * than for the markers. Everything is still resizable by its corners.
 */
export const DEFAULT_SCALE = 0.8;

export const TEXT_SIZES = [22, 32, 46] as const;
export const MAX_LABEL = 120;

export function isRef(e: Endpoint): e is { ref: string } {
  return 'ref' in e;
}
