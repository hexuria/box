import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { getPublicBox } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const box = await getPublicBox(id);
    if (!box) {
      return jsonError(404, "not_found", `box not found: ${id}`);
    }
    return Response.json({
      status: box.status === "ready" ? "ready" : "not_ready",
      box_id: box.id,
      box_status: box.status,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
