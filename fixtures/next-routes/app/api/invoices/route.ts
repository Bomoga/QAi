/**
 * The collection route. Two methods on one file, which is how the App Router says it.
 *
 * Every handler here answers with something recognizable and nothing else. This fixture
 * exists so the adapter's reading of a route tree can be checked against Next's own
 * routing, so behaviour beyond "this URL is served, by this method" would be noise.
 */

export async function GET(): Promise<Response> {
  return Response.json({ invoices: [{ id: 'INV-1' }] });
}

export async function POST(): Promise<Response> {
  return Response.json({ id: 'INV-2' }, { status: 201 });
}
