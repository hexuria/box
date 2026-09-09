import {
  cloneRecipeSteps,
  compressRecipeSteps,
  foldOmniboxChords,
} from "./recipe-compress";
import {
  CATALOG,
  emptyPlan,
  parsePlan,
  stringifyPlan,
  type RecipePlan,
  type RecipeStepJson,
} from "./recipe-plan";

export const RECIPES_STORAGE_KEY = "l1.recipes.v1";
export const DRAFT_STORAGE_PREFIX = "l1.recipe.draft.";
export const RECIPE_DRAFTS_STORAGE_KEY = "l1.recipeDrafts.v1";

export type RecipeTeachDraft = {
  id: string;
  name: string;
  createdAt: string;
  v1: RecipeStepJson[];
  v2: RecipeStepJson[];
  v3: RecipeStepJson[];
};

export type TeachRecordingSend = {
  planJson: string;
  v1: RecipeStepJson[];
  v2: RecipeStepJson[];
};

export type StoredRecipe = {
  id: string;
  name: string;
  blurb?: string;
  seeded?: boolean;
  updatedAt: string;
  plan: RecipePlan;
};

export type RecipeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

function memoryStorage(): RecipeStorage {
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

/** Shared fallback so save + list never write/read different throwaway Maps. */
const sharedMemory = memoryStorage();
let cachedBrowserStorage: RecipeStorage | null | undefined;

function browserStorage(): RecipeStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (cachedBrowserStorage !== undefined) {
    return cachedBrowserStorage;
  }
  try {
    const ls = window.localStorage;
    if (!ls) {
      cachedBrowserStorage = null;
      return null;
    }
    cachedBrowserStorage = {
      getItem(key) {
        try {
          return ls.getItem(key);
        } catch {
          return null;
        }
      },
      setItem(key, value) {
        ls.setItem(key, value);
      },
      removeItem(key) {
        ls.removeItem?.(key);
      },
    };
    return cachedBrowserStorage;
  } catch {
    cachedBrowserStorage = null;
    return null;
  }
}

function defaultStorage(): RecipeStorage {
  return browserStorage() ?? sharedMemory;
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 8);
  return `user-${slug || "recipe"}-${rand}`;
}

function seedRecipes(): StoredRecipe[] {
  const stamped = "1970-01-01T00:00:00.000Z";
  return CATALOG.map((item) => {
    const id = `seed-${item.id}`;
    return {
      id,
      name: item.name,
      blurb: item.blurb,
      seeded: true,
      updatedAt: stamped,
      plan: { ...item.plan, id, name: item.name },
    };
  });
}

function isStoredRecipe(item: unknown): item is StoredRecipe {
  if (!item || typeof item !== "object") {
    return false;
  }
  const record = item as StoredRecipe;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    !!record.plan &&
    typeof record.plan === "object" &&
    Array.isArray(record.plan.steps)
  );
}

function readUserRecipes(storage: RecipeStorage): StoredRecipe[] {
  const raw = storage.getItem(RECIPES_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredRecipe);
  } catch {
    return [];
  }
}

function writeUserRecipes(storage: RecipeStorage, recipes: StoredRecipe[]): void {
  const users = recipes.filter((item) => !item.seeded);
  storage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(users));
}

