import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOG,
  appendRecordedStep,
  commitStepFields,
  emptyPlanJson,
  insertStep,
  moveStepAt,
  parsePlan,
  RECIPE_OPS,
  removeStepAt,
  replaceStepAt,
  reorderSteps,
  summarizeStep,
} from "./recipe-plan.ts";
import { listRecipes, saveRecipe, searchRecipes } from "./recipe-store.ts";
import {
  displayPath,
  joinWorkspace,
  parentPath,
  workspaceRelative,
} from "./workspace-path.ts";

test("empty plan has no steps", () => {
  const parsed = parsePlan(emptyPlanJson("demo"));
  assert.ok("plan" in parsed);
  assert.equal(parsed.plan.name, "demo");
  assert.deepEqual(parsed.plan.steps, []);
});

test("insert move remove and replace steps", () => {
  let text = emptyPlanJson();
  text = insertStep(text, { op: "click", x: 1, y: 2, button: 1 });
  text = insertStep(text, { op: "key", key: "Return" });
  text = moveStepAt(text, 1, -1);
  const parsed = parsePlan(text);
  assert.ok("plan" in parsed);
  assert.equal(parsed.plan.steps[0]?.op, "key");
  text = replaceStepAt(text, 0, { op: "wait", ms: 50 });
  text = removeStepAt(text, 0);
  const next = parsePlan(text);
  assert.ok("plan" in next);
  assert.equal(next.plan.steps.length, 1);
  assert.equal(next.plan.steps[0]?.op, "click");
});

test("summarizeStep is compact", () => {
  assert.equal(summarizeStep({ op: "click", x: 640, y: 80 }), "640,80");
  assert.equal(summarizeStep({ op: "type", text: "hi" }), '"hi"');
  assert.equal(summarizeStep({ op: "wait", ms: 400 }), "400ms");
  assert.equal(summarizeStep({ op: "reset_desktop" }), "close windows");
});

test("reorderSteps moves a row by index", () => {
  let text = emptyPlanJson();
  text = insertStep(text, { op: "click", x: 1, y: 2, button: 1 });
  text = insertStep(text, { op: "key", key: "Return" });
  text = insertStep(text, { op: "wait", ms: 10 });
  text = reorderSteps(text, 2, 0);
  const parsed = parsePlan(text);
  assert.ok("plan" in parsed);
  assert.equal(parsed.plan.steps[0]?.op, "wait");
  assert.equal(parsed.plan.steps[1]?.op, "click");
  assert.equal(parsed.plan.steps[2]?.op, "key");
});

test("commitStepFields validates coords wait and URLs", () => {
  const click = commitStepFields({ op: "click", x: 1, y: 2, button: 1 }, { x: "1280", y: "10" });
  assert.ok("errors" in click);
  assert.match(click.errors.x ?? "", /0…1279/);

  const okClick = commitStepFields({ op: "click", x: 1, y: 2, button: 1 }, { x: "1279", y: "799" });
  assert.ok("step" in okClick);
  assert.equal(okClick.step.x, 1279);
  assert.equal(okClick.step.y, 799);
  assert.equal(okClick.step.button, 1);

  const wait = commitStepFields({ op: "wait", ms: 1 }, { ms: "10001" });
  assert.ok("errors" in wait);

  const waitOk = commitStepFields({ op: "wait", ms: 1 }, { ms: "0" });
  assert.ok("step" in waitOk);
  assert.equal(waitOk.step.ms, 0);

  const press = commitStepFields(
    { op: "press", x: 1, y: 2, button: 1 },
    { x: "10", y: "20" },
  );
  assert.ok("step" in press);
  assert.equal(press.step.button, 1);

  const keyDown = commitStepFields(
    { op: "key", key: "shift" },
    { key: "shift", action: "down" },
  );
  assert.ok("step" in keyDown);
  assert.equal(keyDown.step.action, "down");

  const badUrl = commitStepFields(
    { op: "type", text: "x" },
    { text: "https://not a url" },
  );
  assert.ok("errors" in badUrl);

  const www = commitStepFields({ op: "type", text: "x" }, { text: "www.google.com" });
  assert.ok("step" in www);

  const phrase = commitStepFields({ op: "type", text: "x" }, { text: "hello world" });
  assert.ok("step" in phrase);

  const scroll = commitStepFields(
    { op: "scroll", x: 1, y: 2, dx: 1, dy: 1 },
    { x: "10", y: "10", dx: "0", dy: "0" },
  );
  assert.ok("errors" in scroll);
});

