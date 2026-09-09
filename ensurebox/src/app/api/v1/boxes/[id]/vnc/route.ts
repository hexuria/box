import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { getPublicBox } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    if (box.status !== "ready") {
      return jsonError(
        409,
        "not_ready",
        box.status === "creating"
          ? "workspace is still starting"
          : "workspace is not ready",
      );
    }
    return Response.json({
      ok: true,
      protocol: "rfb",
      ready: true,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
