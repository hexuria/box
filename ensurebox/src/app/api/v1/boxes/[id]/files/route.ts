import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { readFile, writeGuestFile } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  const url = new URL(request.url);
  try {
    const result = await readFile(id, url.searchParams.get("path") || "");
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PUT(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as { path?: string; content?: string };
    if (!body.path || body.content == null) {
      return jsonError(400, "invalid_request", "path and content are required");
    }
    const result = await writeGuestFile(id, body.path, body.content);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
