/**
 * Every keyboard shortcut, as data.
 *
 * Here rather than inline in the panel so it can be checked against the app:
 * `tests/diagram.test.ts` asserts that each line type's own letter is listed, so
 * adding a fifth line type without telling anyone fails a test rather than
 * quietly shipping a key nobody can discover.
 */

export interface Shortcut {
  keys: string[];
  what: string;
}

export interface ShortcutGroup {
  name: string;
  items: Shortcut[];
}

/** Written with the Mac modifier; the panel swaps it for Ctrl elsewhere. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: 'Drawing',
    items: [
      { keys: ['P'], what: 'Pass or shot' },
      { keys: ['D'], what: 'Dribble' },
      { keys: ['R'], what: 'Run off the ball' },
      { keys: ['T'], what: 'Tactical arrow' },
      { keys: ['S'], what: 'Select / move' },
      { keys: ['L'], what: 'Add a label' },
      { keys: ['Esc'], what: 'Back to Select, nothing selected' },
    ],
  },
  {
    name: 'The selection',
    items: [
      { keys: ['Shift', 'click'], what: 'Add to or remove from the selection' },
      { keys: ['drag'], what: 'A box on empty grass selects what it covers' },
      { keys: ['↑', '↓', '←', '→'], what: 'Nudge a unit' },
      { keys: ['Shift', '↑'], what: 'Nudge ten' },
      { keys: ['[', ']'], what: 'Turn 15°' },
      { keys: ['⌫'], what: 'Delete' },
      { keys: ['⌘A'], what: 'Select everything' },
    ],
  },
  {
    name: 'Players',
    items: [
      { keys: ['double-click'], what: 'Renumber a player, or reword a label' },
      { keys: ['1', '…', '9'], what: 'Number the selected players' },
      { keys: ['1', 'then', '0'], what: 'The 10 — and 1 then 1 for the 11' },
      { keys: ['0'], what: 'No number' },
    ],
  },
  {
    name: 'The session',
    items: [
      { keys: ['⌘Z'], what: 'Undo' },
      { keys: ['⇧⌘Z'], what: 'Redo' },
      { keys: ['⌘C', '⌘X', '⌘V'], what: 'Copy, cut, paste' },
      { keys: ['⌘D'], what: 'Duplicate in place' },
      { keys: ['⌘O'], what: 'Open' },
      { keys: ['⌘S'], what: 'Save' },
      { keys: ['⌘P'], what: 'Print' },
      { keys: ['?'], what: 'This list' },
    ],
  },
];
