/**
 * A route group. `(internal)` organizes files and is not part of the URL, so this serves
 * `/health` rather than `/internal/health`. It is the derivation most worth checking
 * against Next, because nothing but Next can confirm it.
 */

export async function GET(): Promise<Response> {
  return Response.json({ status: 'ok' });
}
