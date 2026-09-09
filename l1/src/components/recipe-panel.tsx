"use client";

import { useEffect, useRef, useState } from "react";
import { recipeAction } from "@/lib/actions";
import { CookArtifactGallery } from "@/components/cook-artifact-gallery";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CookArtifact } from "@/lib/cook-artifacts";
import { FRAMEBUFFER } from "@/lib/config";
import {
  insertStep,
  LINT_FAIL_RECIPE,
  RECIPE_OPS,
  SMOKE_RECIPE,
  typedUrlsPreview,
} from "@/lib/recipe-plan";
import type { RecipeReceipt } from "@/lib/types";

const RECORD_COOK_KEY = "l1.cook.record";

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
    </div>
  );
}

export function RecipePanel({
  id,
  disabled,
  planText,
  onPlanTextChange,
}: {
  id: string;
  disabled: boolean;
  planText: string;
  onPlanTextChange: (text: string) => void;
}) {
  const planRef = useRef(planText);
  planRef.current = planText;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lintFailed, setLintFailed] = useState(false);
  const [receipt, setReceipt] = useState<RecipeReceipt | null>(null);
  const [artifacts, setArtifacts] = useState<CookArtifact[]>([]);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordCook, setRecordCook] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RECORD_COOK_KEY);
      if (stored === "0") {
        setRecordCook(false);
      }
    } catch {
      // default on
    }
  }, []);

  async function onRun() {
    setBusy(true);
    setError(null);
    setLintFailed(false);
    setReceipt(null);
    setArtifacts([]);
    setRecordingError(null);
    const json = planRef.current;
    try {
      const next = await recipeAction(id, json, { record: recordCook });
      if (next.error) {
        setError(next.error);
        setLintFailed(!!next.lintFailed);
        return;
      }
      if (next.result) {
        setReceipt(next.result);
      }
      setArtifacts(next.artifacts ?? []);
      setRecordingError(next.recordingError ?? null);
    } finally {
      setBusy(false);
    }
  }

  const preview = typedUrlsPreview(planText);

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        Cook runs Computer Use on this same guest ({FRAMEBUFFER.width}×
        {FRAMEBUFFER.height}, origin top-left) — it does not start a new box.
        Leaving Desktop keeps that session mounted so post-cook windows stay.
        Screenshots and an optional cook recording are stored as files you can
        open here. Put <span className="font-mono">reset_desktop</span> first
        when you need a clean dock, not a Docker restart. Lint happens first;
        HTTP 400 means nothing moved.
      </p>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Actions
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPE_OPS.map((item) => (
            <button
              key={item.op}
              type="button"
              disabled={busy}
              onClick={() => onPlanTextChange(insertStep(planText, item.example))}
              className="rounded-lg border border-zinc-200 bg-white p-3 text-left hover:border-zinc-400"
            >
              <p className="font-mono text-sm">{item.title}</p>
              <p className="mt-1 text-xs text-zinc-600">{item.blurb}</p>
              <p className="mt-1 font-mono text-[10px] text-zinc-400">
                {JSON.stringify(item.example)}
              </p>
            </button>
          ))}
        </div>
      </div>
      {disabled ? (
        <p className="text-sm text-zinc-500">
          Box is not ready. You can still edit a plan; Run stays disabled.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="recipe-json">Plan JSON (this is what Run sends)</Label>
        <Textarea
          id="recipe-json"
          value={planText}
          onChange={(event) => onPlanTextChange(event.target.value)}
          disabled={busy}
          rows={18}
          className="min-h-64 font-mono text-xs"
          spellCheck={false}
        />
        <p className="text-xs text-zinc-500">{preview}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={disabled || busy} onClick={() => void onRun()}>
          {busy ? "Cooking…" : "Cook"}
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-zinc-900"
            checked={recordCook}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.checked;
              setRecordCook(next);
              try {
                window.localStorage.setItem(RECORD_COOK_KEY, next ? "1" : "0");
              } catch {
                // ignore
              }
            }}
          />
          Record cook
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onPlanTextChange(SMOKE_RECIPE)}
        >
          Open Google
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onPlanTextChange(LINT_FAIL_RECIPE)}
        >
          Lint-fail (x={FRAMEBUFFER.width})
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {lintFailed && /out_of_range|outside/i.test(error)
              ? ` Coordinates are 0…${FRAMEBUFFER.width - 1} × 0…${FRAMEBUFFER.height - 1}.`
              : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {receipt ? <RecipeReceiptView receipt={receipt} /> : null}
      {receipt || artifacts.length > 0 || recordingError ? (
        <CookArtifactGallery
          boxId={id}
          artifacts={artifacts}
          recordingError={recordCook ? recordingError : null}
        />
      ) : null}
    </div>
  );
}
