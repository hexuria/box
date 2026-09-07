"use client";

import { useActionState, useState } from "react";
import {
  clickAction,
  execAction,
  keyAction,
  readFileAction,
  recipeAction,
  screenshotAction,
  scrollAction,
  typeAction,
  writeFileAction,
} from "@/lib/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FRAMEBUFFER } from "@/lib/config";
import type { RecipeReceipt } from "@/lib/types";

const SMOKE_RECIPE = `{
  "name": "focus-and-search",
  "stop_on_error": true,
  "screenshot": "end",
  "steps": [
    { "op": "move", "x": 640, "y": 80 },
    { "op": "click", "x": 640, "y": 80, "button": 1 },
    { "op": "type", "text": "https://example.com" },
    { "op": "key", "key": "Return" },
    { "op": "wait", "ms": 400 }
  ]
}`;

const LINT_FAIL_RECIPE = `{
  "name": "lint-fail",
  "stop_on_error": true,
  "screenshot": "end",
  "steps": [
    { "op": "click", "x": 1280, "y": 0, "button": 1 }
  ]
}`;

function Result({ value }: { value: unknown }) {
  if (value == null) {
    return null;
  }
  const record = value as {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    content?: string;
  };
  if (typeof record.stdout === "string" || typeof record.exit_code === "number") {
    return (
      <div className="space-y-2">
        {typeof record.exit_code === "number" ? (
          <p className="text-xs text-zinc-500">exit {record.exit_code}</p>
        ) : null}
        {record.stdout ? (
          <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
            {record.stdout}
          </pre>
        ) : null}
        {record.stderr ? (
          <pre className="max-h-40 overflow-auto rounded-lg bg-zinc-900 p-3 text-xs text-red-200">
            {record.stderr}
          </pre>
        ) : null}
      </div>
    );
  }
  if (typeof record.content === "string") {
    return (
      <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
        {record.content}
      </pre>
    );
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RecipeReceiptView({ receipt }: { receipt: RecipeReceipt }) {
  const steps = receipt.steps ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={receipt.ok ? "default" : "destructive"}>
          {receipt.ok ? "ok" : "not ok"}
        </Badge>
        {receipt.name ? (
          <span className="text-xs text-zinc-500">{receipt.name}</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">ran</dt>
          <dd className="font-mono">{receipt.ran ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">stopped_at</dt>
          <dd className="font-mono">
            {receipt.stopped_at == null ? "—" : receipt.stopped_at}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">duration_ms</dt>
          <dd className="font-mono">{receipt.duration_ms ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">steps</dt>
          <dd className="font-mono">{steps.length}</dd>
        </div>
      </dl>
      {steps.length > 0 ? (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          {steps.map((step, i) => (
            <li
              key={step.index ?? i}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="w-6 font-mono text-xs text-zinc-500">
                {step.index ?? i}
              </span>
              <span className="font-mono">{step.op ?? "?"}</span>
              <Badge variant={step.ok ? "secondary" : "destructive"}>
                {step.ok ? "ok" : "fail"}
              </Badge>
              <span className="font-mono text-xs text-zinc-500">
                {step.ms ?? "—"}ms
              </span>
              {step.error ? (
                <span className="text-xs text-destructive">{step.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
        {JSON.stringify(receipt, null, 2)}
      </pre>
    </div>
  );
}

export function BoxTools({ id, disabled }: { id: string; disabled: boolean }) {
  const execBound = execAction.bind(null, id);
  const writeBound = writeFileAction.bind(null, id);
  const readBound = readFileAction.bind(null, id);
  const [execState, execFormAction, execPending] = useActionState(execBound, {});
  const [writeState, writeFormAction, writePending] = useActionState(writeBound, {});
  const [readState, readFormAction, readPending] = useActionState(readBound, {});
  const [shot, setShot] = useState<{
    png: string;
    width: number;
    height: number;
  } | null>(null);
  const [cuaError, setCuaError] = useState<string | null>(null);
  const [cuaBusy, setCuaBusy] = useState(false);
  const [typeText, setTypeText] = useState("hello from L1");
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null);
  const [recipeText, setRecipeText] = useState(SMOKE_RECIPE);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [recipeLintFailed, setRecipeLintFailed] = useState(false);
  const [recipeReceipt, setRecipeReceipt] = useState<RecipeReceipt | null>(null);
  const [recipeShot, setRecipeShot] = useState<{
    png: string;
    width: number;
    height: number;
  } | null>(null);

  async function runCua(task: () => Promise<{ error?: string }>, refreshShot = false) {
    setCuaBusy(true);
    setCuaError(null);
    const result = await task();
    if (result.error) {
      setCuaError(result.error);
      setCuaBusy(false);
      return;
    }
    if (refreshShot) {
      const next = await screenshotAction(id);
      if (next.error) {
        setCuaError(next.error);
      } else if (next.png) {
        setShot({
          png: next.png,
          width: next.width ?? FRAMEBUFFER.width,
          height: next.height ?? FRAMEBUFFER.height,
        });
      }
    }
    setCuaBusy(false);
  }

  async function onScreenshot() {
    await runCua(async () => screenshotAction(id).then((result) => {
      if (result.error) {
        return result;
      }
      if (result.png) {
        setShot({
          png: result.png,
          width: result.width ?? FRAMEBUFFER.width,
          height: result.height ?? FRAMEBUFFER.height,
        });
      }
      return {};
    }));
  }

  async function onImageClick(event: React.MouseEvent<HTMLImageElement>) {
    if (disabled || cuaBusy || !shot) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(
      ((event.clientX - rect.left) / rect.width) * shot.width,
    );
    const y = Math.round(
      ((event.clientY - rect.top) / rect.height) * shot.height,
    );
    setLastClick({ x, y });
    await runCua(() => clickAction(id, x, y), true);
  }

  async function onRunRecipe() {
    setRecipeBusy(true);
    setRecipeError(null);
    setRecipeLintFailed(false);
    setRecipeReceipt(null);
    try {
      const next = await recipeAction(id, recipeText);
      if (next.error) {
        setRecipeError(next.error);
        setRecipeLintFailed(!!next.lintFailed);
        return;
      }
      if (next.result) {
        setRecipeReceipt(next.result);
      }
      if (next.png) {
        setRecipeShot({
          png: next.png,
          width: next.width ?? FRAMEBUFFER.width,
          height: next.height ?? FRAMEBUFFER.height,
        });
      } else {
        setRecipeShot(null);
      }
    } finally {
      setRecipeBusy(false);
    }
  }

  return (
    <Tabs defaultValue="shell">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="shell">Shell</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="cua">Desktop</TabsTrigger>
        <TabsTrigger value="recipe">Recipe</TabsTrigger>
      </TabsList>

      <TabsContent value="shell" className="space-y-3">
        <form action={execFormAction} className="space-y-2">
          <Label htmlFor="command">Command</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="command"
              name="command"
              defaultValue="echo ok"
              disabled={disabled}
              className="font-mono"
            />
            <Button type="submit" disabled={disabled || execPending}>
              {execPending ? "Running…" : "Run"}
            </Button>
          </div>
        </form>
        {execState.error ? (
          <Alert variant="destructive">
            <AlertDescription>{execState.error}</AlertDescription>
          </Alert>
        ) : null}
        <Result value={execState.result} />
      </TabsContent>

      <TabsContent value="files" className="space-y-4">
        <form action={readFormAction} className="space-y-2">
          <Label htmlFor="read-path">Read path</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="read-path"
              name="path"
              defaultValue="notes.txt"
              disabled={disabled}
              className="font-mono"
            />
            <Button type="submit" variant="outline" disabled={disabled || readPending}>
              {readPending ? "Reading…" : "Read"}
            </Button>
          </div>
        </form>
        {readState.error ? (
          <Alert variant="destructive">
            <AlertDescription>{readState.error}</AlertDescription>
          </Alert>
        ) : null}
        <Result value={readState.result} />

        <form action={writeFormAction} className="space-y-2">
          <Label htmlFor="write-path">Write path</Label>
          <Input
            id="write-path"
            name="path"
            defaultValue="notes.txt"
            disabled={disabled}
            className="font-mono"
          />
          <Label htmlFor="content">Contents</Label>
          <Textarea
            id="content"
            name="content"
            defaultValue="written by the L1 client through EnsureBox"
            disabled={disabled}
            rows={5}
          />
          <Button type="submit" disabled={disabled || writePending}>
            {writePending ? "Writing…" : "Write file"}
          </Button>
        </form>
        {writeState.error ? (
          <Alert variant="destructive">
            <AlertDescription>{writeState.error}</AlertDescription>
          </Alert>
        ) : null}
        <Result value={writeState.result} />
      </TabsContent>

      <TabsContent value="cua" className="space-y-3">
        <p className="text-sm text-zinc-600">
          Coordinate space is {FRAMEBUFFER.width}×{FRAMEBUFFER.height}. Click
          the image to click the desktop.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled || cuaBusy} onClick={onScreenshot}>
            {cuaBusy ? "Working…" : "Screenshot"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || cuaBusy}
            onClick={() => runCua(() => scrollAction(id, 0, 120), true)}
          >
            Scroll down
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || cuaBusy}
            onClick={() => runCua(() => keyAction(id, "Return"))}
          >
            Return
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={typeText}
            onChange={(event) => setTypeText(event.target.value)}
            disabled={disabled || cuaBusy}
            aria-label="Text to type"
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || cuaBusy || !typeText}
            onClick={() => runCua(() => typeAction(id, typeText))}
          >
            Type
          </Button>
        </div>
        {lastClick ? (
          <p className="text-xs text-zinc-500">
            Last click {lastClick.x},{lastClick.y}
          </p>
        ) : null}
        {cuaError ? (
          <Alert variant="destructive">
            <AlertDescription>{cuaError}</AlertDescription>
          </Alert>
        ) : null}
        {shot ? (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">
              {shot.width}×{shot.height} PNG
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Box desktop screenshot"
              src={`data:image/png;base64,${shot.png}`}
              onClick={onImageClick}
              className="w-full max-w-3xl cursor-crosshair rounded-lg border border-zinc-200 bg-black"
            />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            No screenshot yet. Capture one after the box is ready.
          </p>
        )}
      </TabsContent>

      <TabsContent value="recipe" className="space-y-3">
        <p className="text-sm text-zinc-600">
          One HTTP call through EnsureBox runs this plan on the guest
          (coordinate space {FRAMEBUFFER.width}×{FRAMEBUFFER.height}, origin
          top-left). The guest lints first; a 400 means nothing moved.
        </p>
        {disabled ? (
          <p className="text-sm text-zinc-500">
            Box is not ready. Recipes stay disabled until the workspace is
            ready.
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="recipe-json">Plan JSON</Label>
          <Textarea
            id="recipe-json"
            value={recipeText}
            onChange={(event) => setRecipeText(event.target.value)}
            disabled={disabled || recipeBusy}
            rows={16}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={disabled || recipeBusy}
            onClick={() => void onRunRecipe()}
          >
            {recipeBusy ? "Running…" : "Run"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || recipeBusy}
            onClick={() => setRecipeText(SMOKE_RECIPE)}
          >
            Smoke plan
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || recipeBusy}
            onClick={() => setRecipeText(LINT_FAIL_RECIPE)}
          >
            Lint-fail (x=1280)
          </Button>
        </div>
        {recipeError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {recipeError}
              {recipeLintFailed && /out_of_range|outside/i.test(recipeError)
                ? " Coordinates are 0…1279 × 0…799; x=1280 is out of range on purpose."
                : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {recipeReceipt ? <RecipeReceiptView receipt={recipeReceipt} /> : null}
        {!recipeReceipt && !recipeError && !recipeBusy ? (
          <p className="text-sm text-zinc-500">
            Run a recipe to see a receipt and an end screenshot. Use lint-fail
            to see HTTP 400 without moving the pointer.
          </p>
        ) : null}
        {recipeShot ? (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">
              {recipeShot.width}×{recipeShot.height} PNG
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Recipe end screenshot"
              src={`data:image/png;base64,${recipeShot.png}`}
              className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-black"
            />
          </div>
        ) : recipeReceipt && !recipeError ? (
          <p className="text-sm text-zinc-500">
            No screenshot on this receipt (screenshot: none, or the run stopped
            before a capture).
          </p>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
