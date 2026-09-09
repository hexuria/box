import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecipePlan } from "./recipe-plan.ts";
import {
  cloneRecipe,
  clearTeachDraft,
  createTeachDraft,
  listRecipes,
  loadTeachDraft,
  planJsonForView,
  RECIPE_DRAFTS_STORAGE_KEY,
  RECIPES_STORAGE_KEY,
  resetTeachDraftFromCompressed,
  saveRecipe,
  saveTeachDraft,
  searchRecipes,
  syncTeachDraftEditor,
  uniqueCopyName,
  type RecipeStorage,
} from "./recipe-store.ts";

function memory(): RecipeStorage {
  const data = new Map<string, string>();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function googleLikePlan(name: string, url: string, id?: string): RecipePlan {
  return {
    id,
    name,
    stop_on_error: true,
    screenshot: "end",
    steps: [
      { op: "click", x: 640, y: 80, button: 1 },
      { op: "key", key: "ctrl+l" },
      { op: "type", text: url },
      { op: "key", key: "Return" },
    ],
  };
}

test("save recipe named x.com is returned by list and search", () => {
  const storage = memory();
  const saved = saveRecipe(
    "x.com",
    googleLikePlan("x.com", "https://x.com"),
    undefined,
    storage,
  );
  assert.equal(saved.name, "x.com");
  assert.match(saved.id, /^user-/);
  assert.equal(saved.seeded, false);

  const raw = storage.getItem(RECIPES_STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as unknown;
  assert.ok(Array.isArray(parsed));
  assert.equal((parsed as { name: string }[])[0]?.name, "x.com");

  const listed = listRecipes(storage);
  assert.ok(listed.some((item) => item.id === saved.id && item.name === "x.com"));
  assert.ok(listed.some((item) => item.name === "Open Google"));

  const found = searchRecipes("x.com", storage);
  assert.ok(found.length >= 1);
  assert.equal(found[0]?.id, saved.id);
  assert.equal(found[0]?.name, "x.com");
});

test("save updates the selected recipe in place with a new name", () => {
  const storage = memory();
  const first = saveRecipe(
    "Open Google",
    googleLikePlan("Open Google", "https://www.google.com", "seed-open-google"),
    "seed-open-google",
    storage,
  );
  assert.equal(first.id, "seed-open-google");

  const renamed = saveRecipe(
    "x.com",
    googleLikePlan("x.com", "https://x.com", first.id),
    first.id,
    storage,
  );
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.name, "x.com");

  const listed = listRecipes(storage);
  assert.ok(listed.some((item) => item.id === first.id && item.name === "x.com"));
  assert.equal(
    listed.filter((item) => item.id === "seed-open-google").length,
    1,
  );
  assert.ok(!listed.some((item) => item.id === "seed-open-google" && item.name === "Open Google"));

  const found = searchRecipes("x.com", storage);
  assert.ok(found.some((item) => item.id === first.id));
});

test("clone produces a second entry with a unique id and copy name", () => {
  const storage = memory();
  const saved = saveRecipe(
    "x.com",
    googleLikePlan("x.com", "https://x.com"),
    undefined,
    storage,
  );
  const cloned = cloneRecipe(saved.plan, storage);
  assert.notEqual(cloned.id, saved.id);
  assert.equal(cloned.name, "x.com copy");
  assert.equal(cloned.plan.name, "x.com copy");
  assert.equal(cloned.plan.id, cloned.id);

  const listed = listRecipes(storage);
  const userNamed = listed.filter((item) => item.name === "x.com" || item.name === "x.com copy");
  assert.equal(userNamed.length, 2);

  const copyHits = searchRecipes("x.com copy", storage);
  assert.ok(copyHits.some((item) => item.id === cloned.id));
  assert.ok(searchRecipes("x.com", storage).some((item) => item.id === saved.id));
});

test("clone uniquifies names when copy already exists", () => {
  const storage = memory();
  const saved = saveRecipe("x.com", googleLikePlan("x.com", "https://x.com"), undefined, storage);
  cloneRecipe(saved.plan, storage);
  const second = cloneRecipe(saved.plan, storage);
  assert.equal(second.name, "x.com copy 2");
  assert.equal(uniqueCopyName("x.com copy", ["x.com", "x.com copy"]), "x.com copy 2");
});

test("saveRecipe uses plan.id when existingId is omitted", () => {
  const storage = memory();
  const first = saveRecipe(
    "a.com",
    googleLikePlan("a.com", "https://a.com"),
    undefined,
    storage,
  );
  const renamed = saveRecipe("x.com", { ...first.plan, name: "x.com" }, undefined, storage);
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.name, "x.com");
  assert.equal(listRecipes(storage).filter((item) => item.id === first.id).length, 1);
  assert.ok(searchRecipes("x.com", storage).some((item) => item.id === first.id));
});

