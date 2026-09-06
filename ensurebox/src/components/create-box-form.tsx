"use client";

import { useActionState } from "react";
import { createBoxAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateBoxForm() {
  const [state, action, pending] = useActionState(createBoxAction, null);

  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="name">Box name</Label>
        <Input
          id="name"
          name="name"
          placeholder="optional, e.g. agent-1"
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={pending} className="sm:w-40">
        {pending ? "Creating…" : "Create box"}
      </Button>
      {state?.error ? (
        <p className="text-sm text-destructive sm:self-center">{state.error}</p>
      ) : null}
    </form>
  );
}
