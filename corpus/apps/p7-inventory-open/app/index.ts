import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P7, inventory per warehouse. Generated from the prompt, not from any spec.
 *
 * The read paths were built first and the write path was added later without going back
 * to the credential check, which is the ordinary way this happens. Cost prices are
 * returned to whoever asks, because the projection was written once for the manager view
 * and reused everywhere.
 */

interface StockLine {
  readonly id: string;
  readonly warehouse_id: string;
  quantity: number;
  readonly cost_price_cents: number;
}

interface Staff {
  readonly token: string;
  readonly id: string;
  readonly warehouseId: string;
  readonly manager: boolean;
}

const STAFF: readonly Staff[] = [
  { token: 'stock-north-token', id: 'nina', warehouseId: 'WH-NORTH', manager: false },
  { token: 'stock-south-token', id: 'sam', warehouseId: 'WH-SOUTH', manager: false },
  { token: 'stock-boss-token', id: 'mo', warehouseId: 'WH-NORTH', manager: true },
];

const STOCK: StockLine[] = [
  { id: 'SKU-1', warehouse_id: 'WH-NORTH', quantity: 40, cost_price_cents: 1250 },
  { id: 'SKU-2', warehouse_id: 'WH-NORTH', quantity: 12, cost_price_cents: 8400 },
  { id: 'SKU-3', warehouse_id: 'WH-SOUTH', quantity: 7, cost_price_cents: 3300 },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function staffOf(request: IncomingMessage): Staff | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  return STAFF.find((one) => one.token === header.slice('Bearer '.length));
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, { name: 'inventory', routes: ['/api/stock', '/api/stock/{id}'] });
    return;
  }

  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  if (path === '/api/stock' && request.method === 'GET') {
    const staff = staffOf(request);
    if (staff === undefined) {
      send(response, 401, { error: 'sign in first' });
      return;
    }
    // Every warehouse, not the caller's. The filter was never added.
    send(response, 200, { stock: STOCK });
    return;
  }

  const match = /^\/api\/stock\/([^/]+)$/.exec(path);
  if (match !== null) {
    const line = STOCK.find((one) => one.id === match[1]);
    if (line === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET') {
      const staff = staffOf(request);
      if (staff === undefined) {
        send(response, 401, { error: 'sign in first' });
        return;
      }
      send(response, 200, line);
      return;
    }

    if (request.method === 'PATCH') {
      // No credential check at all on the write path.
      line.quantity += 1;
      send(response, 200, line);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
