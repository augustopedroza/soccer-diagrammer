import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, deleteShapes, type Tool } from './components/Canvas';
import { KitMark, PlayerToken } from './components/Tokens';
import { EQUIPMENT, equipmentSpec } from './data/equipment';
import {
  FORMATIONS,
  MAX_SIDE,
  SMALL_SIDED,
  placements,
  sidedLabel,
  smallSidedSpots,
  type Formation,
  type SmallSided,
} from './data/formations';
import { ALL_NUMBERS, COLOR_PRESETS, LINE_SPECS, NUMBER_GROUPS, TEAM_SPECS } from './data/notation';
import { download, emptyDiagram, emptySession, filename, parse, serialize } from './lib/file';
import { confineToBox, translated, wavyPath } from './lib/geometry';
import {
  addDiagram,
  clampIndex,
  diagramLabel,
  duplicateDiagram,
  moveDiagram,
  removeDiagram,
  replaceDiagram,
} from './lib/session';
import { CROP_FRACTION, surfaceBox } from './lib/surfaceBox';
import { DEFAULT_SCALE, MAX_DIAGRAMS, ROTATE_STEP, TEXT_SIZES, MAX_LABEL } from './types/diagram';
import type { Crop, Diagram, Facing, LineType, Session, Shape, Sport, SurfaceStyle, Team } from './types/diagram';

const HISTORY_LIMIT = 60;

/** A selection that is always empty, for the print-only canvases. */
const EMPTY: ReadonlySet<string> = new Set();

/**
 * The dribble icon, ending flat on the arrow head's base at x=48 — the taper in
 * `wavyPath` is what brings it in level with the head. The swing is damped to
 * suit a 16-unit tall button; at full size it would fill the row edge to edge.
 */
const WAVY_ICON = wavyPath({ x: 2, y: 8 }, { x: 25, y: 8 }, { x: 48, y: 8 }, 4);

/**
 * A palette section that folds away.
 *
 * The rails are taller than a laptop screen once every section is open, and the
 * ones a coach sets once — the surface, the kit, the equipment — are exactly the
 * ones worth folding. Open by default: a panel that hides its own contents on
 * first load reads as an empty app.
 */
function Panel({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel${open ? '' : ' shut'}`}>
      <h2>
        <button className="panelToggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span>{title}</span>
          <span className="chev" aria-hidden="true" />
        </button>
      </h2>
      {open && children}
    </section>
  );
}

/**
 * How much of the pitch a crop keeps, drawn rather than named.
 *
 * The one row in Surface where a picture beats a word: "¾" and "Box" describe an
 * extent, and an extent is a thing to see. The others are settings you read back
 * — Up/Down, Shaded/Line art — where a glyph would be guesswork.
 */
function CropIcon({ crop }: { crop: Crop }) {
  const w = 20;
  const h = 30;
  const kept = h * CROP_FRACTION[crop];
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${h + 2}`} width={17} height={25} aria-hidden="true">
      <rect x={0} y={0} width={w} height={h} rx={2} className="cropWhole" />
      <rect x={0} y={0} width={w} height={kept} rx={2} className="cropKept" />
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} className="cropWhole" />
    </svg>
  );
}

/**
 * A palette preview of a piece of equipment.
 *
 * The goals share one frame, so a mini goal is drawn visibly smaller than a full
 * one — they differ by size and nothing else, and a grid that fits each item to
 * its own cell would make the five goal variants identical. Everything else does
 * fit its own cell, because nobody is going to confuse a cone with a bench and a
 * true-to-scale ball would be four pixels across.
 */
function KitIcon({ item }: { item: string }) {
  const spec = equipmentSpec(item);
  if (!spec) return null;
  const box =
    spec.group === 'Goals'
      ? { w: 142, h: 58 }
      : (() => {
          const s = Math.max(spec.w, spec.h) + 8;
          return { w: s, h: s };
        })();
  return (
    <svg
      viewBox={`${-box.w / 2} ${-box.h / 2} ${box.w} ${box.h}`}
      width={42}
      height={30}
      aria-hidden="true"
    >
      <KitMark item={item} x={0} y={0} />
    </svg>
  );
}

/** Arrow keys, as a delta in surface units before the Shift multiplier. */
const NUDGES: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** How long a typed 1 waits to see whether it is really a 10 or an 11. */
const NUMBER_CHASE_MS = 900;

/** The modifier this keyboard actually has, for the tooltips to name. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? '⌘'
  : 'Ctrl+';

/** A side is 1..11 players; anything else keeps the previous count. */
const sideCount = (raw: string, was: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= MAX_SIDE ? Math.round(n) : was;
};

