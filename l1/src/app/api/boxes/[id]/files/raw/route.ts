import { NextResponse } from "next/server";
import { requireL1Session } from "@/lib/auth";
import {
  cookArtifactMime,
  isCookArtifactPath,
} from "@/lib/cook-artifacts";
import { EnsureboxError, readFile } from "@/lib/ensurebox";
import { workspaceRelative } from "@/lib/workspace-path";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json(
    { error: { code: "unauthorized", message: "Sign in required", status: 401 } },
    { status: 401 },
  );
}

export async function GET(request: Request, { params }: Params) {
  try {
    await requireL1Session();
  } catch {
    return unauthorized();
  }

  const { id } = await params;
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "";
  if (!isCookArtifactPath(rawPath)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message:
            "Only files under /workspace/.l1/cooks can be opened as cook artifacts.",
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  const rel = workspaceRelative(rawPath);
  try {
    const result = await readFile(id, rel, "base64");
    if (result.kind === "dir" || Array.isArray(result.entries)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "That path is a folder, not a cook artifact file.",
            status: 400,
          },
        },
        { status: 400 },
      );
    }
    const content = result.content;
    if (!content || result.encoding !== "base64") {
      return NextResponse.json(
        {
          error: {
            code: "not_found",
            message:
              "The guest did not return this cook artifact as a file. Cook again after rebuilding grok-box:local if the file is missing.",
            status: 404,
          },
        },
        { status: 404 },
      );
    }
    const bytes = Buffer.from(content, "base64");
    const mime = cookArtifactMime(rel);
    const leaf = rel.split("/").filter(Boolean).pop() || "artifact";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": mime,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${leaf.replaceAll('"', "")}"`,
      },
    });
  } catch (err) {
    if (err instanceof EnsureboxError && err.status === 404) {
      return NextResponse.json(
        { error: { code: "not_found", message: err.message, status: 404 } },
        { status: 404 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof EnsureboxError ? err.status : 502;
    return NextResponse.json(
      { error: { code: "http_error", message, status } },
      { status },
    );
  }
}
