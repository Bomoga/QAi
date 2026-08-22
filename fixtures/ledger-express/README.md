# ledger-express

The same invoicing application as `fixtures/ledger`, served on Express so a source
adapter has a route table to read. It is the demo target for the sequence in
`docs/plan/01-PRODUCT.md`.

**Do not fix the defects.** The same rule as the other fixture, and the same catalog in
`docs/plan/06-TESTING.md`.

## Why this exists

Step 3 of the definition of success asks for an access finding carrying a file
reference. A finding gets one from the handler an adapter read, M4's adapters target
Next.js, Express, and Prisma, and every application in this repository was a hand-written
`node:http` server: the fixture by a decision at S0, and all twenty corpus applications
by the same habit. So the source path was the one thing nothing exercised, and the file
reference could not be demonstrated end to end however the tool behaved.

This is that route table. Each route is declared on a line, and that line is what a
finding cites.

## One application, two transports

`src/routes.ts` decides nothing. Every handler comes from
`fixtures/ledger/src/handlers.ts`, which the `node:http` server calls too, so the defects
have one implementation rather than two opinions.

`test/parity.test.ts` sends the same requests to both servers and compares the answers,
across both defect states. Two copies of one fixture is the thing that drifts, and the
matrix is what stops it happening quietly.

Express compares paths loosely by default; `strict routing` and `case sensitive routing`
are set so `/api/invoices/` and `/API/invoices` answer the way the other server answers.
Both are in the parity matrix.

## Running

```
pnpm --filter ledger-express dev
```

Listens on `PORT`, default 3001, so it can run beside `fixtures/ledger` on 3000.

## Seeded data and defect switches

Identical to `fixtures/ledger`, from the same `seedLedger()` and the same
`LEDGER_DEFECT_D*` variables. See that fixture's README for the actors, the tokens, and
the catalog.

**D5 is the one difference, and it is deliberate.** This server never serves
`/api/debug/state`, and `LEDGER_DEFECT_D5` is forced off rather than ignored quietly. D5
is a debug endpoint nobody asked for, and switching it off means the route is not there.
A source adapter reads text, so a route registered behind a runtime condition is still
declared in the file, and this server would then report an endpoint it refuses to serve.
Fixing that defect means deleting the line, which an environment variable cannot model.
The other fixture keeps D5 for the checks and goldens built on it.

## Dependency

`express` is the only third-party runtime dependency in this repository, and it is here
rather than in `packages/`. `04-CONVENTIONS.md` governs what the product may depend on;
a fixture depends on whatever framework it is a fixture of, or it cannot be one. It is
pure JavaScript with no install script, so a clean install still needs no toolchain.
