import { NextResponse } from "next/server";
import { GrokBoxError } from "@/lib/box-client";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message, status } },
    { status },
  );
}

export function handleRouteError(err: unknown) {
  if (err instanceof GrokBoxError) {
    return NextResponse.json(err.body ?? { error: { message: err.message } }, {
      status: err.status,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  const status = /not found/i.test(message) ? 404 : 400;
  return jsonError(status, status === 404 ? "not_found" : "invalid_request", message);
}
