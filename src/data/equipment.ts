/**
 * The equipment palette.
 *
 * Not part of any notation standard — these are just the props a session uses,
 * drawn as simple shapes. Each renders from inline SVG so the app makes no
 * network requests and needs no asset pipeline.
 */

export interface EquipmentSpec {
  id: string;
  label: string;
  group: 'Goals' | 'Other';
  /** Footprint in surface units; used for hit-testing and drawing. */
  w: number;
  h: number;
}

export const EQUIPMENT: EquipmentSpec[] = [
  { id: 'goal', label: 'Goal', group: 'Goals', w: 132, h: 46 },
  { id: 'goal-toppled', label: 'Goal toppled', group: 'Goals', w: 130, h: 26 },
  { id: 'mini-goal', label: 'Mini goal', group: 'Goals', w: 82, h: 34 },
  { id: 'mini-goal-toppled', label: 'Mini goal toppled', group: 'Goals', w: 78, h: 18 },
  { id: 'inside-goal', label: 'Inside goal', group: 'Goals', w: 96, h: 34 },

  { id: 'ball', label: 'Ball', group: 'Other', w: 26, h: 26 },
  { id: 'cap', label: 'Cap', group: 'Other', w: 30, h: 18 },
  { id: 'cone', label: 'Cone', group: 'Other', w: 28, h: 30 },
  { id: 'dummy', label: 'Dummy', group: 'Other', w: 30, h: 54 },
  { id: 'ladder', label: 'Ladder', group: 'Other', w: 110, h: 26 },
  { id: 'pole', label: 'Pole', group: 'Other', w: 10, h: 60 },
  { id: 'ring', label: 'Ring', group: 'Other', w: 40, h: 24 },
  { id: 'mat', label: 'Mat', group: 'Other', w: 56, h: 34 },
  { id: 'flag', label: 'Flag', group: 'Other', w: 34, h: 52 },
  { id: 'bench', label: 'Bench', group: 'Other', w: 90, h: 22 },
];

export const equipmentSpec = (id: string): EquipmentSpec | undefined =>
  EQUIPMENT.find((e) => e.id === id);

export const EQUIPMENT_IDS = new Set(EQUIPMENT.map((e) => e.id));
