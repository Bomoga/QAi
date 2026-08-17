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

| Actor      | Organization      | Bearer token              | Invoice  |
| ---------- | ----------------- | ------------------------- | -------- |
| `owner`    | `org-1` Northwind | `ledger-owner-token`      | INV-1001 |
| `outsider` | `org-2` Contoso   | `ledger-outsider-token`   | INV-2001 |
| `impostor` | none              | `ledger-not-a-real-token` | none     |

These credentials are fixture data. They authenticate against this app and nothing else.

`impostor` is the one that authenticates against nothing at all: its token matches no
seeded user, so every route that reads a credential refuses it. That is a different case
from the `anonymous` actor, who presents no credential, and a target can get one right
while getting the other wrong. `qai.config.yaml` supplies it through
`LEDGER_UNKNOWN_TOKEN`, which has to be set alongside the other two.

## Defect switches

| Variable           | Values      | Default | Defect                                                |
| ------------------ | ----------- | ------- | ----------------------------------------------------- |
| `LEDGER_DEFECT_D1` | `on`, `off` | `on`    | D1, invoice readable across organizations by id       |
| `LEDGER_DEFECT_D2` | `on`, `off` | `on`    | D2, invoice list returns rows from every organization |
| `LEDGER_DEFECT_D3` | `on`, `off` | `on`    | D3, invoice update accepts an unauthenticated caller  |
| `LEDGER_DEFECT_D4` | `on`, `off` | `on`    | D4, invoice list returns the sensitive notes field    |
| `LEDGER_DEFECT_D5` | `on`, `off` | `on`    | D5, an undeclared debug endpoint serving state        |

Defects default to on. An unrecognized value is a startup error rather than a fallback,
because a mistyped switch that silently leaves the defect enabled makes a passing run
mean nothing.

D4 is scoped to the list. A single invoice read returns notes whichever way the switch
is set, because REQ-004 asks for the field to be omitted from list responses and a
switch covering both would put two defects behind one toggle.

An accepted write actually writes, whichever way D3 is set: a `PATCH` that gets past the
credential check increments the invoice total. The request carries no body because the
tool issues none, so the change is a fixed one; what matters is that something moves, or
a criterion saying the invoice is unchanged could never be false and D3 would only be
half implemented. A refused write changes nothing, and the seed is never touched, so a
restart is still the reset.

Defects D6 and D7 in the catalog are not implemented. D6 is intentional and permanent:
it is the entity the spec declares and the application never built, which is what the
structural diff reports. D7 lands with the stage that builds the check consuming it.

Negative control N2, a cross-organization write being refused, holds whether or not D3
is on: D3 is about the missing credential check, not about ownership. A finding against
N2 is a false positive and blocks merge.
