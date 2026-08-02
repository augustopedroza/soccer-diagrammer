import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, deleteShapes, type Tool } from './components/Canvas';
import { PlayerToken } from './components/Tokens';
import { EQUIPMENT } from './data/equipment';
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
import { download, emptyDiagram, filename, parse, serialize } from './lib/file';
import { confineToBox, wavyPath } from './lib/geometry';
import { surfaceBox } from './lib/surfaceBox';
import { DEFAULT_SCALE, ROTATE_STEP, TEXT_SIZES, MAX_LABEL } from './types/diagram';
import type { Crop, Diagram, Facing, LineType, Shape, Sport, SurfaceStyle, Team } from './types/diagram';

const HISTORY_LIMIT = 60;

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
  const [diagram, setDiagram] = useState<Diagram>(emptyDiagram);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const past = useRef<Diagram[]>([]);
  const future = useRef<Diagram[]>([]);

  /**
   * `commit` separates a finished action from the frames of a drag. Without it
   * every pixel of a move would become its own undo step.
   */
  const change = useCallback(
    (next: Diagram, commit: boolean) => {
      setDiagram((prev) => {
        if (commit) {
          past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
          future.current = [];
        }
        return next;
      });
      setNotice(null);
    },
    [],
  );

  const commitNow = useCallback((next: Diagram) => change(next, true), [change]);

  const undo = useCallback(() => {
    setDiagram((prev) => {
      const last = past.current.pop();
      if (!last) return prev;
      future.current = [...future.current, prev];
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setDiagram((prev) => {
      const next = future.current.pop();
      if (!next) return prev;
      past.current = [...past.current, prev];
      return next;
    });
  }, []);

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

      setDiagram((prev) => {
        past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
        future.current = [];
        return { ...prev, shapes: [...prev.shapes, ...copies] };
      });
      setSelected(new Set(copies.map((c) => c.id)));
    },
    [],
  );

  /** Turns everything selected that has a facing. Labels and lines have none. */
  const rotateSelected = useCallback(
    (deltaOrAbsolute: number, absolute = false) => {
      setDiagram((prev) => {
        const next = {
          ...prev,
          shapes: prev.shapes.map((sh) =>
            selected.has(sh.id) && sh.k !== 'line'
              ? {
                  ...sh,
                  rot: absolute
                    ? deltaOrAbsolute
                    : (((sh.rot + deltaOrAbsolute) % 360) + 360) % 360,
                }
              : sh,
          ),
        };
        past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
        future.current = [];
        return next;
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
    const name = filename(diagram, 'json');
    download(name, serialize(diagram), 'application/json');
    setNotice(`Saved ${name}`);
  }, [diagram]);

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
    past.current = [...past.current, diagram];
    future.current = [];
    setDiagram(res.diagram);
    setSelected(new Set());
    setNotice(res.dropped > 0 ? `Opened. ${res.dropped} unreadable shape(s) were ignored.` : 'Opened.');
  }

  const [templateTeam, setTemplateTeam] = useState<Team>('own');
  const [customSided, setCustomSided] = useState<SmallSided>({ own: 4, opp: 3 });
  /** A just-typed 1, waiting to see whether a 0 or a 1 follows it. */
  const numberBuffer = useRef<{ first: number; at: number } | null>(null);
  /** The open shirt-number box: which player, where on screen, what is typed. */
  const [numberEdit, setNumberEdit] = useState<
    { id: string; x: number; y: number; value: string } | null
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
    if (selectedLabels.length !== 1) {
      focusedLabel.current = null;
      return;
    }
    const id = selectedLabels[0].id;
    if (focusedLabel.current === id) return;
    focusedLabel.current = id;
    labelInput.current?.focus();
    labelInput.current?.select();
  }, [selectedLabels]);

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
  function commitNumberEdit() {
    setNumberEdit((edit) => {
      if (!edit) return null;
      const raw = edit.value.trim();
      const n = raw === '' ? null : Number(raw);
      if (n === null || ALL_NUMBERS.includes(n)) {
        setDiagram((prev) => {
          past.current = [...past.current.slice(-HISTORY_LIMIT), prev];
          future.current = [];
          return {
            ...prev,
            shapes: prev.shapes.map((sh) =>
              sh.k === 'player' && sh.id === edit.id ? { ...sh, number: n } : sh,
            ),
          };
        });
      } else {
        setNotice(`${raw} is not a shirt number — 1 to 11, or empty for none.`);
      }
      return null;
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
          value={diagram.title}
          placeholder="Untitled session"
          onChange={(e) => setDiagram({ ...diagram, title: e.target.value })}
          aria-label="Diagram title"
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
            <div className="segmented">
              {(['full', 'three-quarter', 'half', 'penalty-box'] as Crop[]).map((c) => (
                <button key={c} aria-pressed={diagram.surface.crop === c} onClick={() => setSurface({ crop: c })}>
                  {c === 'three-quarter' ? '¾' : c === 'penalty-box' ? 'Box' : c === 'full' ? 'Full' : 'Half'}
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
              Drag from where it starts to where it ends. Hold Shift to curve. Press
              the letter to pick a line, or to retype whatever is selected. S returns
              to select.
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
          {/* Titles the printed sheet; hidden on screen, where the field at the
              top of the window already carries it. */}
          <h2 className="printTitle">{diagram.title || 'Session diagram'}</h2>
          <Canvas
            diagram={diagram}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
            onChange={change}
            // Every tool disarms once it has been used, lines included. Staying
            // armed meant the next click — usually meant to pick up what had just
            // been drawn — started another line instead, so a finished arrow
            // could not be hovered or clicked without first going back to Select.
            // Its keyboard shortcut re-arms it in one keystroke.
            onToolUsed={() => setTool({ kind: 'select' })}
            onEditNumber={(id, at) => {
              const p = diagram.shapes.find((s) => s.id === id);
              setNumberEdit({
                id,
                x: at.x,
                y: at.y,
                value: p?.k === 'player' && p.number !== null ? String(p.number) : '',
              });
              setSelected(new Set([id]));
            }}
          />
          {/* Renumbering happens on the player, not across the screen. Enter
              finishes, Escape leaves the shirt as it was, and an empty box means
              no number — which is a real answer here, not a cancelled edit. */}
          {numberEdit && (
            <div className="numberPop" style={{ left: numberEdit.x, top: numberEdit.y }}>
              <input
                autoFocus
                inputMode="numeric"
                maxLength={2}
                aria-label="Shirt number"
                placeholder="—"
                value={numberEdit.value}
                onChange={(e) =>
                  setNumberEdit((s) =>
                    s ? { ...s, value: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) } : s,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitNumberEdit();
                  if (e.key === 'Escape') setNumberEdit(null);
                }}
                onBlur={commitNumberEdit}
              />
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
                  {e.label}
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
