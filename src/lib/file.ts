import { EQUIPMENT_IDS } from '../data/equipment';
import { ALL_NUMBERS, DEFAULT_COLORS } from '../data/notation';
import { MAX_BENDS, MAX_COORD, MAX_DIAGRAMS, MAX_LABEL, MAX_NOTES, MAX_SCALE, MIN_SCALE, TEXT_SIZES, type Diagram, type Session, type Shape } from '../types/diagram';

export const FILE_KIND = 'soccer-session-diagram';

/**
 * 2 holds a list of diagrams; 1 held exactly one.
 *
 * Version 1 files still open — they become a session of one — because they are
 * the files a coach already has on disk, and refusing them by version number
 * would be refusing their own work.
 */
export const FILE_VERSION = 2;
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
    surface: { sport: 'soccer', crop: 'full', facing: 'up', style: 'shaded' },
    colors: { ...DEFAULT_COLORS },
    shapes: [],
  };
}

export function emptySession(): Session {
  return { title: '', diagrams: [emptyDiagram()] };
}

export function serialize(session: Session): string {
  return JSON.stringify(
    {
      kind: FILE_KIND,
      version: FILE_VERSION,
      title: session.title,
      ...(session.date ? { date: session.date } : {}),
      diagrams: session.diagrams,
    },
    null,
    2,
  );
}

/** A day, as yyyy-mm-dd. Anything else is not a date this app wrote. */
export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export type ParseResult =
  | { ok: true; session: Session; dropped: number }
  | { ok: false; reason: string };

/** Any angle is valid; it is just normalised so the stored value stays sane. */
const rot = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? ((v % 360) + 360) % 360 : 0;

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
  if (obj.version !== 1 && obj.version !== FILE_VERSION) {
    return { ok: false, reason: `That file was saved by a different version (${String(obj.version)}).` };
  }

  // Version 1 was a single diagram; it opens as a session of one.
  const list = Array.isArray(obj.diagrams)
    ? obj.diagrams.slice(0, MAX_DIAGRAMS)
    : [obj.diagram ?? {}];
  let dropped = Array.isArray(obj.diagrams) ? Math.max(0, obj.diagrams.length - MAX_DIAGRAMS) : 0;

  const diagrams: Diagram[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      dropped++;
      continue;
    }
    const one = parseDiagram(entry as Record<string, unknown>);
    diagrams.push(one.diagram);
    dropped += one.dropped;
  }
  if (diagrams.length === 0) diagrams.push(emptyDiagram());

  const title =
    typeof obj.title === 'string'
      ? obj.title.slice(0, 200)
      : // A v1 file has no session name of its own; the diagram's is the closest
        // thing to what the coach called it.
        diagrams[0].title;

  return {
    ok: true,
    session: { title, ...(isDate(obj.date) ? { date: obj.date } : {}), diagrams },
    dropped,
  };
}

/** One diagram out of the file, with everything unreadable dropped and counted. */
function parseDiagram(src: Record<string, unknown>): { diagram: Diagram; dropped: number } {
  const out = emptyDiagram();
  out.title = typeof src.title === 'string' ? src.title.slice(0, 200) : '';
  if (typeof src.notes === 'string' && src.notes.trim() !== '') {
    out.notes = src.notes.slice(0, MAX_NOTES);
  }

  const s = (src.surface ?? {}) as Record<string, unknown>;
  out.surface = {
    sport: SPORTS.has(s.sport as string) ? (s.sport as Diagram['surface']['sport']) : 'soccer',
    crop: CROPS.has(s.crop as string) ? (s.crop as Diagram['surface']['crop']) : 'full',
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

  const shapeList = Array.isArray(src.shapes) ? src.shapes.slice(0, MAX_SHAPES) : [];
  let dropped = Array.isArray(src.shapes) ? Math.max(0, src.shapes.length - MAX_SHAPES) : 0;
  const shapes: Shape[] = [];
  const seen = new Set<string>();

  for (const item of shapeList) {
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
      // null or absent means a blank token, which is a real player in a
      // small-sided practice. A number that is present but is not a shirt number
      // is still a bad record, and still drops the shape.
      const blank = sh.number === null || sh.number === undefined;
      const n = blank ? null : num(sh.number, 1, 99);
      const badNumber = !blank && (n === null || !ALL_NUMBERS.includes(n));
      if (badNumber || (sh.team !== 'own' && sh.team !== 'opp')) {
        dropped++;
        continue;
      }
      // An unreadable colour falls back to the team kit rather than dropping the
      // player: a bad swatch is not a reason to lose someone off the pitch.
      const own = typeof sh.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(sh.color)
        ? sh.color
        : undefined;
      shapes.push({
        k: 'player', id, team: sh.team, number: n, x, y,
        rot: rot(sh.rot),
        scale: num(sh.scale, MIN_SCALE, MAX_SCALE) ?? 1,
        ...(own ? { color: own } : {}),
      });
      seen.add(id);
    } else if (sh.k === 'kit' && x !== null && y !== null) {
      if (typeof sh.item !== 'string' || !EQUIPMENT_IDS.has(sh.item)) {
        dropped++;
        continue;
      }
      shapes.push({
        k: 'kit', id, item: sh.item, x, y,
        rot: rot(sh.rot),
        scale: num(sh.scale, MIN_SCALE, MAX_SCALE) ?? 1,
      });
      seen.add(id);
    } else if (sh.k === 'text' && x !== null && y !== null) {
      if (typeof sh.text !== 'string') {
        dropped++;
        continue;
      }
      const size = num(sh.size, TEXT_SIZES[0], TEXT_SIZES[TEXT_SIZES.length - 1]);
      shapes.push({
        k: 'text',
        id,
        x,
        y,
        text: sh.text.slice(0, MAX_LABEL),
        size: size ?? TEXT_SIZES[0],
        rot: rot(sh.rot),
      });
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
      // Freehand waypoints. Anything malformed drops back to the plain line
      // rather than losing the arrow: the ends are the part that carries the
      // meaning, and they have already been checked.
      const bends = Array.isArray(sh.bends)
        ? sh.bends
            .slice(0, MAX_BENDS)
            .map((w) => {
              if (typeof w !== 'object' || w === null) return null;
              const rec = w as Record<string, unknown>;
              const t = num(rec.t, 0, 1);
              const o = num(rec.o, -MAX_COORD, MAX_COORD);
              return t === null || o === null ? null : { t, o };
            })
            .filter((w): w is { t: number; o: number } => w !== null)
        : [];
      shapes.push({
        k: 'line',
        id,
        type: sh.type as Shape extends { k: 'line'; type: infer T } ? T : never,
        from,
        to,
        bend: num(sh.bend, -MAX_COORD, MAX_COORD) ?? 0,
        ...(bends.length > 0 ? { bends } : {}),
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

  return { diagram: out, dropped };
}

export function filename(named: { title: string }, ext: string): string {
  const slug =
    named.title
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
