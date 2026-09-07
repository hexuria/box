import type { RecipeRequest } from "grok-box";
import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { runRecipe } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as RecipeRequest;
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      return jsonError(400, "invalid_request", "steps must be a non-empty array");
    }
    const result = await runRecipe(id, body);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
