import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError } from "@/lib/http";
import { boxInfo } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const info = await boxInfo(id);
    return Response.json(info);
  } catch (err) {
    return handleRouteError(err);
  }
}
