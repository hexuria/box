/** Map a browser KeyboardEvent to a grok-box CUA type/key payload. */

const NAMED: Record<string, string> = {
  Enter: "Return",
  Backspace: "BackSpace",
  Delete: "Delete",
  Tab: "Tab",
  Escape: "Escape",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Home: "Home",
  End: "End",
  PageUp: "Page_Up",
  PageDown: "Page_Down",
  " ": "space",
};

export type CuaInput = { kind: "type"; text: string } | { kind: "key"; key: string };

export function browserEventToCua(event: KeyboardEvent): CuaInput | null {
  if (event.isComposing) {
    return null;
  }
  const named = NAMED[event.key];
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  if (chord) {
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) {
      parts.push("ctrl");
    }
    if (event.altKey) {
      parts.push("alt");
    }
    if (event.shiftKey) {
      parts.push("shift");
    }
    const token =
      named ??
      (event.key.length === 1 ? event.key.toLowerCase() : null);
    if (!token) {
      return null;
    }
    parts.push(token);
    return { kind: "key", key: parts.join("+") };
  }
  if (event.key.length === 1) {
    return { kind: "type", text: event.key };
  }
  if (named) {
    return { kind: "key", key: named };
  }
  return null;
}
