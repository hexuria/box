import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { drag } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      button?: number;
    };
    if (
      typeof body.x1 !== "number" ||
      typeof body.y1 !== "number" ||
      typeof body.x2 !== "number" ||
      typeof body.y2 !== "number"
    ) {
      return jsonError(400, "invalid_request", "x1, y1, x2, and y2 are required");
    }
    const result = await drag(id, {
      x1: body.x1,
      y1: body.y1,
      x2: body.x2,
      y2: body.y2,
      button: body.button,
    });
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
