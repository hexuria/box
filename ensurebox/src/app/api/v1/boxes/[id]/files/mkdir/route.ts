import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { mkdirGuest } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as { path?: string; parents?: boolean };
    if (!body.path) {
      return jsonError(400, "invalid_request", "path is required");
    }
    const result = await mkdirGuest(id, body.path, body.parents ?? true);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
