import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { typeText } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as { text?: string };
    if (!body.text) {
      return jsonError(400, "invalid_request", "text is required");
    }
    const result = await typeText(id, body.text);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
