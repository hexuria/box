import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const panel = readFileSync(new URL("../components/recipe-panel.tsx", import.meta.url), "utf8");
const pane = readFileSync(new URL("../components/cook-results-pane.tsx", import.meta.url), "utf8");
const gallery = readFileSync(
  new URL("../components/cook-artifact-gallery.tsx", import.meta.url),
  "utf8",
);
const rawRoute = readFileSync(
  new URL("../app/api/boxes/[id]/files/raw/route.ts", import.meta.url),
  "utf8",
);
const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

test("Cook sends the selected table version, not always Edit", () => {
  assert.match(panel, /planJsonForView\(planRef\.current, teachDraft, version\)/);
  assert.match(panel, /onCookThisVersion/);
  assert.match(panel, /onCookAll/);
  assert.match(panel, /cookVersionsToRun\(teachDraft != null\)/);
  assert.doesNotMatch(panel, /Read-only snapshot\. Cook and Save use Edit/);
  assert.match(actions, /prepareCookSteps\(parsed\.steps as RecipeStepJson\[\], version\)/);
  assert.match(actions, /settle: cookSettleMode\(version\)/);
});

test("recipe steps table is still the v1 v2 v3 plan editor", () => {
  assert.match(panel, /Raw \(v1\)/);
  assert.match(panel, /Compressed \(v2\)/);
  assert.match(panel, /Edit \(v3\)/);
  assert.match(panel, /<th className="w-28 px-3 py-2 font-medium">Result<\/th>/);
  assert.match(panel, /stepResultAt\(tableReceipt, index\)/);
});

test("results pane has independent version selector, tabs, history, and clear dialog", () => {
  assert.match(panel, /<CookResultsPane/);
  assert.match(pane, /Cached cook/);
  assert.match(pane, /Artifacts/);
  assert.match(pane, /<TabsTrigger value="json">JSON<\/TabsTrigger>/);
  assert.match(pane, /<TabsTrigger value="screenshot"/);
  assert.match(pane, /<TabsTrigger value="recording"/);
  assert.match(pane, /<TabsTrigger value="both">Both<\/TabsTrigger>/);
  assert.match(pane, /History ·/);
  assert.match(pane, /Clear every cached cook/);
  assert.match(pane, /No \{VERSION_LABEL\[resultVersion\]\} cook yet/);
});

test("L1 cook <video> has controls, source mime, and remuxes fMP4", () => {
  assert.match(gallery, /<video/);
  assert.match(gallery, /\bcontrols\b/);
  assert.match(gallery, /<source src=\{src\} type=\{mime\} \/>/);
  assert.match(gallery, /video\/mp4/);
  assert.match(rawRoute, /content-type": mime/);
  assert.match(rawRoute, /remuxMp4Faststart/);
});
