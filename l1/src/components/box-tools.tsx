"use client";

import { useActionState, useState } from "react";
import {
  execAction,
  readFileAction,
  writeFileAction,
} from "@/lib/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DesktopViewer } from "@/components/desktop-viewer";
import { RecipePanel } from "@/components/recipe-panel";
import { SMOKE_RECIPE } from "@/lib/recipe-plan";

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

export function BoxTools({ id, disabled }: { id: string; disabled: boolean }) {
  const execBound = execAction.bind(null, id);
  const writeBound = writeFileAction.bind(null, id);
  const readBound = readFileAction.bind(null, id);
  const [execState, execFormAction, execPending] = useActionState(execBound, {});
  const [writeState, writeFormAction, writePending] = useActionState(writeBound, {});
  const [readState, readFormAction, readPending] = useActionState(readBound, {});
  const [tab, setTab] = useState("cua");
  const [recipeText, setRecipeText] = useState(SMOKE_RECIPE);

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
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

      <div
        className={
          tab === "cua"
            ? "space-y-3"
            : "pointer-events-none fixed top-0 left-[-1600px] z-[-1] w-[1280px] overflow-hidden opacity-0"
        }
        aria-hidden={tab !== "cua"}
        data-desktop-keepalive=""
      >
        <DesktopViewer
          id={id}
          disabled={disabled}
          active={tab === "cua"}
          onSendToRecipe={(plan) => {
            setRecipeText(plan);
            setTab("recipe");
          }}
        />
      </div>

      <TabsContent value="recipe" className="space-y-3" keepMounted>
        <RecipePanel
          id={id}
          disabled={disabled}
          planText={recipeText}
          onPlanTextChange={setRecipeText}
        />
      </TabsContent>
    </Tabs>
  );
}