test("saved recipes are not dropped in favor of CATALOG seeds", () => {
  const storage = memory();
  saveRecipe("youtube.com", googleLikePlan("youtube.com", "https://youtube.com"), undefined, storage);
  saveRecipe("facebook.com", googleLikePlan("facebook.com", "https://facebook.com"), undefined, storage);
  const listed = listRecipes(storage);
  assert.ok(listed.some((item) => item.name === "youtube.com" && !item.seeded));
  assert.ok(listed.some((item) => item.name === "facebook.com" && !item.seeded));
  assert.ok(listed.some((item) => item.seeded && item.name === "Open Google"));
  const userIndex = listed.findIndex((item) => item.name === "facebook.com");
  const seedIndex = listed.findIndex((item) => item.seeded);
  assert.ok(userIndex >= 0 && seedIndex >= 0 && userIndex < seedIndex);
});

test("createTeachDraft folds ctrl down/up plus l into one ctrl+l on v1 v2 v3", () => {
  const draft = createTeachDraft("recorded", [
    { op: "click", x: 36, y: 772, button: 1 },
    { op: "key", key: "ctrl", action: "down" },
    { op: "key", key: "l", action: "down" },
    { op: "key", key: "l", action: "up" },
    { op: "key", key: "ctrl", action: "up" },
    { op: "type", text: "facebook.com" },
    { op: "key", key: "Return" },
  ]);
  const chord = { op: "key", key: "ctrl+l" };
  assert.deepEqual(draft.v1[1], chord);
  assert.deepEqual(draft.v2[1], chord);
  assert.deepEqual(draft.v3[1], chord);
  assert.equal(
    draft.v1.some((step) => step.key === "ctrl" || step.key === "l"),
    false,
  );
});

test("teach draft stores v1 v2 v3 and library save keeps v3 only", () => {
  const storage = memory();
  const v1 = [
    { op: "type", text: "g" },
    { op: "wait", ms: 910 },
    { op: "type", text: "oogle.com" },
    { op: "key", key: "Return" },
  ];
  const draft = createTeachDraft("recorded", v1);
  assert.deepEqual(draft.v1, v1);
  assert.deepEqual(draft.v2, [
    { op: "type", text: "google.com" },
    { op: "key", key: "Return" },
  ]);
  assert.deepEqual(draft.v3, draft.v2);
  draft.v3.push({ op: "wait", ms: 1 });
  assert.equal(draft.v2.length, 2);

  saveTeachDraft("box-1", draft, storage);
  const loaded = loadTeachDraft("box-1", storage);
  assert.ok(loaded);
  assert.equal(loaded.id, draft.id);
  assert.ok(storage.getItem(RECIPE_DRAFTS_STORAGE_KEY)?.includes("\"v1\""));

  const edited = syncTeachDraftEditor(draft, "recorded", [
    ...draft.v2,
    { op: "scroll", x: 1, y: 2, dx: 0, dy: 120 },
  ]);
  const saved = saveRecipe(
    edited.name,
    { name: edited.name, stop_on_error: true, screenshot: "end", steps: edited.v3 },
    undefined,
    storage,
  );
  assert.deepEqual(saved.plan.steps, edited.v3);
  assert.equal("v1" in saved.plan, false);
  assert.equal("v2" in saved.plan, false);

  clearTeachDraft("box-1", storage);
  assert.equal(loadTeachDraft("box-1", storage), null);
});

test("resetTeachDraftFromCompressed restores v3 from v2 without touching v1", () => {
  const draft = createTeachDraft("recorded", [
    { op: "type", text: "ab" },
    { op: "key", key: "Return" },
  ]);
  const edited = syncTeachDraftEditor(draft, "recorded", [{ op: "type", text: "changed" }]);
  const reset = resetTeachDraftFromCompressed(edited);
  assert.deepEqual(reset.v3, draft.v2);
  assert.deepEqual(reset.v1, draft.v1);
  assert.notEqual(reset.v3, reset.v2);
});

test("planJsonForView copies the on-screen version, not always Edit", () => {
  const v1 = [
    { op: "type", text: "g" },
    { op: "wait", ms: 910 },
    { op: "type", text: "oogle.com" },
    { op: "key", key: "Return" },
  ];
  const draft = createTeachDraft("recorded", v1);
  const edited = syncTeachDraftEditor(draft, "recorded", [
    { op: "type", text: "edited.com" },
    { op: "key", key: "Return" },
  ]);
  const planText = JSON.stringify({
    name: "recorded",
    stop_on_error: true,
    screenshot: "end",
    steps: edited.v3,
  });

  const raw = JSON.parse(planJsonForView(planText, edited, "v1")) as RecipePlan;
  assert.deepEqual(raw.steps, v1);

  const compressed = JSON.parse(planJsonForView(planText, edited, "v2")) as RecipePlan;
  assert.deepEqual(compressed.steps, edited.v2);

  assert.equal(planJsonForView(planText, edited, "v3"), planText);
  assert.equal(planJsonForView(planText, null, "v1"), planText);
});

