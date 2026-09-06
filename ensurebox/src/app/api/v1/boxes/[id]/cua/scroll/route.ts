import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { scroll } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      x?: number;
      y?: number;
      dx?: number;
      dy?: number;
    };
    if (
      typeof body.x !== "number" ||
      typeof body.y !== "number" ||
      typeof body.dx !== "number" ||
      typeof body.dy !== "number"
    ) {
      return jsonError(400, "invalid_request", "x, y, dx, and dy are required");
    }
    const result = await scroll(id, {
      x: body.x,
      y: body.y,
      dx: body.dx,
      dy: body.dy,
    });
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
