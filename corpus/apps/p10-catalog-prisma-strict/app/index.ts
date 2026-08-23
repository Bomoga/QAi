import express, { type Request, type Response } from 'express';
import process from 'node:process';

/**
 * P10, a product catalog. Generated from the prompt, not from any spec.
 *
 * Express, a session cookie, and a `prisma/schema.prisma` beside the code. The rows are
 * held in memory: the schema is the data model as written, and swapping the store for a
 * real database is the part nobody got to. That is an ordinary state for a generated
 * application to be in and it is what NOTES.md says.
 *
 * This is the correct one of the pair. An unpublished product is a draft and only the
 * owning team sees it.
 */

interface Product {
  readonly id: string;
  readonly name: string;
  readonly price_cents: number;
  readonly published: boolean;
  readonly owner_team: string;
}

const SESSIONS: Readonly<Record<string, string>> = {
  'catalog-session-nadia': 'team-alpha',
  'catalog-session-omar': 'team-beta',
};

const PRODUCTS: readonly Product[] = [
  { id: 'PRD-1', name: 'Desk lamp', price_cents: 4_500, published: true, owner_team: 'team-alpha' },
  {
    id: 'PRD-2',
    name: 'Unreleased chair',
    price_cents: 22_000,
    published: false,
    owner_team: 'team-alpha',
  },
  { id: 'PRD-3', name: 'Wall clock', price_cents: 3_200, published: true, owner_team: 'team-beta' },
];

function teamOf(request: Request): string | undefined {
  const cookie = request.headers.cookie;
  if (cookie === undefined) return undefined;

  for (const part of cookie.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === 'session' && value !== undefined) return SESSIONS[value];
  }

  return undefined;
}

/** A draft is visible only to the team that owns it. A published product is public. */
function visibleTo(product: Product, team: string | undefined): boolean {
  return product.published || product.owner_team === team;
}

const app = express();

app.get('/', (_request: Request, response: Response) => {
  response.json({ name: 'catalog', routes: ['/api/products', '/api/products/{id}'] });
});

app.get('/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok' });
});

app.get('/api/products', (request: Request, response: Response) => {
  const team = teamOf(request);
  response.json({ products: PRODUCTS.filter((product) => visibleTo(product, team)) });
});

app.get('/api/products/:id', (request: Request, response: Response) => {
  const team = teamOf(request);
  const product = PRODUCTS.find((candidate) => candidate.id === request.params.id);

  // A draft somebody else owns answers exactly as one that does not exist, so a refusal
  // does not confirm the draft is there.
  if (product === undefined || !visibleTo(product, team)) {
    response.status(404).json({ error: 'no such product' });
    return;
  }

  response.json(product);
});

app.use((_request: Request, response: Response) => {
  response.status(404).json({ error: 'no such route' });
});

const port = Number(process.env['PORT'] ?? 47810);
app.listen(port, () => {
  console.log(`catalog listening on ${port}`);
});
