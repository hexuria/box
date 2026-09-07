"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ hint }: { hint?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);

  return (
    <form action={action} className="max-w-md space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="token">Operator token</Label>
        <Input
          id="token"
          name="token"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {hint ? <p className="text-sm text-zinc-600">{hint}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
