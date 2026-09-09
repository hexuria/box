"use client";

import { Button } from "@/components/ui/button";
import { formatLogLine } from "@/lib/action-log";
import type { RecipeStepJson } from "@/lib/recipe-plan";

export function ActionLog({
  steps,
  onClear,
  variant = "page",
  empty = "No actions yet. Click the desktop to take over.",
}: {
  steps: RecipeStepJson[];
  onClear: () => void;
  variant?: "page" | "chrome";
  empty?: string;
}) {
  const lines = steps
    .map((step, index) => {
      const line = formatLogLine(step);
      return line ? { index, line } : null;
    })
    .filter((row): row is { index: number; line: string } => row != null);
  const chrome = variant === "chrome";

  return (
    <div
      className={
        chrome
          ? "flex h-full min-h-0 flex-col bg-black text-white"
          : "flex min-h-0 flex-col rounded-xl border border-border bg-card"
      }
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 ${
          chrome ? "border-b border-white/10" : "border-b border-border"
        }`}
      >
        <p
          className={`text-xs font-medium tracking-wide uppercase ${
            chrome ? "text-white/60" : "text-muted-foreground"
          }`}
        >
          Action log
        </p>
        <Button
          type="button"
          size="xs"
          variant={chrome ? "chrome" : "outline"}
          onClick={onClear}
          disabled={steps.length === 0}
        >
          Clear logs
        </Button>
      </div>
      {lines.length === 0 ? (
        <p
          className={`px-3 py-3 text-xs ${
            chrome ? "text-white/50" : "text-muted-foreground"
          }`}
        >
          {empty}
        </p>
      ) : (
        <ol
          className={`max-h-none flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5 ${
            chrome ? "text-white/90" : "text-foreground"
          }`}
        >
          {lines.map((row) => (
            <li key={`${row.index}-${row.line}`}>{row.line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