export default function App() {
  const [session, setSession] = useState<Session>(emptySession);
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** The diagram on screen. Everything below edits this one. */
  const diagram = session.diagrams[active] ?? session.diagrams[0];

  /**
   * History holds whole sessions, not diagrams.
   *
   * Undo has to be able to bring back a deleted activity, and a per-diagram
   * stack could not: the diagram it belonged to would already be gone.
   */
  const past = useRef<Session[]>([]);
  const future = useRef<Session[]>([]);
  /** Read inside state updaters, which cannot see the render's `active`. */
  const activeAt = useRef(0);
  activeAt.current = active;

  const commitSession = useCallback((next: Session, commit: boolean) => {
    setSession((prev) => {
      if (commit) {
        past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
        future.current = [];
      }
      return next;
    });
    setNotice(null);
  }, []);

  /**
   * `commit` separates a finished action from the frames of a drag. Without it
   * every pixel of a move would become its own undo step.
   */
  const change = useCallback(
    (next: Diagram, commit: boolean) => {
      setSession((prev) => {
        if (commit) {
          past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
          future.current = [];
        }
        return replaceDiagram(prev, activeAt.current, next);
      });
      setNotice(null);
    },
    [],
  );

  const commitNow = useCallback((next: Diagram) => change(next, true), [change]);

  /** Edits the current diagram from its latest value, as one undo step. */
  const editShapes = useCallback((edit: (d: Diagram) => Diagram) => {
    setSession((prev) => {
      past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
      future.current = [];
      const at = activeAt.current;
      return replaceDiagram(prev, at, edit(prev.diagrams[at]));
    });
  }, []);

  /** Undo can change how many diagrams there are, so the view has to follow. */
  const step = useCallback((from: typeof past, to: typeof future) => {
    setSession((prev) => {
      const next = from.current.pop();
      if (!next) return prev;
      to.current = [...to.current, prev];
      setActive((i) => clampIndex(i, next.diagrams.length));
      setSelected(new Set());
      return next;
    });
  }, []);

  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  // Lines in the current selection, so their type can be changed after drawing.
  const selectedLines = diagram.shapes.filter(
    (s): s is Extract<typeof s, { k: 'line' }> => s.k === 'line' && selected.has(s.id),
  );

  // Players in the selection, so they can be numbered after being placed.
  const selectedPlayers = diagram.shapes.filter(
    (s): s is Extract<typeof s, { k: 'player' }> => s.k === 'player' && selected.has(s.id),
  );

  /**
   * One verb for the four line types: retype what is selected, or arm the tool
   * to draw a new one. Same from the palette and from the keyboard, so there is
   * no second panel to keep in step.
   */
  const applyLine = useCallback(
    (type: LineType) => {
      if (selectedLines.length > 0) {
        commitNow({
          ...diagram,
          shapes: diagram.shapes.map((sh) =>
            sh.k === 'line' && selected.has(sh.id) ? { ...sh, type } : sh,
          ),
        });
      } else {
        setTool({ kind: 'line', type });
      }
    },
    [diagram, selected, selectedLines.length, commitNow],
  );

  /**
   * Drops a copy of some shapes, offset so the copy is visibly a copy.
   *
   * Anchored lines are re-pointed at the copied players where both ends came
   * along — otherwise pasting a pass would leave the new line still attached to
   * the original players, which is never what was meant.
   */
  const pasteShapes = useCallback(
    (shapes: Shape[], offset = 40) => {
      if (shapes.length === 0) return;
      const idMap = new Map<string, string>();
      const stamp = Date.now().toString(36);
      shapes.forEach((sh, i) => idMap.set(sh.id, `c${stamp}-${i}`));

      const remap = (e: { ref: string } | { x: number; y: number }) =>
        'ref' in e
          ? idMap.has(e.ref)
            ? { ref: idMap.get(e.ref)! }
            : { ref: e.ref }
          : { x: e.x + offset, y: e.y + offset };

      const copies: Shape[] = shapes.map((sh) => {
        const id = idMap.get(sh.id)!;
        if (sh.k === 'line') {
          return {
            ...sh,
            id,
            from: remap(sh.from),
            to: remap(sh.to),
            lastFrom: { x: sh.lastFrom.x + offset, y: sh.lastFrom.y + offset },
            lastTo: { x: sh.lastTo.x + offset, y: sh.lastTo.y + offset },
          };
        }
        return { ...sh, id, x: sh.x + offset, y: sh.y + offset };
      });

      setSession((prev) => {
        past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
        future.current = [];
        const at = activeAt.current;
        const d = prev.diagrams[at];
        return replaceDiagram(prev, at, { ...d, shapes: [...d.shapes, ...copies] });
      });
      setSelected(new Set(copies.map((c) => c.id)));
    },
    [],
  );

  /** Turns everything selected that has a facing. Labels and lines have none. */
  const rotateSelected = useCallback(
    (deltaOrAbsolute: number, absolute = false) => {
      setSession((prev) => {
        past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
        future.current = [];
        const at = activeAt.current;
        const d = prev.diagrams[at];
        return replaceDiagram(prev, at, {
          ...d,
          shapes: d.shapes.map((sh) =>
            selected.has(sh.id) && sh.k !== 'line'
              ? {
                  ...sh,
                  rot: absolute
                    ? deltaOrAbsolute
                    : (((sh.rot + deltaOrAbsolute) % 360) + 360) % 360,
                }
              : sh,
          ),
        });
      });
    },
    [selected],
  );

  /**
   * Notices clear themselves.
   *
   * They report something that has already happened — saved, opened, moved — so
   * once it has been read there is nothing to act on, and a banner that stays
   * put shifts the whole page down until the next one replaces it. Long enough
   * to read a refusal; clickable if it is in the way.
   */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /** The three file verbs, so the toolbar and the keyboard call one thing each. */
  const openDialog = useCallback(() => fileInput.current?.click(), []);

  const saveFile = useCallback(() => {
    // The whole session, under the session's name: the activities were planned
    // together and are no use to anyone as five files called "untitled".
    const name = filename(session, 'json');
    download(name, serialize(session), 'application/json');
    setNotice(`Saved ${name}`);
  }, [session]);

  const printSheet = useCallback(() => window.print(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      // The file verbs sit ABOVE the typing guard on purpose: they should work
      // while the title field has focus, and each one has to take the key off
      // the browser, which would otherwise save the page, open a file into the
      // tab, or print without the app's own print setup.
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'o') {
          e.preventDefault();
          openDialog();
          return;
        }
        if (k === 's') {
          e.preventDefault();
          saveFile();
          return;
        }
        if (k === 'p') {
          e.preventDefault();
          printSheet();
          return;
        }
      }
      if (typing) return;
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected.size > 0) {
        e.preventDefault();
        commitNow(deleteShapes(diagram, selected));
        setSelected(new Set());
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(diagram.shapes.map((s) => s.id)));
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        // No notice: the paste is the feedback, and a banner for something that
        // did not change the drawing is just something else to read.
        clipboard.current = diagram.shapes.filter((sh) => selected.has(sh.id));
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        clipboard.current = diagram.shapes.filter((sh) => selected.has(sh.id));
        if (clipboard.current.length > 0) {
          commitNow(deleteShapes(diagram, selected));
          setSelected(new Set());
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteShapes(clipboard.current);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        // Duplicate in place, without disturbing what was copied.
        e.preventDefault();
        pasteShapes(diagram.shapes.filter((sh) => selected.has(sh.id)));
      }
      if (e.key === 'Escape') {
        setTool({ kind: 'select' });
        setSelected(new Set());
      }
      // Arrow keys nudge: one unit, ten with Shift. A burst of presses is one
      // undo step, not thirty — holding a key would otherwise fill the whole
      // history with a single slow move.
      const step = NUDGES[e.key];
      if (step && selected.size > 0 && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const by = e.shiftKey ? 10 : 1;
        const now = Date.now();
        const fresh = now - lastNudge.current > 700;
        lastNudge.current = now;
        change(
          {
            ...diagram,
            shapes: translated(
              diagram.shapes,
              selected,
              step[0] * by,
              step[1] * by,
              surfaceBox(diagram.surface),
            ),
          },
          fresh,
        );
      }
      // Typing a number renumbers the selected players.
      //
      // 10 and 11 need two keystrokes, so a 1 is held briefly: press 1 and the
      // player becomes the 1; press 0 or 1 straight after and it becomes the 10
      // or the 11. Either way the shirt is right after the first press, so a
      // slow second press is a correction rather than a failure. 0 on its own is
      // no shirt number, so it clears.
      if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && selectedPlayers.length > 0) {
        e.preventDefault();
        const now = Date.now();
        const pending = numberBuffer.current;
        const chasing = pending !== null && now - pending.at < NUMBER_CHASE_MS && pending.first === 1;
        if (chasing && (e.key === '0' || e.key === '1')) {
          numberSelected(e.key === '0' ? 10 : 11);
          numberBuffer.current = null;
        } else if (e.key === '0') {
          numberSelected(null);
          numberBuffer.current = null;
        } else {
          const n = Number(e.key);
          numberSelected(ALL_NUMBERS.includes(n) ? n : null);
          numberBuffer.current = n === 1 ? { first: 1, at: now } : null;
        }
      }
      if (e.key.toLowerCase() === 's') setTool({ kind: 'select' });
      if (e.key.toLowerCase() === 'l') setTool({ kind: 'text' });
      // Square brackets turn the selection, the way most editors do.
      if (e.key === '[') { e.preventDefault(); rotateSelected(-ROTATE_STEP); }
      if (e.key === ']') { e.preventDefault(); rotateSelected(ROTATE_STEP); }
      // First letter of what the line stands for. With lines selected this
      // retypes them, which is the same verb applied to what is in hand.
      const spec = LINE_SPECS.find((sp) => sp.key === e.key.toLowerCase());
      if (spec && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        applyLine(spec.type);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    undo,
    redo,
    selected,
    diagram,
    change,
    commitNow,
    applyLine,
    rotateSelected,
    pasteShapes,
    openDialog,
    saveFile,
    printSheet,
  ]);

  /**
   * Changes the surface, keeping everything on it reachable.
   *
   * A smaller crop, or turning the pitch on its side, makes the drawing box a
   * different shape — and anything left outside it was unreachable: not
   * visible, not clickable, not deletable, since the pointer is clamped to the
   * box too. Whatever falls outside comes back to the edge, and the count is
   * reported rather than done quietly.
   */
  const setSurface = (patch: Partial<Diagram['surface']>) => {
    const surface = { ...diagram.surface, ...patch };
    const { shapes, moved } = confineToBox(diagram.shapes, surfaceBox(surface));
    commitNow({ ...diagram, surface, shapes });
    if (moved > 0) {
      setNotice(`${moved} ${moved === 1 ? 'item was' : 'items were'} off the new field, and moved to its edge.`);
    }
  };

  function exportSvg() {
    const svg = document.querySelector('.canvas');
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
    clone.querySelectorAll('.selRing').forEach((n) => n.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    download(
      filename(diagram, 'svg'),
      `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`,
      'image/svg+xml',
    );
    setNotice(`Saved ${filename(diagram, 'svg')}`);
  }

  async function openFile(file: File) {
    const res = parse(await file.text());
    if (!res.ok) {
      setNotice(res.reason);
      return;
    }
    past.current = [...past.current, session];
    future.current = [];
    setSession(res.session);
    setActive(0);
    setSelected(new Set());
    const many = res.session.diagrams.length > 1 ? ` ${res.session.diagrams.length} diagrams.` : '';
    setNotice(
      res.dropped > 0
        ? `Opened.${many} ${res.dropped} unreadable item(s) were ignored.`
        : `Opened.${many}`,
    );
  }

  /**
   * The activities in the session, as one strip above the pitch.
   *
   * Each verb reports through commitSession, so adding, copying and deleting an
   * activity are all undoable — deleting one is the most destructive thing in
   * the app and the one most worth being able to take back.
   */
  function pickDiagram(i: number) {
    setActive(clampIndex(i, session.diagrams.length));
    setSelected(new Set());
  }

  function newDiagram() {
    const made = addDiagram(session, active, emptyDiagram());
    if (made.session === session) {
      setNotice(`A session holds up to ${MAX_DIAGRAMS} diagrams.`);
      return;
    }
    commitSession(made.session, true);
    setActive(made.active);
    setSelected(new Set());
  }

  function copyDiagram() {
    const made = duplicateDiagram(session, active);
    if (made.session === session) {
      setNotice(`A session holds up to ${MAX_DIAGRAMS} diagrams.`);
      return;
    }
    commitSession(made.session, true);
    setActive(made.active);
    setSelected(new Set());
  }

  function dropDiagram(i: number) {
    const left = removeDiagram(session, i, emptyDiagram);
    commitSession(left.session, true);
    setActive(left.active);
    setSelected(new Set());
  }

  function shiftDiagram(by: number) {
    const moved = moveDiagram(session, active, active + by);
    if (moved.session === session) return;
    commitSession(moved.session, true);
    setActive(moved.active);
  }

  /** Which tab is being renamed, if any. */
  const [renaming, setRenaming] = useState<number | null>(null);

  const [templateTeam, setTemplateTeam] = useState<Team>('own');
  const [customSided, setCustomSided] = useState<SmallSided>({ own: 4, opp: 3 });
  /** A just-typed 1, waiting to see whether a 0 or a 1 follows it. */
  const numberBuffer = useRef<{ first: number; at: number } | null>(null);
  /** When the last arrow-key nudge landed, so a run of them is one undo step. */
  const lastNudge = useRef(0);
  /**
   * The box open on the drawing: what it is editing, where, and what is typed.
   *
   * One gesture for both: double-click a player to renumber it, a label to
   * reword it. Two popovers would be two sets of focus and commit rules to keep
   * in step for what is, to the coach, the same move.
   */
  const [edit, setEdit] = useState<
    { id: string; kind: 'number' | 'text'; x: number; y: number; value: string } | null
  >(null);
  const labelInput = useRef<HTMLInputElement>(null);
  /** Kept in the app, not the system clipboard — nothing leaves the page. */
  const clipboard = useRef<Shape[]>([]);

  const selectedLabels = diagram.shapes.filter(
    (s): s is Extract<typeof s, { k: 'text' }> => s.k === 'text' && selected.has(s.id),
  );

  /**
   * Put the caret in the field whenever a single label becomes the selection.
   *
   * A fresh one reads "Label" until it is given a name, and the field does not
   * exist yet at the moment of placing — so this has to wait for the render
   * rather than run inside the click handler.
   */
  const focusedLabel = useRef<string | null>(null);
  useEffect(() => {
    // Not while the box on the drawing is open: this effect runs after the
    // popover has taken focus, so it would pull the caret across to the rail
    // mid-word.
    if (edit) return;
    if (selectedLabels.length !== 1) {
      focusedLabel.current = null;
      return;
    }
    const id = selectedLabels[0].id;
    if (focusedLabel.current === id) return;
    focusedLabel.current = id;
    labelInput.current?.focus();
    labelInput.current?.select();
  }, [selectedLabels, edit]);

  function editLabels(patch: { text?: string; size?: number }) {
    commitNow({
      ...diagram,
      shapes: diagram.shapes.map((sh) =>
        sh.k === 'text' && selected.has(sh.id) ? { ...sh, ...patch } : sh,
      ),
    });
  }

  /**
   * Drops a whole starting XI. Replaces that team's players rather than adding
   * to them, so pressing two templates in a row does not leave twenty-two
   * tokens stacked on the pitch.
   */
  function applyFormation(f: Formation) {
    const box = surfaceBox(diagram.surface);
    let n = 0;
    const placed: Shape[] = placements(f, templateTeam).map((p) => ({
      k: 'player',
      id: `f${Date.now().toString(36)}-${n++}`,
      team: templateTeam,
      number: p.number,
      rot: 0,
      scale: DEFAULT_SCALE,
      x: Math.round(p.fx * box.w),
      y: Math.round(p.fy * box.h),
    }));
    commitNow({
      ...diagram,
      shapes: [...diagram.shapes.filter((s) => !(s.k === 'player' && s.team === templateTeam)), ...placed],
    });
    setSelected(new Set());
  }

  /**
   * Drops a small-sided game: N of yours against M of theirs, both sides blank.
   *
   * Replaces every player, not just one team's — a 4v3 is a whole practice
   * setup, and adding one on top of an existing eleven is never what was meant.
   */
  function applySmallSided(s: SmallSided) {
    const box = surfaceBox(diagram.surface);
    const stamp = Date.now().toString(36);
    let n = 0;
    const side = (count: number, team: Team): Shape[] =>
      smallSidedSpots(count, team).map((p) => ({
        k: 'player',
        id: `s${stamp}-${n++}`,
        team,
        number: null,
        rot: 0,
        scale: DEFAULT_SCALE,
        x: Math.round(p.fx * box.w),
        y: Math.round(p.fy * box.h),
      }));
    commitNow({
      ...diagram,
      shapes: [
        ...diagram.shapes.filter((sh) => sh.k !== 'player'),
        ...side(s.own, 'own'),
        ...side(s.opp, 'opp'),
      ],
    });
    setSelected(new Set());
  }

  /**
   * Closes the shirt-number box, applying what was typed.
   *
   * An empty box clears the number rather than cancelling, because blank is a
   * legitimate shirt here. Anything that is not a real shirt number is refused
   * outright — silently rounding 47 to 4 would be a worse answer than none.
   */
  function commitEdit() {
    setEdit((open) => {
      if (!open) return null;
      const raw = open.value.trim();

      if (open.kind === 'text') {
        // Any wording is valid, including none: an empty label is still there
        // and still selectable, exactly as it is from the rail's field.
        editShapes((d) => ({
          ...d,
          shapes: d.shapes.map((sh) =>
            sh.k === 'text' && sh.id === open.id ? { ...sh, text: open.value.slice(0, MAX_LABEL) } : sh,
          ),
        }));
        return null;
      }

      const n = raw === '' ? null : Number(raw);
      if (n === null || ALL_NUMBERS.includes(n)) {
        editShapes((d) => ({
          ...d,
          shapes: d.shapes.map((sh) =>
            sh.k === 'player' && sh.id === open.id ? { ...sh, number: n } : sh,
          ),
        }));
      } else {
        setNotice(`${raw} is not a shirt number — 1 to 11, or empty for none.`);
      }
      return null;
    });
  }

  /**
   * Recolours every player in the selection, or puts them back in the team kit.
   *
   * Per player rather than per team, because the reason for wanting it is
   * neutrals: the bibs who play for whichever side has the ball. They are still
   * one side's shape while they are playing, so this changes the colour and
   * leaves the shape — and the team — alone.
   */
  function colorSelected(hex: string | null) {
    commitNow({
      ...diagram,
      shapes: diagram.shapes.map((sh) => {
        if (sh.k !== 'player' || !selected.has(sh.id)) return sh;
        const { color: _drop, ...rest } = sh;
        return hex === null ? rest : { ...rest, color: hex };
      }),
    });
  }

  /** Numbers, or clears, every player in the selection. */
  function numberSelected(value: number | null) {
    commitNow({
      ...diagram,
      shapes: diagram.shapes.map((sh) =>
        sh.k === 'player' && selected.has(sh.id) ? { ...sh, number: value } : sh,
      ),
    });
  }

  const isTool = (t: Tool) =>
    tool.kind === t.kind &&
    (t.kind !== 'line' || (tool.kind === 'line' && tool.type === t.type)) &&
    (t.kind !== 'kit' || (tool.kind === 'kit' && tool.item === t.item)) &&
    (t.kind !== 'player' ||
      (tool.kind === 'player' && tool.team === t.team && tool.number === t.number));

  return (
    <div className="app">
      <header className="bar">
        <h1>Session Diagrammer</h1>
        <input
          className="titleInput"
          value={session.title}
          placeholder="Untitled session"
          onChange={(e) => setSession({ ...session, title: e.target.value })}
          aria-label="Session name"
        />
        <div className="spacer" />
        <button onClick={undo} title={`Undo (${MOD}Z)`}>Undo</button>
        <button onClick={redo} title={`Redo (⇧${MOD}Z)`}>Redo</button>
        <button onClick={openDialog} title={`Open (${MOD}O)`}>Open</button>
        <button onClick={saveFile} title={`Save (${MOD}S)`}>Save</button>
        <button className="primary" onClick={exportSvg}>Export image</button>
        <button onClick={printSheet} title={`Print (${MOD}P)`}>Print</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
      </header>

      {notice && (
        <div className="notice" role="status" onClick={() => setNotice(null)} title="Dismiss">
          {notice}
        </div>
      )}

      <div className="work">
        <aside className="palette">
          <Panel title="Surface">
            <div className="segmented">
              {(['soccer', 'futsal'] as Sport[]).map((s) => (
                <button key={s} aria-pressed={diagram.surface.sport === s} onClick={() => setSurface({ sport: s })}>
                  {s === 'soccer' ? 'Soccer' : 'Futsal'}
                </button>
              ))}
            </div>
            <div className="segmented cropRow">
              {(['full', 'three-quarter', 'half', 'penalty-box'] as Crop[]).map((c) => (
                <button key={c} aria-pressed={diagram.surface.crop === c} onClick={() => setSurface({ crop: c })}>
                  <CropIcon crop={c} />
                  <span>
                    {c === 'three-quarter' ? '¾' : c === 'penalty-box' ? 'Box' : c === 'full' ? 'Full' : 'Half'}
                  </span>
                </button>
              ))}
            </div>
            <div className="segmented">
              {(['up', 'down', 'left', 'right'] as Facing[]).map((f) => (
                <button key={f} aria-pressed={diagram.surface.facing === f} onClick={() => setSurface({ facing: f })}>
                  {f}
                </button>
              ))}
            </div>
            <div className="segmented">
              {(['shaded', 'line'] as SurfaceStyle[]).map((st) => (
                <button key={st} aria-pressed={diagram.surface.style === st} onClick={() => setSurface({ style: st })}>
                  {st === 'shaded' ? 'Shaded' : 'Line art'}
                </button>
              ))}
            </div>
          </Panel>

          {selectedLabels.length > 0 && (
            <section>
              <h2>{selectedLabels.length > 1 ? `${selectedLabels.length} labels` : 'Label'}</h2>
              <input
                ref={labelInput}
                className="labelInput"
                value={selectedLabels.length === 1 ? selectedLabels[0].text : ''}
                placeholder={selectedLabels.length > 1 ? 'Set all…' : 'Label text'}
                maxLength={MAX_LABEL}
                onChange={(e) => editLabels({ text: e.target.value })}
              />
              <div className="segmented">
                {TEXT_SIZES.map((sz, i) => (
                  <button
                    key={sz}
                    aria-pressed={selectedLabels.every((l) => l.size === sz)}
                    onClick={() => editLabels({ size: sz })}
                  >
                    {['Small', 'Medium', 'Large'][i]}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2>Lines</h2>
            <p className="hint">
              Drag from where it starts to where it ends — the line keeps the
              shape you draw. Press the letter to pick a line, or to retype
              whatever is selected. S returns to select.
            </p>
            {LINE_SPECS.map((s) => (
              <button
                key={s.type}
                className={`lineBtn${
                  selectedLines.length > 0
                    ? selectedLines.every((l) => l.type === s.type)
                      ? ' on'
                      : ''
                    : isTool({ kind: 'line', type: s.type })
                      ? ' on'
                      : ''
                }`}
                onClick={() => applyLine(s.type)}
                title={s.meaning}
              >
                <svg viewBox="0 0 60 16" width="52" height="16" aria-hidden="true">
                  <path
                    // The squiggle comes from the same function the canvas
                    // draws with. Hand-written quadratics ended mid-oscillation,
                    // so the stroke met the flat arrow head at an angle — the
                    // icon disagreed with the mark it stands for.
                    d={s.wavy ? WAVY_ICON : 'M2,8 L48,8'}
                    fill="none"
                    stroke={s.stroke}
                    strokeWidth={2}
                    strokeDasharray={s.dash ? '7 5' : undefined}
                  />
                  <path d="M0,0 L-8,-4 L-8,4 Z" fill={s.stroke} transform="translate(56 8)" />
                </svg>
                <span>{s.label}</span>
                <kbd className="lineKey">{s.key.toUpperCase()}</kbd>
              </button>
            ))}
          </section>

          <Panel title="Kit colours">
            {TEAM_SPECS.map((t) => (
              <div className="colorRow" key={t.team}>
                <span className="colorLabel">{t.label}</span>
                <div className="swatches">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.hex}
                      className={`swatch${diagram.colors[t.team] === c.hex ? ' on' : ''}`}
                      style={{ background: c.hex }}
                      title={c.name}
                      aria-label={`${t.label}: ${c.name}`}
                      onClick={() =>
                        commitNow({ ...diagram, colors: { ...diagram.colors, [t.team]: c.hex } })
                      }
                    />
                  ))}
                  <input
                    type="color"
                    className="swatch swatchCustom"
                    value={diagram.colors[t.team]}
                    aria-label={`${t.label}: custom colour`}
                    onChange={(e) =>
                      commitNow({ ...diagram, colors: { ...diagram.colors, [t.team]: e.target.value } })
                    }
                  />
                </div>
              </div>
            ))}
          </Panel>

          <section>
            <h2>Players</h2>
            {TEAM_SPECS.map((t) => (
              <div className="teamBlock" key={t.team}>
                <div className="teamName">
                  {t.label} <span>{t.hint}</span>
                </div>
                <div className="numRow">
                  {NUMBER_GROUPS.flatMap((g) =>
                    g.numbers.map((n) => (
                      <button
                        key={n}
                        className={`numBtn${isTool({ kind: 'player', team: t.team, number: n }) ? ' on' : ''}`}
                        title={`${t.label} — ${g.name} ${n}`}
                        onClick={() => setTool({ kind: 'player', team: t.team, number: n })}
                      >
                        <svg viewBox="-32 -37 64 62" width="42" height="41" aria-hidden="true">
                          <PlayerToken team={t.team} number={n} x={0} y={0} colors={diagram.colors} />
                        </svg>
                      </button>
                    )),
                  )}
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2>Edit</h2>
            {/* Numbering happens on the board, not before it: a blank token
                placed by a small-sided template becomes the 6 once the coach
                decides it is the 6. */}
            {selectedPlayers.length > 0 && (
              <div className="shirtRow">
                <div className="teamName">
                  Shirt number{' '}
                  <span>
                    {selectedPlayers.length > 1
                      ? `${selectedPlayers.length} selected`
                      : 'selected player'}
                  </span>
                </div>
                <div className="numRow">
                  <button
                    className={`shirtBtn${selectedPlayers.every((p) => p.number === null) ? ' on' : ''}`}
                    onClick={() => numberSelected(null)}
                    title="No number"
                  >
                    —
                  </button>
                  {ALL_NUMBERS.map((n) => (
                    <button
                      key={n}
                      className={`shirtBtn${selectedPlayers.every((p) => p.number === n) ? ' on' : ''}`}
                      onClick={() => numberSelected(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  Or double-click a player and press Enter. Typing a number works
                  too — press 1 then 0 for the 10, 1 then 1 for the 11.
                </p>

                {/* Just these players, not the kit. This is how a neutral gets
                    its bib without moving to the other team. */}
                <div className="teamName">
                  Colour <span>these players only</span>
                </div>
                <div className="swatches">
                  <button
                    className={`swatch swatchKit${selectedPlayers.every((p) => !p.color) ? ' on' : ''}`}
                    title="Back to the team kit"
                    aria-label="Back to the team kit"
                    onClick={() => colorSelected(null)}
                  />
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.hex}
                      className={`swatch${selectedPlayers.every((p) => p.color === c.hex) ? ' on' : ''}`}
                      style={{ background: c.hex }}
                      title={c.name}
                      aria-label={c.name}
                      onClick={() => colorSelected(c.hex)}
                    />
                  ))}
                  <input
                    type="color"
                    className="swatch swatchCustom"
                    aria-label="Custom player colour"
                    value={selectedPlayers[0]?.color ?? diagram.colors[selectedPlayers[0].team]}
                    onChange={(e) => colorSelected(e.target.value)}
                  />
                </div>
              </div>
            )}
            <button onClick={() => setTool({ kind: 'select' })} aria-pressed={tool.kind === 'select'}>
              Select / move
              <kbd className="lineKey">S</kbd>
            </button>
            <button onClick={() => setTool({ kind: 'text' })} aria-pressed={tool.kind === 'text'}>
              Add a label
              <kbd className="lineKey">L</kbd>
            </button>
            <button
              disabled={selected.size === 0}
              onClick={() => {
                commitNow(deleteShapes(diagram, selected));
                setSelected(new Set());
              }}
            >
              {selected.size > 1 ? `Delete ${selected.size} selected` : 'Delete selected'}
            </button>
            <button
              disabled={diagram.shapes.length === 0}
              onClick={() => setSelected(new Set(diagram.shapes.map((s) => s.id)))}
            >
              Select all (⌘A)
            </button>
            <button
              onClick={() => {
                commitNow({ ...diagram, shapes: [] });
                setSelected(new Set());
              }}
            >
              Clear the field
            </button>
            <p className="hint">
              Shift-click to add to a selection, or drag a box on empty grass.
              Moving, deleting, copying and resizing apply to everything selected.
              Turn something by the handle above it and resize it by a corner; hold
              Shift while turning to snap. ⌘C, ⌘X, ⌘V and ⌘D do what you expect.
            </p>
          </section>
        </aside>

        <main className="stage">
          {/* The session's activities. Above the pitch because it is the frame
              around everything below it: which activity you are drawing. */}
          <div className="strip">
            {session.diagrams.map((d, i) => (
              <button
                key={i}
                className={`stripTab${i === active ? ' on' : ''}`}
                aria-pressed={i === active}
                onClick={() => pickDiagram(i)}
                onDoubleClick={() => setRenaming(i)}
                title={`${diagramLabel(d, i)} — double-click to rename`}
              >
                <span className="stripNo">{i + 1}</span>
                {renaming === i ? (
                  <input
                    autoFocus
                    className="stripName"
                    value={d.title}
                    placeholder={`Diagram ${i + 1}`}
                    maxLength={60}
                    onChange={(e) => commitNow({ ...d, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span>{diagramLabel(d, i)}</span>
                )}
              </button>
            ))}
            <button className="stripAdd" onClick={newDiagram} title="Add a diagram">
              +
            </button>
            <div className="stripSpacer" />
            <button
              className="stripAct"
              onClick={copyDiagram}
              title="Duplicate this diagram — usually the next phase of the same practice"
            >
              Duplicate
            </button>
            <button
              className="stripAct"
              onClick={() => shiftDiagram(-1)}
              disabled={active === 0}
              title="Move earlier in the session"
            >
              ←
            </button>
            <button
              className="stripAct"
              onClick={() => shiftDiagram(1)}
              disabled={active === session.diagrams.length - 1}
              title="Move later in the session"
            >
              →
            </button>
            <button
              className="stripAct"
              onClick={() => dropDiagram(active)}
              title="Delete this diagram"
            >
              Delete
            </button>
          </div>
          {/* Titles the printed sheet; hidden on screen, where the field at the
              top of the window already carries it. */}
          <h2 className="printTitle">
            {session.title ? `${session.title} — ` : ''}
            {diagramLabel(diagram, active)}
          </h2>
          <Canvas
            diagram={diagram}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
            onChange={change}
            // One rule for every tool: it stays armed until you aim at something
            // that is already there. Cones and arrows come in sets, so a tool
            // that disarmed after one use cost a trip to the palette for each;
            // and the click that used to drop a second player on the one you had
            // just placed now picks that player up instead.
            onSelectExisting={() => setTool({ kind: 'select' })}
            onEditShape={(id, at) => {
              const sh = diagram.shapes.find((s) => s.id === id);
              if (sh?.k === 'player') {
                setEdit({ id, kind: 'number', ...at, value: sh.number === null ? '' : String(sh.number) });
              } else if (sh?.k === 'text') {
                setEdit({ id, kind: 'text', ...at, value: sh.text });
              } else {
                return;
              }
              setSelected(new Set([id]));
            }}
          />
          {/* Editing happens on the thing itself, not across the screen. Enter
              finishes, Escape leaves it as it was, and an empty box is a real
              answer — no number, or a label with no words — rather than a
              cancelled edit. */}
          {edit && (
            <div
              className={`numberPop${edit.kind === 'text' ? ' wide' : ''}`}
              style={{ left: edit.x, top: edit.y }}
            >
              <input
                autoFocus
                inputMode={edit.kind === 'number' ? 'numeric' : 'text'}
                maxLength={edit.kind === 'number' ? 2 : MAX_LABEL}
                aria-label={edit.kind === 'number' ? 'Shirt number' : 'Label text'}
                placeholder={edit.kind === 'number' ? '—' : 'Label text'}
                value={edit.value}
                onChange={(e) =>
                  setEdit((s) =>
                    s
                      ? {
                          ...s,
                          value:
                            s.kind === 'number'
                              ? e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
                              : e.target.value.slice(0, MAX_LABEL),
                        }
                      : s,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEdit(null);
                }}
                onBlur={commitEdit}
              />
            </div>
          )}
          {/* The rest of the session, for paper only. A plan is handed over
              whole; printing whichever activity happened to be on screen would
              make the coach print four times and collate. */}
          {session.diagrams.length > 1 && (
            <div className="printRest">
              {session.diagrams.map((d, i) =>
                i === active ? null : (
                  <section key={i} className="printPage">
                    <h2 className="printTitle">
                      {session.title ? `${session.title} — ` : ''}
                      {diagramLabel(d, i)}
                    </h2>
                    <Canvas
                      diagram={d}
                      tool={{ kind: 'select' }}
                      selected={EMPTY}
                      onSelect={() => {}}
                      onChange={() => {}}
                    />
                  </section>
                ),
              )}
            </div>
          )}
        </main>

        <aside className="palette kitRail">
          <Panel title="Equipment">
            <div className="kitGrid">
              {EQUIPMENT.map((e) => (
                <button
                  key={e.id}
                  className={`kitBtn${isTool({ kind: 'kit', item: e.id }) ? ' on' : ''}`}
                  onClick={() => setTool({ kind: 'kit', item: e.id })}
                  title={e.label}
                >
                  <KitIcon item={e.id} />
                  <span>{e.label}</span>
                </button>
              ))}
            </div>
          </Panel>


          <Panel title="Templates">
            <p className="hint">
              Small-sided games: triangles against discs, both sides replaced.
              They go down blank — number them below once a number means
              something.
            </p>
            <div className="sidedGrid">
              {SMALL_SIDED.map((s) => (
                <button
                  key={sidedLabel(s)}
                  className="kitBtn"
                  onClick={() => applySmallSided(s)}
                  title={`${s.own} of yours against ${s.opp} opposition`}
                >
                  {sidedLabel(s)}
                </button>
              ))}
            </div>
            <div className="sidedCustom">
              <label>
                Mine
                <input
                  type="number"
                  min={1}
                  max={MAX_SIDE}
                  value={customSided.own}
                  onChange={(e) =>
                    setCustomSided((c) => ({ ...c, own: sideCount(e.target.value, c.own) }))
                  }
                />
              </label>
              <span>v</span>
              <label>
                Theirs
                <input
                  type="number"
                  min={1}
                  max={MAX_SIDE}
                  value={customSided.opp}
                  onChange={(e) =>
                    setCustomSided((c) => ({ ...c, opp: sideCount(e.target.value, c.opp) }))
                  }
                />
              </label>
              <button className="tmplBtn" onClick={() => applySmallSided(customSided)}>
                Place {sidedLabel(customSided)}
              </button>
            </div>

            <h2 className="sectionSplit">Full teams</h2>
            <div className="segmented">
              {TEAM_SPECS.map((t) => (
                <button
                  key={t.team}
                  aria-pressed={templateTeam === t.team}
                  onClick={() => setTemplateTeam(t.team)}
                >
                  {t.team === 'own' ? 'My team' : 'Opposition'}
                </button>
              ))}
            </div>
            <p className="hint">
              Drops a starting XI in shape. Replaces that team's players; move or
              renumber them afterwards.
            </p>
            {FORMATIONS.map((f) => (
              <button key={f.id} className="tmplBtn" onClick={() => applyFormation(f)}>
                {templateTeam === 'own' ? 'My team' : 'Opposition'} {f.label}
              </button>
            ))}
          </Panel>
        </aside>
      </div>

      <footer className="foot">
        <span>
          Standard coaching notation: solid for a pass, wavy for a dribble, dashed for a run off
          the ball, red for a tactical arrow.
        </span>
        <span>Runs entirely in your browser. Nothing is uploaded.</span>
      </footer>
    </div>
  );
}
