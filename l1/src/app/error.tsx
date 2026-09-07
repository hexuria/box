"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/shell";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-600">{error.message}</p>
      <p className="mt-2 text-sm text-zinc-500">
        If the workspace cannot be reached, try again in a moment.
      </p>
      <Button className="mt-4" type="button" onClick={() => reset()}>
        Try again
      </Button>
    </Shell>
  );
}
