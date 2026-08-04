/**
 * Is this key going into something the user is typing in?
 *
 * Every letter in this app is a shortcut, so the answer decides whether typing
 * "pass into space" arms the pass tool, retypes the selected line and renumbers
 * a player on the way through. It checked only `INPUT` at first and the notes
 * field is a `TEXTAREA`, which is exactly that bug — so this is a named,
 * tested rule rather than a comparison inlined in a handler.
 *
 * `contentEditable` and `SELECT` are here for the same reason, before something
 * uses one and the bug comes back wearing a different tag.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
