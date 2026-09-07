"use client";

import { useTransition } from "react";
import { startBoxAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function WakeButton({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const asleep =
    status === "stopped" || status === "hibernated" || status === "error";

  if (!asleep) {
    return null;
  }

  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => start(() => startBoxAction(id))}
    >
      {pending ? "Starting…" : "Start workspace"}
    </Button>
  );
}
