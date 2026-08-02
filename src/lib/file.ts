import { EQUIPMENT_IDS } from '../data/equipment';
import { ALL_NUMBERS, DEFAULT_COLORS } from '../data/notation';
import { MAX_COORD, type Diagram, type Shape } from '../types/diagram';

export const FILE_KIND = 'soccer-session-diagram';
export const FILE_VERSION = 1;
export const MAX_BYTES = 1024 * 1024;
export const MAX_SHAPES = 400;

const SPORTS = new Set(['soccer', 'futsal']);
const CROPS = new Set(['full', 'three-quarter', 'half', 'penalty-box']);
const FACINGS = new Set(['up', 'down', 'left', 'right']);
const STYLES = new Set(['shaded', 'line']);
const LINE_TYPES = new Set(['pass', 'dribble', 'run', 'tactical']);

export function emptyDiagram(): Diagram {
  return {
    title: '',
    surface: { sport: 'soccer', crop: 'half', facing: 'up', style: 'shaded' },
    colors: { ...DEFAULT_COLORS },
    shapes: [],
  };
}

export function serialize(d: Diagram): string {
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, diagram: d }, null, 2);
}

export type ParseResult =
  | { ok: true; diagram: Diagram; dropped: number }
  | { ok: false; reason: string };

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/**
 * A file the user chose is untrusted input: size-capped, shape-checked, every
 * enum and coordinate validated, unknown values dropped and counted. It is only
 * ever data — nothing here is evaluated or rendered as markup.
 */
export function parse(text: string): ParseResult {
  if (text.length > MAX_BYTES) return { ok: false, reason: 'That file is too large.' };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file isn't readable as a diagram." };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "That file isn't a diagram." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== FILE_KIND) return { ok: false, reason: "That file isn't a diagram from this app." };
  if (obj.version !== FILE_VERSION) {
    return { ok: false, reason: `That diagram was saved by a different version (${String(obj.version)}).` };
  }

  const src = (obj.diagram ?? {}) as Record<string, unknown>;
  const out = emptyDiagram();
  out.title = typeof src.title === 'string' ? src.title.slice(0, 200) : '';

  const s = (src.surface ?? {}) as Record<string, unknown>;
  out.surface = {
    sport: SPORTS.has(s.sport as string) ? (s.sport as Diagram['surface']['sport']) : 'soccer',
    crop: CROPS.has(s.crop as string) ? (s.crop as Diagram['surface']['crop']) : 'half',
    facing: FACINGS.has(s.facing as string) ? (s.facing as Diagram['surface']['facing']) : 'up',
    style: STYLES.has(s.style as string) ? (s.style as Diagram['surface']['style']) : 'shaded',
  };

  // Only literal hex survives — a colour goes straight into an SVG attribute,
  // so anything else is refused rather than sanitised.
  const hex = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  const c = (src.colors ?? {}) as Record<string, unknown>;
  out.colors = {
    own: hex(c.own, DEFAULT_COLORS.own),
    opp: hex(c.opp, DEFAULT_COLORS.opp),
  };

  const list = Array.isArray(src.shapes) ? src.shapes.slice(0, MAX_SHAPES) : [];
  let dropped = Array.isArray(src.shapes) ? Math.max(0, src.shapes.length - MAX_SHAPES) : 0;
  const shapes: Shape[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (typeof item !== 'object' || item === null) {
      dropped++;
      continue;
    }
    const sh = item as Record<string, unknown>;
    const id = typeof sh.id === 'string' && sh.id.length <= 64 ? sh.id : null;
    if (!id || seen.has(id)) {
      dropped++;
      continue;
    }
    const x = num(sh.x, 0, MAX_COORD);
    const y = num(sh.y, 0, MAX_COORD);

    if (sh.k === 'player' && x !== null && y !== null) {
      const n = num(sh.number, 1, 99);
      if (n === null || !ALL_NUMBERS.includes(n) || (sh.team !== 'own' && sh.team !== 'opp')) {
        dropped++;
        continue;
      }
      shapes.push({ k: 'player', id, team: sh.team, number: n, x, y });
      seen.add(id);
    } else if (sh.k === 'kit' && x !== null && y !== null) {
      if (typeof sh.item !== 'string' || !EQUIPMENT_IDS.has(sh.item)) {
        dropped++;
        continue;
      }
      shapes.push({ k: 'kit', id, item: sh.item, x, y });
      seen.add(id);
    } else if (sh.k === 'line') {
      if (!LINE_TYPES.has(sh.type as string)) {
        dropped++;
        continue;
      }
      const end = (v: unknown) => {
        if (typeof v !== 'object' || v === null) return null;
        const e = v as Record<string, unknown>;
        if (typeof e.ref === 'string' && e.ref.length <= 64) return { ref: e.ref };
        const ex = num(e.x, 0, MAX_COORD);
        const ey = num(e.y, 0, MAX_COORD);
        return ex !== null && ey !== null ? { x: ex, y: ey } : null;
      };
      const from = end(sh.from);
      const to = end(sh.to);
      const lf = end(sh.lastFrom);
      const lt = end(sh.lastTo);
      if (!from || !to || !lf || !lt || 'ref' in lf || 'ref' in lt) {
        dropped++;
        continue;
      }
      shapes.push({
        k: 'line',
        id,
        type: sh.type as Shape extends { k: 'line'; type: infer T } ? T : never,
        from,
        to,
        bend: num(sh.bend, -MAX_COORD, MAX_COORD) ?? 0,
        lastFrom: lf,
        lastTo: lt,
      });
      seen.add(id);
    } else {
      dropped++;
    }
  }

  // An anchor pointing at a player that is not in this file would dangle, so it
  // falls back to the last drawn position instead.
  const playerIds = new Set(shapes.filter((sh) => sh.k === 'player').map((sh) => sh.id));
  out.shapes = shapes.map((sh) => {
    if (sh.k !== 'line') return sh;
    return {
      ...sh,
      from: 'ref' in sh.from && !playerIds.has(sh.from.ref) ? { ...sh.lastFrom } : sh.from,
      to: 'ref' in sh.to && !playerIds.has(sh.to.ref) ? { ...sh.lastTo } : sh.to,
    };
  });

  return { ok: true, diagram: out, dropped };
}

export function filename(d: Diagram, ext: string): string {
  const slug =
    d.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'session-diagram';
  return `${slug}.${ext}`;
}

/** Local download via an object URL — nothing is uploaded. */
export function download(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
