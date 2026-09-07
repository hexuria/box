import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { doubleClick } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as { x?: number; y?: number; button?: number };
    if (typeof body.x !== "number" || typeof body.y !== "number") {
      return jsonError(400, "invalid_request", "x and y are required");
    }
    const result = await doubleClick(id, body.x, body.y, body.button);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
