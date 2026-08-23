/** A catch-all, which matches one or more segments and never zero. */

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return Response.json({ path });
}
