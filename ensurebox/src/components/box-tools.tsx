"use client";

import { useActionState, useState } from "react";
import {
  clickAction,
  execAction,
  keyAction,
  screenshotAction,
  typeAction,
  writeFileAction,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";

function Result({ value }: { value: unknown }) {
  if (value == null) {
    return null;
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
  const [execState, execFormAction, execPending] = useActionState(execBound, {});
  const [fileState, fileFormAction, filePending] = useActionState(writeBound, {});
  const [shot, setShot] = useState<{ png: string; width?: number; height?: number } | null>(
    null,
  );
  const [cuaError, setCuaError] = useState<string | null>(null);
  const [cuaBusy, setCuaBusy] = useState(false);

  async function onScreenshot() {
    setCuaBusy(true);
    setCuaError(null);
    const result = await screenshotAction(id);
    setCuaBusy(false);
    if (result.error) {
      setCuaError(result.error);
      return;
    }
    if (result.png) {
      setShot({ png: result.png, width: result.width, height: result.height });
    }
  }

  async function onClickCenter() {
    setCuaBusy(true);
    setCuaError(null);
    const result = await clickAction(id, 640, 400);
    setCuaBusy(false);
    if (result.error) {
      setCuaError(result.error);
    }
  }

  async function onTypeHello() {
    setCuaBusy(true);
    setCuaError(null);
    const result = await typeAction(id, "hello from ensurebox");
    setCuaBusy(false);
    if (result.error) {
      setCuaError(result.error);
    }
  }

  async function onReturn() {
    setCuaBusy(true);
    setCuaError(null);
    const result = await keyAction(id, "Return");
    setCuaBusy(false);
    if (result.error) {
      setCuaError(result.error);
    }
  }

  return (
    <Tabs defaultValue="shell">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="shell">Shell</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="cua">Computer use</TabsTrigger>
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

      <TabsContent value="files" className="space-y-3">
        <form action={fileFormAction} className="space-y-2">
          <Label htmlFor="path">Workspace path</Label>
          <Input id="path" name="path" defaultValue="notes.txt" disabled={disabled} />
          <Label htmlFor="content">Contents</Label>
          <Textarea
            id="content"
            name="content"
            defaultValue="written by EnsureBox"
            disabled={disabled}
            rows={5}
          />
          <Button type="submit" disabled={disabled || filePending}>
            {filePending ? "Writing…" : "Write file"}
          </Button>
        </form>
        {fileState.error ? (
          <Alert variant="destructive">
            <AlertDescription>{fileState.error}</AlertDescription>
          </Alert>
        ) : null}
        <Result value={fileState.result} />
      </TabsContent>

      <TabsContent value="cua" className="space-y-3">
        <p className="text-sm text-zinc-600">
          Coordinate space is the box framebuffer 1280×800. Screenshot talks to
          box-exec; the model still lives in L4.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled || cuaBusy} onClick={onScreenshot}>
            {cuaBusy ? "Working…" : "Screenshot"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || cuaBusy}
            onClick={onClickCenter}
          >
            Click center
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || cuaBusy}
            onClick={onTypeHello}
          >
            Type hello
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || cuaBusy}
            onClick={onReturn}
          >
            Key Return
          </Button>
        </div>
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
              alt="Box screenshot"
              src={`data:image/png;base64,${shot.png}`}
              className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-black"
            />
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
