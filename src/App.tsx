import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, deleteShapes, type Tool } from './components/Canvas';
import { PlayerToken } from './components/Tokens';
import { EQUIPMENT } from './data/equipment';
import { COLOR_PRESETS, LINE_SPECS, NUMBER_GROUPS, TEAM_SPECS } from './data/notation';
import { download, emptyDiagram, filename, parse, serialize } from './lib/file';
import type { Crop, Diagram, Facing, Sport, SurfaceStyle } from './types/diagram';

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
      if (e.key === 'Escape') {
        setTool({ kind: 'select' });
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selected, diagram, commitNow]);

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

  // Lines in the current selection, so their type can be changed after drawing.
  const selectedLines = diagram.shapes.filter(
    (s): s is Extract<typeof s, { k: 'line' }> => s.k === 'line' && selected.has(s.id),
  );

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
                {NUMBER_GROUPS.map((g) => (
                  <div className="numRow" key={g.name}>
                    {g.numbers.map((n) => (
                      <button
                        key={n}
                        className={`numBtn${isTool({ kind: 'player', team: t.team, number: n }) ? ' on' : ''}`}
                        title={`${t.label} — ${g.name} ${n}`}
                        onClick={() => setTool({ kind: 'player', team: t.team, number: n })}
                      >
                        <svg viewBox="-32 -37 64 56" width="46" height="40" aria-hidden="true">
                          <PlayerToken team={t.team} number={n} x={0} y={0} colors={diagram.colors} />
                        </svg>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </section>

          {selectedLines.length > 0 && (
            <section>
              <h2>
                {selectedLines.length > 1
                  ? `${selectedLines.length} lines selected`
                  : 'Selected line'}
              </h2>
              <p className="hint">Change what it means — the stroke follows.</p>
              {LINE_SPECS.map((sp) => {
                const all = selectedLines.every((l) => l.type === sp.type);
                return (
                  <button
                    key={sp.type}
                    className={`lineBtn${all ? ' on' : ''}`}
                    onClick={() =>
                      commitNow({
                        ...diagram,
                        shapes: diagram.shapes.map((sh) =>
                          sh.k === 'line' && selected.has(sh.id) ? { ...sh, type: sp.type } : sh,
                        ),
                      })
                    }
                  >
                    <svg viewBox="0 0 60 16" width="52" height="16" aria-hidden="true">
                      <path
                        d={sp.wavy ? 'M2,8 q6,-6 12,0 t12,0 t12,0 t12,0' : 'M2,8 L48,8'}
                        fill="none"
                        stroke={sp.stroke}
                        strokeWidth={2}
                        strokeDasharray={sp.dash ? '7 5' : undefined}
                      />
                      <path d="M0,0 L-8,-4 L-8,4 Z" fill={sp.stroke} transform="translate(56 8)" />
                    </svg>
                    <span>{sp.label}</span>
                  </button>
                );
              })}
            </section>
          )}

          <section>
            <h2>Lines</h2>
            <p className="hint">Drag from where it starts to where it ends. Hold Shift to curve.</p>
            {LINE_SPECS.map((s) => (
              <button
                key={s.type}
                className={`lineBtn${isTool({ kind: 'line', type: s.type }) ? ' on' : ''}`}
                onClick={() => setTool({ kind: 'line', type: s.type })}
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
              </button>
            ))}
          </section>

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
            <h2>Edit</h2>
            <button onClick={() => setTool({ kind: 'select' })} aria-pressed={tool.kind === 'select'}>
              Select / move
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
              Shift-click to add to a selection, or drag a box on empty grass. Moving
              or deleting applies to everything selected.
            </p>
          </section>
        </aside>

        <main className="stage">
          <Canvas
            diagram={diagram}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
            onChange={change}
            // Back to select after anything is placed. Staying armed meant the
            // next click — usually meant to pick that player up — dropped a
            // second one on top of it.
            onToolUsed={() => setTool({ kind: 'select' })}
          />
        </main>
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
