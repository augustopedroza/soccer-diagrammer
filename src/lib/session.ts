import { MAX_DIAGRAMS, type Diagram, type Session } from '../types/diagram';

/**
 * The activities in a session, as operations on the whole thing.
 *
 * Pure and here rather than in the component, because every one of them has an
 * answer that is easy to get subtly wrong — which diagram is showing after a
 * delete, what a duplicate is called, what happens when the last one goes — and
 * those answers are worth testing without a browser.
 */

/** Where the view should land after a list operation. Never off either end. */
export const clampIndex = (i: number, length: number) =>
  Math.max(0, Math.min(length - 1, i));

export function addDiagram(
  session: Session,
  at: number,
  made: Diagram,
): { session: Session; active: number } {
  if (session.diagrams.length >= MAX_DIAGRAMS) return { session, active: at };
  const diagrams = [...session.diagrams];
  diagrams.splice(at + 1, 0, made);
  // Straight after the one it came from, and showing: adding something you then
  // have to go and find is a worse answer than adding nothing.
  return { session: { ...session, diagrams }, active: at + 1 };
}

/**
 * Copies a diagram, next to the original.
 *
 * The name gets "copy" appended rather than being cleared: a duplicate is
 * usually the next phase of the same practice, and an untitled one in a strip of
 * named tabs is the one you cannot find again.
 */
export function duplicateDiagram(session: Session, at: number): { session: Session; active: number } {
  const source = session.diagrams[at];
  if (!source) return { session, active: at };
  const copy: Diagram = {
    ...source,
    title: source.title ? `${source.title} copy` : '',
    surface: { ...source.surface },
    colors: { ...source.colors },
    // Deep enough that editing the copy cannot reach back into the original.
    shapes: source.shapes.map((s) => ({ ...s })),
  };
  return addDiagram(session, at, copy);
}

/**
 * Removes a diagram, and says what to show instead.
 *
 * A session always has at least one: deleting the last one empties it rather
 * than leaving the app with nothing to draw on.
 */
export function removeDiagram(
  session: Session,
  at: number,
  blank: () => Diagram,
): { session: Session; active: number } {
  if (session.diagrams.length <= 1) {
    return { session: { ...session, diagrams: [blank()] }, active: 0 };
  }
  const diagrams = session.diagrams.filter((_, i) => i !== at);
  // The one that took its place, or the new last one if the end went.
  return { session: { ...session, diagrams }, active: clampIndex(at, diagrams.length) };
}

/** Replaces the diagram at `at`, leaving the rest of the session alone. */
export function replaceDiagram(session: Session, at: number, next: Diagram): Session {
  return { ...session, diagrams: session.diagrams.map((d, i) => (i === at ? next : d)) };
}

/** Moves a diagram along the strip, so the session can be put in running order. */
export function moveDiagram(session: Session, from: number, to: number): { session: Session; active: number } {
  const target = clampIndex(to, session.diagrams.length);
  if (from === target || !session.diagrams[from]) return { session, active: from };
  const diagrams = [...session.diagrams];
  const [moved] = diagrams.splice(from, 1);
  diagrams.splice(target, 0, moved);
  return { session: { ...session, diagrams }, active: target };
}

/** What a diagram is called in the strip when it has not been named. */
export const diagramLabel = (d: Diagram, index: number) =>
  d.title.trim() || `Diagram ${index + 1}`;
