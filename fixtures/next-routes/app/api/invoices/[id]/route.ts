/** A dynamic segment, and the three methods that act on one record. */

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return Response.json({ id });
}

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return Response.json({ id, updated: true });
}

export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 204 });
}
