"use client";

import { useTransition } from "react";
import {
  destroyBoxAction,
  startBoxAction,
  stopBoxAction,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function BoxLifecycleButtons({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const canStop = status === "ready" || status === "creating";
  const canStart = status === "stopped" || status === "hibernated" || status === "error";

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={!canStop || pending}
        onClick={() => start(() => stopBoxAction(id, false))}
      >
        Stop
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={!canStop || pending}
        onClick={() => start(() => stopBoxAction(id, true))}
      >
        Hibernate
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={!canStart || pending}
        onClick={() => start(() => startBoxAction(id))}
      >
        Start
      </Button>
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Destroy this box and its volumes?")) {
            start(() => destroyBoxAction(id));
          }
        }}
      >
        Destroy
      </Button>
    </div>
  );
}
