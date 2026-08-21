import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P7, stock levels across warehouses. Generated from the prompt, not from any spec.
 *
 * Two guards run before anything else, in order: one that establishes who is calling and
 * one that establishes whether they may touch the warehouse this path names. Handlers
 * run afterwards and hold no credential logic. `p7-inventory-open` is the same prompt
 * with the checks inside each handler, which is how its write path ended up with none.
 *
 * The cost price is a projection decision rather than a route decision. `stockView` takes
 * whether the caller is a manager and leaves the field out when they are not, so the
 * listing and the detail view cannot disagree about it.
 */

interface Account {
  readonly token: string;
  readonly id: string;
  readonly warehouse_id: string;
  readonly manager: boolean;
}

interface StockLine {
  readonly id: string;
  readonly warehouse_id: string;
  readonly sku: string;
  quantity: number;
  readonly cost_price_cents: number;
}

const ACCOUNTS: readonly Account[] = [
  { token: 'stock-eve-token', id: 'eve', warehouse_id: 'WH-EAST', manager: false },
  { token: 'stock-wes-token', id: 'wes', warehouse_id: 'WH-WEST', manager: false },
  { token: 'stock-mira-token', id: 'mira', warehouse_id: 'WH-EAST', manager: true },
];

const STOCK: StockLine[] = [
  { id: 'SKU-E1', warehouse_id: 'WH-EAST', sku: 'BOLT-8', quantity: 240, cost_price_cents: 130 },
  { id: 'SKU-E2', warehouse_id: 'WH-EAST', sku: 'NUT-8', quantity: 980, cost_price_cents: 40 },
  { id: 'SKU-W5', warehouse_id: 'WH-WEST', sku: 'BOLT-8', quantity: 60, cost_price_cents: 130 },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function accountOf(request: IncomingMessage): Account | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  return ACCOUNTS.find((one) => one.token === header.slice('Bearer '.length));
}

function stockOf(path: string): StockLine | undefined {
  const match = /^\/api\/stock\/([^/]+)$/.exec(path);
  return match === null ? undefined : STOCK.find((one) => one.id === match[1]);
}

/**
 * The projection, and the only place the cost price rule is written. A caller who is not
 * a manager never receives the field, in a listing or in a detail view.
 */
function stockView(line: StockLine, manager: boolean): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: line.id,
    warehouse_id: line.warehouse_id,
    sku: line.sku,
    quantity: line.quantity,
  };

  if (manager) view.cost_price_cents = line.cost_price_cents;
  return view;
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'inventory', routes: ['/api/stock', '/api/stock/{id}'] });
    return;
  }

  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  if (!path.startsWith('/api/')) {
    send(response, 404, { error: 'not found' });
    return;
  }

  // Guard one: who is calling. Every path below /api needs an answer, including a write.
  const account = accountOf(request);
  if (account === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  // Guard two: may they touch the warehouse this path names. A stock line in another
  // warehouse is refused rather than hidden, because a warehouse is not a secret and a
  // staff member asking about one is usually asking the wrong colleague.
  const line = stockOf(path);
  if (line !== undefined && line.warehouse_id !== account.warehouse_id) {
    send(response, 403, { error: 'another warehouse' });
    return;
  }

  if (path === '/api/stock' && method === 'GET') {
    const mine = STOCK.filter((one) => one.warehouse_id === account.warehouse_id);
    send(response, 200, { stock: mine.map((one) => stockView(one, account.manager)) });
    return;
  }

  if (line !== undefined) {
    if (method === 'GET') {
      send(response, 200, stockView(line, account.manager));
      return;
    }

    if (method === 'PATCH') {
      // An adjustment with no body names no new quantity, so there is nothing to apply
      // and the record comes back as it stands.
      send(response, 200, stockView(line, account.manager));
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
