import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError } from "@/lib/http";
import { createBox, listPublicBoxes } from "@/lib/lifecycle";

export async function GET(request: Request) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    const boxes = await listPublicBoxes();
    return Response.json({ boxes });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const box = await createBox(body.name);
    return Response.json(box, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
