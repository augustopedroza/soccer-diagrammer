import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, deleteShapes, type Tool } from './components/Canvas';
import { PlayerToken } from './components/Tokens';
import { EQUIPMENT } from './data/equipment';
import { FORMATIONS, placements, type Formation } from './data/formations';
import { COLOR_PRESETS, LINE_SPECS, NUMBER_GROUPS, TEAM_SPECS } from './data/notation';
import { download, emptyDiagram, filename, parse, serialize } from './lib/file';
import { surfaceBox } from './lib/surfaceBox';
import { ROTATE_STEP, TEXT_SIZES, MAX_LABEL } from './types/diagram';
import type { Crop, Diagram, Facing, LineType, Shape, Sport, SurfaceStyle, Team } from './types/diagram';

const HISTORY_LIMIT = 60;

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
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
        clipboard.current = diagram.shapes.filter((sh) => selected.has(sh.id));
        if (clipboard.current.length > 0) {
          setNotice(`Copied ${clipboard.current.length}.`);
        }
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
  }, [undo, redo, selected, diagram, commitNow, applyLine, rotateSelected, pasteShapes]);

  const setSurface = (patch: Partial<Diagram['surface']>) =>
    commitNow({ ...diagram, surface: { ...diagram.surface, ...patch } });

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
      scale: 1,
      x: Math.round(p.fx * box.w),
      y: Math.round(p.fy * box.h),
    }));
    commitNow({
      ...diagram,
      shapes: [...diagram.shapes.filter((s) => !(s.k === 'player' && s.team === templateTeam)), ...placed],
    });
    setSelected(new Set());
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
        <button onClick={undo} title="Undo (⌘Z)">Undo</button>
        <button onClick={redo} title="Redo (⇧⌘Z)">Redo</button>
        <button onClick={() => fileInput.current?.click()}>Open</button>
        <button onClick={() => { download(filename(diagram, 'json'), serialize(diagram), 'application/json'); setNotice(`Saved ${filename(diagram, 'json')}`); }}>
          Save
        </button>
        <button className="primary" onClick={exportSvg}>Export image</button>
        <button onClick={() => window.print()}>Print</button>
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

      {notice && <div className="notice">{notice}</div>}

      <div className="work">
        <aside className="palette">
          <section>
            <h2>Surface</h2>
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
          </section>

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
                    d={s.wavy ? 'M2,8 q6,-6 12,0 t12,0 t12,0 t12,0' : 'M2,8 L48,8'}
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

          <section>
            <h2>Kit colours</h2>
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
          </section>

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
            // Placement tools disarm: staying armed meant the next click, usually
            // meant to pick that player up, dropped a second one on top of it. A
            // line needs a drag, so it cannot misfire and stays armed for the
            // next one.
            onToolUsed={() => {
              setTool((t) =>
                t.kind === 'player' || t.kind === 'kit' || t.kind === 'text'
                  ? { kind: 'select' }
                  : t,
              );
            }}
          />
        </main>

        <aside className="palette kitRail">
          <section>
            <h2>Equipment</h2>
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
          </section>


          <section>
            <h2>Templates</h2>
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
          </section>
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
