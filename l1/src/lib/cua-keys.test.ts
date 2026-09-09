import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserChordModifiers,
  browserEventToCua,
  browserEventToCuaBare,
  browserEventToCuaKey,
  browserModifierToCua,
  composeCuaKey,
  keyTokenFromCua,
  takeoverUsesKeyHold,
} from "./cua-keys.ts";

function ev(partial: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  return {
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

test("Ctrl+L maps to key ctrl+l, not a typed string", () => {
  const mapped = browserEventToCua(ev({ key: "l", ctrlKey: true }));
  assert.deepEqual(mapped, { kind: "key", key: "ctrl+l" });
  assert.equal(browserEventToCuaKey(ev({ key: "l", ctrlKey: true })), "ctrl+l");
  assert.equal(browserEventToCuaKey(ev({ key: "L", ctrlKey: true })), "ctrl+l");
  // Teach/Cook persist this as one tap. Down/up never focuses the omnibox.
  assert.notEqual(mapped, { kind: "key", key: "l" });
});

test("named keys become xdotool tokens", () => {
  assert.equal(browserEventToCuaKey(ev({ key: "Enter" })), "Return");
  assert.equal(browserEventToCuaKey(ev({ key: "Tab" })), "Tab");
  assert.equal(browserEventToCuaKey(ev({ key: "Escape" })), "Escape");
  assert.equal(browserEventToCuaKey(ev({ key: "Backspace" })), "BackSpace");
  assert.equal(browserEventToCuaKey(ev({ key: "ArrowLeft" })), "Left");
  assert.equal(browserEventToCuaKey(ev({ key: "ArrowUp" })), "Up");
  assert.equal(browserEventToCuaKey(ev({ key: "ArrowDown" })), "Down");
  assert.equal(browserEventToCuaKey(ev({ key: "ArrowRight" })), "Right");
});

test("plain letters become a key token for recipe key steps", () => {
  const mapped = browserEventToCua(ev({ key: "a" }));
  assert.deepEqual(mapped, { kind: "type", text: "a" });
  assert.equal(keyTokenFromCua(mapped!), "a");
  assert.equal(browserEventToCuaKey(ev({ key: " " })), "space");
});

test("composeCuaKey matches browserEventToCua chord order", () => {
  assert.equal(composeCuaKey("l", { ctrl: true }), "ctrl+l");
  assert.equal(composeCuaKey("l", { ctrl: true, shift: true }), "ctrl+shift+l");
  assert.equal(composeCuaKey("Return", { alt: true }), "alt+Return");
  const mapped = browserEventToCua(
    ev({ key: "l", ctrlKey: true, altKey: true, shiftKey: true }),
  );
  assert.equal(mapped && keyTokenFromCua(mapped), "ctrl+alt+shift+l");
  assert.equal(
    composeCuaKey("l", { ctrl: true, alt: true, shift: true }),
    "ctrl+alt+shift+l",
  );
});

test("meta is treated as ctrl; composing events are ignored", () => {
  assert.equal(browserEventToCuaKey(ev({ key: "l", metaKey: true })), "ctrl+l");
  assert.equal(browserEventToCua(ev({ key: "l", isComposing: true })), null);
  assert.equal(browserEventToCuaKey(ev({ key: "Control", ctrlKey: true })), null);
});

test("bare mapping ignores chords so takeover can hold Super/Ctrl", () => {
  assert.deepEqual(browserEventToCuaBare(ev({ key: "c", ctrlKey: true })), {
    kind: "type",
    text: "c",
  });
  assert.deepEqual(browserEventToCuaBare(ev({ key: "l", metaKey: true })), {
    kind: "type",
    text: "l",
  });
  assert.equal(browserEventToCuaBare(ev({ key: "Enter", ctrlKey: true }))?.kind, "key");
  assert.equal(keyTokenFromCua(browserEventToCuaBare(ev({ key: "Enter" }))!), "Return");
  assert.equal(browserEventToCuaBare(ev({ key: "Control" })), null);
});

test("composeCuaKey can include super for the OSK Meta toggle", () => {
  assert.equal(composeCuaKey("l", { super: true }), "super+l");
  assert.equal(composeCuaKey("l", { ctrl: true, super: true }), "ctrl+super+l");
});

test("modifier keys map to keydown/up, not type", () => {
  const down = browserModifierToCua({
    key: "Shift",
    type: "keydown",
    repeat: false,
    isComposing: false,
  } as KeyboardEvent);
  assert.deepEqual(down, { key: "shift", action: "down" });
  const up = browserModifierToCua({
    key: "Control",
    type: "keyup",
    repeat: false,
    isComposing: false,
  } as KeyboardEvent);
  assert.deepEqual(up, { key: "ctrl", action: "up" });
  const skipRepeat = browserModifierToCua({
    key: "Alt",
    type: "keydown",
    repeat: true,
    isComposing: false,
  } as KeyboardEvent);
  assert.equal(skipRepeat, null);
});

test("Ctrl+L is a held-key chord even if Control keydown was missed", () => {
  const held = new Set<string>();
  assert.equal(takeoverUsesKeyHold(ev({ key: "l", ctrlKey: true }), held), true);
  assert.deepEqual(browserChordModifiers(ev({ key: "l", ctrlKey: true })), ["ctrl"]);
  assert.equal(takeoverUsesKeyHold(ev({ key: "l" }), held), false);
  held.add("ctrl");
  assert.equal(takeoverUsesKeyHold(ev({ key: "l" }), held), true);
  assert.equal(takeoverUsesKeyHold(ev({ key: "A", shiftKey: true }), new Set()), false);
});
