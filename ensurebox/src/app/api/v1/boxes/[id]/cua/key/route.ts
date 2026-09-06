import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { sendKey } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as { key?: string };
    if (!body.key) {
      return jsonError(400, "invalid_request", "key is required");
    }
    const result = await sendKey(id, body.key);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
