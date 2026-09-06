import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError } from "@/lib/http";
import { startBox } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const box = await startBox(id);
    return Response.json(box);
  } catch (err) {
    return handleRouteError(err);
  }
}
