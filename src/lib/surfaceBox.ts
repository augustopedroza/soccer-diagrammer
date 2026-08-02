import type { Crop, Sport, Surface } from '../types/diagram';

/**
 * The drawing box for a surface, in surface units.
 *
 * Real proportions matter here. The notation says a line's length is the
 * distance it represents, so a half pitch squashed into a square would make
 * every diagram lie about distance. The box therefore changes shape with the
 * crop and the facing, and the canvas takes its aspect ratio from it.
 *
 * A full pitch is drawn 1000 units long. Everything else is derived.
 */

export const FULL_LENGTH = 1000;

/**
 * Grass beyond the touchlines, in surface units — about six metres.
 *
 * Without it the pitch runs to the very edge of the drawing and anything placed
 * on a line, a goal most obviously, hangs half outside and gets clamped back in.
 */
export const MARGIN = 58;

/** width : length, portrait. 68 x 105 m pitch; 20 x 40 m futsal court. */
const ASPECT: Record<Sport, number> = {
  soccer: 68 / 105,
  futsal: 20 / 40,
};

export const CROP_FRACTION: Record<Crop, number> = {
  full: 1,
  'three-quarter': 0.75,
  half: 0.5,
  // The 16.5 m penalty area plus about six metres in front of it. At 0.3 this
  // was 31 m of a 105 m pitch — effectively another half view.
  'penalty-box': 0.22,
};

export interface Box {
  w: number;
  h: number;
}

export const isRotated = (s: Surface) => s.facing === 'left' || s.facing === 'right';

/** The pitch as drawn before cropping or rotating: full length, portrait. */
export function pitchBox(sport: Sport): Box {
  return { w: FULL_LENGTH * ASPECT[sport], h: FULL_LENGTH };
}

/** The visible box, after crop and facing. This is the canvas viewBox. */
export function surfaceBox(s: Surface): Box {
  const { w } = pitchBox(s.sport);
  const h = FULL_LENGTH * CROP_FRACTION[s.crop];
  const box = { w: w + MARGIN * 2, h: h + MARGIN * 2 };
  return isRotated(s) ? { w: box.h, h: box.w } : box;
}

/**
 * How far to slide the full pitch so the requested end is the one on screen.
 *
 * `up` and `left` keep the far end; `down` and `right` keep the near end. Both
 * pairs then rotate, so a crop always shows a real end of a real pitch rather
 * than an arbitrary band across the middle.
 */
export function cropOffset(s: Surface): number {
  const visible = FULL_LENGTH * CROP_FRACTION[s.crop];
  const keepFarEnd = s.facing === 'up' || s.facing === 'left';
  return keepFarEnd ? 0 : FULL_LENGTH - visible;
}

/** Rotation applied about the centre of the visible box. */
export function facingRotation(s: Surface): number {
  switch (s.facing) {
    case 'up':
      return 0;
    case 'down':
      return 180;
    case 'left':
      return -90;
    case 'right':
      return 90;
  }
}
