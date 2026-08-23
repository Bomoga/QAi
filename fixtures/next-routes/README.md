# next-routes

A real Next.js App Router tree, and the one thing in this repository that can say whether
the Next adapter agrees with Next.

## Why it exists

The adapter derives a URL from a directory structure. `(internal)` disappears, `[id]`
becomes a parameter, `[...path]` matches the rest of the path. Its unit tests assert those
derivations against synthetic trees, which means they assert that **the adapter agrees with
what its author believed about Next**. The belief and the implementation came from the same
place, so a wrong belief passes.

Nothing but Next can settle it. `test/adapter-conformance.test.ts` runs the adapter over
this tree, boots Next, and requests every URL the adapter says is there. A derivation that
is wrong produces a 404, which is the one answer that means Next routed nothing.

This is the same posture M7.4 records about SARIF: the only authority on what GitHub will
ingest is GitHub.

## What the tree covers

| File                             | Serves                                     | Convention                                  |
| -------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `app/api/invoices/route.ts`      | `GET`, `POST /api/invoices`                | two methods in one file                     |
| `app/api/invoices/[id]/route.ts` | `GET`, `PATCH`, `DELETE /api/invoices/:id` | a dynamic segment                           |
| `app/(internal)/health/route.ts` | `GET /health`                              | a route group, which is not part of the URL |
| `app/files/[...path]/route.ts`   | `GET /files/:path*`                        | a catch-all, one segment or more            |

The route group is the one worth the whole fixture. If the adapter were wrong about it, it
would claim `/internal/health`, and every assertion that reads the directory names would
still agree with it, because they all read the same names.

## It is not a corpus application, and that is deliberate

The claim worth making here is that a derivation matches the framework. That is a property
to assert once, not a rate to measure across applications. A Next application in
`corpus/apps/` would make every corpus run pay a framework boot to re-measure a fixed
property, and the runner starts an application with
`node --experimental-strip-types app/index.ts`, which is not how a Next application starts.

There is no spec here and no seeded defect. This fixture answers one question and the other
two fixtures answer the rest.

## Running it

```
pnpm --filter next-routes dev
```

The conformance test boots its own instance on a free port and does not need this.

## Files Next owns

`.next/` and `next-env.d.ts` are written on boot, so the conformance test recreates them
every time it runs. Both are gitignored and both are named in `eslint.config.js` and
`.prettierignore`, because neither tool reads `.gitignore` and a passing test that leaves a
failing lint behind it is worse than no test. `tsconfig.json` is checked in for the same
reason: Next writes one if it is missing, and a fixture that edits itself on first run
behaves differently in CI than it does locally.