export function uniqueCopyName(name: string, existingNames: Iterable<string>): string {
  const taken = new Set(
    [...existingNames].map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
  const base = name.trim() || "recipe";
  const stripped = base.replace(/\s+copy(?:\s+\d+)?$/i, "").trim() || base;
  const stem = `${stripped} copy`;
  if (!taken.has(stem.toLowerCase())) {
    return stem;
  }
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${stem} ${Date.now()}`;
}

function recipeHaystack(item: StoredRecipe): string {
  const stepBits = (item.plan.steps ?? []).flatMap((step) => {
    const bits = [String(step.op)];
    if (typeof step.text === "string") {
      bits.push(step.text);
    }
    if (typeof step.key === "string") {
      bits.push(step.key);
    }
    return bits;
  });
  return [item.id, item.name, item.blurb ?? "", item.plan.name ?? "", ...stepBits]
    .join(" ")
    .toLowerCase();
}

export function listRecipes(storage: RecipeStorage = defaultStorage()): StoredRecipe[] {
  const users = readUserRecipes(storage);
  const userIds = new Set(users.map((item) => item.id));
  const seeds = seedRecipes().filter((seed) => !userIds.has(seed.id));
  const usersNewestFirst = [...users].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const seedsByName = [...seeds].sort((a, b) => a.name.localeCompare(b.name));
  return [...usersNewestFirst, ...seedsByName];
}

export function searchRecipes(
  query: string,
  storage: RecipeStorage = defaultStorage(),
): StoredRecipe[] {
  const needle = query.trim().toLowerCase();
  const all = listRecipes(storage);
  if (!needle) {
    return all;
  }
  return all.filter((item) => recipeHaystack(item).includes(needle));
}

function resolveSaveId(plan: RecipePlan, existingId?: string): string {
  const fromArg = existingId?.trim();
  if (fromArg) {
    return fromArg;
  }
  const fromPlan = typeof plan.id === "string" ? plan.id.trim() : "";
  if (fromPlan) {
    return fromPlan;
  }
  return slugId((plan.name ?? "recipe").trim() || "recipe");
}

export function saveRecipe(
  name: string,
  plan: RecipePlan,
  existingId?: string,
  storage: RecipeStorage = defaultStorage(),
): StoredRecipe {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required.");
  }
  const users = readUserRecipes(storage);
  const id = resolveSaveId({ ...plan, name: trimmed }, existingId);
  const previous = users.find((item) => item.id === id);
  const record: StoredRecipe = {
    id,
    name: trimmed,
    blurb: previous?.blurb,
    seeded: false,
    updatedAt: nowIso(),
    plan: {
      ...plan,
      id,
      name: trimmed,
      steps: [...(plan.steps ?? [])],
    },
  };
  const next = users.filter((item) => item.id !== id);
  next.push(record);
  writeUserRecipes(storage, next);
  return record;
}

export function cloneRecipe(
  plan: RecipePlan,
  storage: RecipeStorage = defaultStorage(),
): StoredRecipe {
  const listed = listRecipes(storage);
  const name = uniqueCopyName(
    (plan.name ?? "recipe").trim() || "recipe",
    listed.map((item) => item.name),
  );
  const id = slugId(name);
  return saveRecipe(
    name,
    {
      ...plan,
      id,
      name,
      steps: [...(plan.steps ?? [])],
    },
    id,
    storage,
  );
}

export function deleteRecipe(id: string, storage: RecipeStorage = defaultStorage()): void {
  writeUserRecipes(
    storage,
    readUserRecipes(storage).filter((item) => item.id !== id),
  );
}

export function loadDraft(boxId: string, storage: RecipeStorage = defaultStorage()): string | null {
  const raw = storage.getItem(`${DRAFT_STORAGE_PREFIX}${boxId}`);
  if (!raw) {
    return null;
  }
  const parsed = parsePlan(raw);
  return "plan" in parsed ? raw : null;
}

export function saveDraft(
  boxId: string,
  text: string,
  storage: RecipeStorage = defaultStorage(),
): void {
  storage.setItem(`${DRAFT_STORAGE_PREFIX}${boxId}`, text);
}

export function newRecipeJson(name = "recipe"): string {
  return stringifyPlan(emptyPlan(name));
}

export function planWithIdentity(plan: RecipePlan, id: string, name: string): RecipePlan {
  return {
    ...plan,
    id,
    name,
    steps: [...(plan.steps ?? [])],
  };
}

function isStepArray(value: unknown): value is RecipeStepJson[] {
  return (
    Array.isArray(value) &&
    value.every(
      (step) => step && typeof step === "object" && typeof (step as RecipeStepJson).op === "string",
    )
  );
}

function isTeachDraft(item: unknown): item is RecipeTeachDraft {
  if (!item || typeof item !== "object") {
    return false;
  }
  const record = item as RecipeTeachDraft;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.createdAt === "string" &&
    isStepArray(record.v1) &&
    isStepArray(record.v2) &&
    isStepArray(record.v3)
  );
}

function readTeachDrafts(storage: RecipeStorage): Record<string, RecipeTeachDraft> {
  const raw = storage.getItem(RECIPE_DRAFTS_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, RecipeTeachDraft> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isTeachDraft(value)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeTeachDrafts(
  storage: RecipeStorage,
  drafts: Record<string, RecipeTeachDraft>,
): void {
  storage.setItem(RECIPE_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

export function createTeachDraft(
  name: string,
  v1: RecipeStepJson[],
  v2?: RecipeStepJson[],
): RecipeTeachDraft {
  const raw = foldOmniboxChords(cloneRecipeSteps(v1));
  const compressed = foldOmniboxChords(
    cloneRecipeSteps(v2 ?? compressRecipeSteps(raw)),
  );
  return {
    id: `teach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: nowIso(),
    v1: raw,
    v2: compressed,
    v3: cloneRecipeSteps(compressed),
  };
}

export function loadTeachDraft(
  boxId: string,
  storage: RecipeStorage = defaultStorage(),
): RecipeTeachDraft | null {
  return readTeachDrafts(storage)[boxId] ?? null;
}

export function saveTeachDraft(
  boxId: string,
  draft: RecipeTeachDraft,
  storage: RecipeStorage = defaultStorage(),
): void {
  const drafts = readTeachDrafts(storage);
  drafts[boxId] = draft;
  writeTeachDrafts(storage, drafts);
}

export function clearTeachDraft(
  boxId: string,
  storage: RecipeStorage = defaultStorage(),
): void {
  const drafts = readTeachDrafts(storage);
  if (!(boxId in drafts)) {
    return;
  }
  delete drafts[boxId];
  writeTeachDrafts(storage, drafts);
}

export function syncTeachDraftEditor(
  draft: RecipeTeachDraft,
  name: string,
  v3: RecipeStepJson[],
): RecipeTeachDraft {
  return {
    ...draft,
    name,
    v3: cloneRecipeSteps(v3),
  };
}

export function resetTeachDraftFromCompressed(draft: RecipeTeachDraft): RecipeTeachDraft {
  return {
    ...draft,
    v3: cloneRecipeSteps(draft.v2),
  };
}

export type TeachView = "v1" | "v2" | "v3";

/** JSON for the recipe currently on screen (Raw / Compressed / Edit). */
export function planJsonForView(
  planText: string,
  teachDraft: RecipeTeachDraft | null,
  teachView: TeachView,
): string {
  if (!teachDraft || teachView === "v3") {
    return planText;
  }
  const parsed = parsePlan(planText);
  const base = "plan" in parsed ? parsed.plan : emptyPlan(teachDraft.name);
  const steps = teachView === "v1" ? teachDraft.v1 : teachDraft.v2;
  return stringifyPlan({
    ...base,
    name: teachDraft.name,
    steps: cloneRecipeSteps(steps),
  });
}
