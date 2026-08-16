# ledger

A deliberately defective invoicing application. It is the integration target for QAi
and the demo subject.

**Do not fix the defects.** They are the oracle the integration tests assert against.
Each one is listed in the defect catalog in `docs/plan/06-TESTING.md` and is toggled by
an environment variable, so a single build can be run in both a failing and a passing
configuration. A defect that is silently repaired turns a meaningful test green for the
wrong reason.

## Running

```
pnpm --filter ledger dev
```

Listens on `PORT`, default 3000.

## Seeded data

Two organizations, one user each, one invoice each. Two actors are the minimum for
cross-organization access to be observable at all.

| Actor      | Organization      | Bearer token            | Invoice  |
| ---------- | ----------------- | ----------------------- | -------- |
| `owner`    | `org-1` Northwind | `ledger-owner-token`    | INV-1001 |
| `outsider` | `org-2` Contoso   | `ledger-outsider-token` | INV-2001 |

These credentials are fixture data. They authenticate against this app and nothing else.

## Defect switches

| Variable           | Values      | Default | Defect                                                |
| ------------------ | ----------- | ------- | ----------------------------------------------------- |
| `LEDGER_DEFECT_D1` | `on`, `off` | `on`    | D1, invoice readable across organizations by id       |
| `LEDGER_DEFECT_D2` | `on`, `off` | `on`    | D2, invoice list returns rows from every organization |
| `LEDGER_DEFECT_D3` | `on`, `off` | `on`    | D3, invoice update accepts an unauthenticated caller  |

Defects default to on. An unrecognized value is a startup error rather than a fallback,
because a mistyped switch that silently leaves the defect enabled makes a passing run
mean nothing.

Defects D4 through D7 in the catalog are not implemented yet. They land with the stages
that build the checks which consume them.

Negative control N2, a cross-organization write being refused, holds whether or not D3
is on: D3 is about the missing credential check, not about ownership. A finding against
N2 is a false positive and blocks merge.