test("catalog has Open Google plus four more examples", () => {
  assert.ok(CATALOG.length >= 5);
  assert.equal(CATALOG[0]?.name, "Open Google");
  assert.ok(CATALOG.some((item) => item.id === "lint-fail"));
  assert.ok(CATALOG.some((item) => item.id === "scroll-page"));
  assert.ok(CATALOG.some((item) => item.id === "type-url"));
  assert.ok(CATALOG.some((item) => item.id === "focus-omnibox"));
  assert.ok(CATALOG.some((item) => item.id === "reset-desktop"));
  assert.ok(RECIPE_OPS.some((item) => item.op === "reset_desktop"));
});

test("recipe store seeds at least five and can save/search", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return mem.has(key) ? mem.get(key)! : null;
    },
    setItem(key: string, value: string) {
      mem.set(key, value);
    },
  };
  const listed = listRecipes(storage);
  assert.ok(listed.length >= 5);
  assert.ok(listed.some((item) => item.name === "Open Google"));
  saveRecipe("My plan", { name: "My plan", steps: [{ op: "wait", ms: 10 }] }, undefined, storage);
  const found = searchRecipes("my plan", storage);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.name, "My plan");
  const google = searchRecipes("google", storage);
  assert.ok(google.some((item) => item.name === "Open Google"));
});

test("appendRecordedStep skips wait between type and BackSpace fragments", () => {
  let steps = appendRecordedStep([], { op: "type", text: "g" }, 0);
  steps = appendRecordedStep(steps, { op: "type", text: "oo" }, 910);
  steps = appendRecordedStep(steps, { op: "key", key: "BackSpace" }, 500);
  assert.deepEqual(steps, [
    { op: "type", text: "g" },
    { op: "type", text: "oo" },
    { op: "key", key: "BackSpace" },
  ]);
});

test("appendRecordedStep still inserts wait after Return before click", () => {
  let steps = appendRecordedStep([], { op: "key", key: "Return" }, 0);
  steps = appendRecordedStep(steps, { op: "click", x: 1, y: 2, button: 1 }, 900);
  assert.deepEqual(steps, [
    { op: "key", key: "Return" },
    { op: "wait", ms: 900 },
    { op: "click", x: 1, y: 2, button: 1 },
  ]);
});

test("appendRecordedStep keeps page-load wait after Return before type", () => {
  let steps = appendRecordedStep([], { op: "type", text: "facebook.com" }, 0);
  steps = appendRecordedStep(steps, { op: "key", key: "Return" }, 80);
  steps = appendRecordedStep(steps, { op: "type", text: "user@example.com" }, 2400);
  assert.deepEqual(steps, [
    { op: "type", text: "facebook.com" },
    { op: "key", key: "Return" },
    { op: "wait", ms: 2400 },
    { op: "type", text: "user@example.com" },
  ]);
});

test("workspace paths stay under /workspace", () => {
  assert.equal(workspaceRelative("/workspace/notes/a.txt"), "notes/a.txt");
  assert.equal(workspaceRelative(""), "");
  assert.equal(joinWorkspace("notes", "a.txt"), "notes/a.txt");
  assert.equal(joinWorkspace("", "notes"), "notes");
  assert.equal(parentPath("notes/a.txt"), "notes");
  assert.equal(parentPath("notes"), "");
  assert.equal(displayPath(""), "/workspace");
  assert.equal(displayPath("notes"), "/workspace/notes");
});
