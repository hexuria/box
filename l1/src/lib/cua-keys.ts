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

export type CuaKeyMods = {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  super?: boolean;
};

/** Chord order matches `browserEventToCua`: ctrl, alt, shift, super, then the token. */
export function composeCuaKey(token: string, mods: CuaKeyMods = {}): string {
  const parts: string[] = [];
  if (mods.ctrl) {
    parts.push("ctrl");
  }
  if (mods.alt) {
    parts.push("alt");
  }
  if (mods.shift) {
    parts.push("shift");
  }
  if (mods.super) {
    parts.push("super");
  }
  parts.push(token);
  return parts.join("+");
}

/** Recipe `key` steps store an xdotool token, including single typed characters. */
export function keyTokenFromCua(input: CuaInput): string {
  if (input.kind === "key") {
    return input.key;
  }
  if (input.text === " ") {
    return "space";
  }
  return input.text;
}

export function browserEventToCuaKey(event: KeyboardEvent): string | null {
  const mapped = browserEventToCua(event);
  return mapped ? keyTokenFromCua(mapped) : null;
}

/**
 * Key or typed character with no modifier chord. Takeover sends Ctrl/Alt/Super
 * as keydown/up, so the following key must not become `ctrl+c` (or map Meta to
 * Ctrl) and must not run `xdotool key --clearmodifiers`.
 */
export function browserEventToCuaBare(event: KeyboardEvent): CuaInput | null {
  if (event.isComposing) {
    return null;
  }
  if (browserModifierToken(event.key)) {
    return null;
  }
  const named = NAMED[event.key];
  if (event.key.length === 1) {
    return { kind: "type", text: event.key };
  }
  if (named) {
    return { kind: "key", key: named };
  }
  return null;
}

export function browserEventToCua(event: KeyboardEvent): CuaInput | null {
  if (event.isComposing) {
    return null;
  }
  if (browserModifierToken(event.key)) {
    return null;
  }
  const named = NAMED[event.key];
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  if (chord) {
    const token =
      named ?? (event.key.length === 1 ? event.key.toLowerCase() : null);
    if (!token) {
      return null;
    }
    return {
      kind: "key",
      key: composeCuaKey(token, {
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey,
      }),
    };
  }
  return browserEventToCuaBare(event);
}

const MODIFIER_TOKENS: Record<string, string> = {
  Control: "ctrl",
  Shift: "shift",
  Alt: "alt",
  Meta: "super",
};

export function browserModifierToken(key: string): string | null {
  return MODIFIER_TOKENS[key] ?? null;
}

/** Held modifier keys: keydown/keyup of Control, Shift, Alt, Meta. */
export function browserModifierToCua(
  event: KeyboardEvent,
): { key: string; action: "down" | "up" } | null {
  if (event.isComposing || event.repeat) {
    return null;
  }
  const token = browserModifierToken(event.key);
  if (!token) {
    return null;
  }
  return {
    key: token,
    action: event.type === "keyup" ? "up" : "down",
  };
}

/** Ctrl/Alt/Super currently down on the host event (Shift is not a chord). */
export function browserChordModifiers(event: KeyboardEvent): string[] {
  const keys: string[] = [];
  if (event.ctrlKey) {
    keys.push("ctrl");
  }
  if (event.altKey) {
    keys.push("alt");
  }
  if (event.metaKey) {
    keys.push("super");
  }
  return keys;
}

/**
 * Takeover must keydown/up the following key while Ctrl/Alt/Super stay held.
 * Shift alone is typed as the character (`A`), not a chord.
 */
export function takeoverUsesKeyHold(
  event: KeyboardEvent,
  heldMods: ReadonlySet<string>,
): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return true;
  }
  for (const key of heldMods) {
    if (key === "ctrl" || key === "alt" || key === "super") {
      return true;
    }
  }
  return false;
}
