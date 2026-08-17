import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../fixtures/ledger/src/app.ts';
import { OUTSIDER_TOKEN, OWNER_TOKEN, seedLedger } from '../fixtures/ledger/src/data.ts';
import type { DefectSwitches } from '../fixtures/ledger/src/defects.ts';
import {
  createActorSessions,
  createHttpClient,
  fixedDeps,
  isLoadFailure,
  loadSpec,
  planBehavioralChecks,
  rulesFor,
  runBehavioralChecks,
  type BehavioralPlan,
  type CheckResult,
  type PlanningContext,
  type ResolvedActor,
  type Spec,
  type UnverifiedCheck,
} from '../packages/core/src/index.ts';

/**
 * The integration test the M5 Definition of Done asks for: acceptance criteria from the
 * real fixture spec, run against the real fixture app over a real socket, with D4 the
 * defect under the microscope.
 *
 * It reads `fixtures/ledger/spec/ledger.spec.yaml` rather than a spec written here. A
 * hand-built spec would test that the runner agrees with a spec this file invented; the
 * claim worth making is that the file a user would write turns into checks that catch
 * what is wrong with the application it describes.
 *
 * Both directions are pinned. Defects on and defects off are asserted as complete sets
 * of verdicts, not as one lookup each, so a runner that always failed or always passed
 * would break one of them. That is the trap S3 and S4 both nearly fell into.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixtureSpec(): Spec {
  const result = loadSpec(['fixtures/ledger/spec/ledger.spec.yaml'], { cwd: ROOT });
  if (isLoadFailure(result))
    throw new Error(`fixture spec failed to load: ${result.error.message}`);
  return result.spec;
}

/** The routes and seeded records `qai.config.yaml` carries, since no probe runs here. */
const PLANNING: PlanningContext = {
  actorIds: new Set(['owner', 'outsider', 'anonymous']),
  resources: [
    {
      name: 'Invoice',
      routes: {
        read: '/api/invoices/{id}',
        list: '/api/invoices',
        update: '/api/invoices/{id}',
        delete: '/api/invoices/{id}',
      },
      instances: [
        { id: 'INV-1001', attributes: { org_id: 'org-1' } },
        { id: 'INV-2001', attributes: { org_id: 'org-2' } },
      ],
    },
  ],
};

const ACTORS: ResolvedActor[] = [
  {
    id: 'owner',
    credential: { kind: 'bearer', token: OWNER_TOKEN },
    attributes: { org_id: 'org-1' },
  },
  {
    id: 'outsider',
    credential: { kind: 'bearer', token: OUTSIDER_TOKEN },
    attributes: { org_id: 'org-2' },
  },
  { id: 'anonymous', credential: { kind: 'none' }, attributes: {} },
];

const ALL_DEFECTS_ON: DefectSwitches = {
  d1CrossOrgInvoiceRead: true,
  d2UnscopedInvoiceList: true,
  d3UnauthenticatedMutation: true,
  d4NotesInInvoiceList: true,
  d5UndeclaredDebugEndpoint: true,
};

const ALL_DEFECTS_OFF: DefectSwitches = {
  d1CrossOrgInvoiceRead: false,
  d2UnscopedInvoiceList: false,
  d3UnauthenticatedMutation: false,
  d4NotesInInvoiceList: false,
  d5UndeclaredDebugEndpoint: false,
};

const running: Server[] = [];

async function startLedger(defects: DefectSwitches): Promise<string> {
  const server = createLedgerServer({ data: seedLedger(), defects });

  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', () => {
      done();
    });
  });
  running.push(server);

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port bound');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  const servers = running.splice(0, running.length);
  for (const server of servers) {
    await new Promise<void>((done, failed) => {
      server.close((error) => (error ? failed(error) : done()));
    });
  }
});

interface Run {
  readonly results: readonly CheckResult[];
  readonly unverified: readonly UnverifiedCheck[];
}

async function runAgainst(defects: DefectSwitches): Promise<Run> {
  const spec = fixtureSpec();
  const baseUrl = await startLedger(defects);

  const { plans } = planBehavioralChecks(spec, null, PLANNING);
  const sessions = createActorSessions(ACTORS, {
    client: createHttpClient({ baseUrl }),
    rules: rulesFor(spec),
    deps: fixedDeps(),
  });

  // Mutation is permitted the way the M2 gate would permit it: the fixture is disposable
  // and restarted per test, so a criterion that writes runs rather than being refused.
  //
  // The state actor is named here because `qai.config.yaml` has no field for one. It has
  // to be an identity that can read the record: the criterion under test acts as
  // `anonymous`, who cannot, which is exactly why persisted state is never read as the
  // acting actor.
  return runBehavioralChecks(plans as BehavioralPlan[], {
    sessions,
    stateActorId: 'owner',
    mutation: { allowed: true },
  });
}

function verdicts(run: Run): Record<string, string> {
  return Object.fromEntries(
    [...run.results]
      .sort((left, right) => (left.ruleId ?? '').localeCompare(right.ruleId ?? ''))
      .map((result) => [result.ruleId ?? '', result.verdict]),
  );
}

function byCriterion(run: Run): Map<string, CheckResult> {
  return new Map(run.results.map((result) => [result.ruleId ?? '', result]));
}

describe('D4, a sensitive field returned where it should be omitted', () => {
  it('fails at medium severity, naming the field and carrying evidence', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-004-01');

    expect(result?.verdict).toBe('fail');
    expect(result?.severity).toBe('medium');
    expect(result?.evidence).toHaveLength(1);
    expect(result?.detail).toContain('notes');
    expect(result?.detail).toContain('GET /api/invoices');
  });

  it('passes once the field is omitted, so the check is not simply always failing', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_OFF)).get('AC-004-01');

    expect(result?.verdict).toBe('pass');
  });

  it('says what was observed rather than naming a class of problem', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-004-01');

    for (const term of ['leak', 'exposure', 'vulnerability', 'idor']) {
      expect(result?.detail?.toLowerCase() ?? '').not.toContain(term);
    }
  });
});

describe('the defective ledger, every criterion at once', () => {
  it('produces exactly the verdicts the seeded defects call for', async () => {
    expect(verdicts(await runAgainst(ALL_DEFECTS_ON))).toEqual({
      // D1 twice: the cross organization read itself, and the refusal that would confirm
      // the invoice exists if it answered anything but 404.
      'AC-001-01': 'fail',
      'AC-013-01': 'fail',
      // D3, an unauthenticated write accepted.
      'AC-003-01': 'fail',
      // D2, the list handing an outsider rows from another organization. Checkable
      // since M5.10 added the per-row form and the actor reference.
      'AC-002-01': 'fail',
      // D4, the sensitive field in the list.
      'AC-004-01': 'fail',
      // D5, the debug endpoint answering rather than 404.
      'AC-005-01': 'fail',
      // D6, AuditLog was never built, so there is nowhere to count and nothing is claimed.
      'AC-006-01': 'inconclusive',
      // The fuzzy criterion, with no browser installed.
      'AC-005-02': 'inconclusive',
      // Behavior the application gets right. A finding on any of these is a false positive.
      'AC-008-01': 'pass',
      'AC-009-01': 'pass',
      'AC-010-01': 'pass',
      'AC-012-01': 'pass',
      'AC-014-01': 'pass',
      'AC-014-02': 'pass',
      'AC-015-01': 'pass',
    });
  });

  it('carries evidence on every failure, so no claim stands on its own', async () => {
    const failures = (await runAgainst(ALL_DEFECTS_ON)).results.filter(
      (result) => result.verdict === 'fail',
    );

    expect(failures).toHaveLength(6);
    for (const failure of failures) {
      expect(failure.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('D2, the scoping claim the per-row form made checkable', () => {
  it('names the foreign row rather than only saying the list was wrong', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-002-01');

    expect(result?.verdict).toBe('fail');
    expect(result?.detail).toContain('INV-1001');
    expect(result?.detail).toContain('actor.org_id');
  });

  it('passes when the list is scoped, on rows that were actually present', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_OFF)).get('AC-002-01');

    // The outsider owns INV-2001, so the scoped list is not empty and the pass rests on
    // a row that was read rather than on there being nothing to read.
    expect(result?.verdict).toBe('pass');
  });
});

describe('D3, the write that is accepted without credentials', () => {
  it('reports the record moving, not only the status that let it', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-003-01');

    expect(result?.verdict).toBe('fail');
    expect(result?.detail).toContain('status 200');
    expect(result?.detail).toContain('changed across the action: total_cents');
  });

  it('carries the two extra reads as evidence, so the claim can be checked', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-003-01');

    // The action, the read before it, and the read after it.
    expect(result?.evidence).toHaveLength(3);
  });

  it('passes on the repaired ledger, where the write is refused and nothing moves', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_OFF)).get('AC-003-01');

    expect(result?.verdict).toBe('pass');
  });

  it('N2: a refused cross-organization write leaves the record alone either way', async () => {
    for (const defects of [ALL_DEFECTS_ON, ALL_DEFECTS_OFF]) {
      const result = byCriterion(await runAgainst(defects)).get('AC-009-01');

      // A finding here is a false positive, and the unchanged half is the half that
      // matters: a refusal that still wrote is the worst outcome this control covers.
      expect(result?.verdict).toBe('pass');
    }
  });
});

describe('REQ-013, the refusal that must not confirm the invoice exists', () => {
  it('reports both statuses, so the reader sees what gave the record away', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-013-01');

    expect(result?.verdict).toBe('fail');
    expect(result?.detail).toContain('status 200');
    expect(result?.detail).toContain('/api/invoices/INV-9999');
    expect(result?.detail).toContain('returned 404');
  });

  it('carries the reference request as evidence alongside the action', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_ON)).get('AC-013-01');

    expect(result?.evidence).toHaveLength(2);
  });

  it('passes when the two are indistinguishable, without pinning either to a literal', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_OFF)).get('AC-013-01');

    // The claim is that a cross-organization read looks exactly like a read of an invoice
    // that was never created. It holds whatever status the application chooses for both.
    expect(result?.verdict).toBe('pass');
  });
});

describe('the repaired ledger', () => {
  it('reports no failure at all, and the same checks ran', async () => {
    const run = await runAgainst(ALL_DEFECTS_OFF);
    const previous = Object.keys(verdicts(await runAgainst(ALL_DEFECTS_ON)));

    expect(run.results.filter((result) => result.verdict === 'fail')).toEqual([]);
    expect(Object.keys(verdicts(run))).toEqual(previous);
  });

  it('still cannot verify the audit log, since that entity was never built', async () => {
    const result = byCriterion(await runAgainst(ALL_DEFECTS_OFF)).get('AC-006-01');

    expect(result?.verdict).toBe('inconclusive');
    expect(result?.detail).toContain('AuditLog');
  });
});

describe('the fuzzy criterion with Playwright absent', () => {
  it('is unverified for a capability reason, not for a model being unsure', async () => {
    const run = await runAgainst(ALL_DEFECTS_ON);

    expect(run.unverified).toEqual([
      {
        requirementId: 'REQ-005',
        criterionId: 'AC-005-02',
        reason: 'capability-unavailable',
        detail: expect.stringContaining('browser') as string,
      },
    ]);
  });

  it('leaves the run complete, with nothing that could raise the exit code', async () => {
    const run = await runAgainst(ALL_DEFECTS_OFF);
    const fuzzy = byCriterion(run).get('AC-005-02');

    expect(fuzzy?.verdict).toBe('inconclusive');
    expect(fuzzy?.severity).toBe('info');
    expect(run.results.some((result) => result.verdict === 'fail')).toBe(false);
  });

  it('is the only check counted as model assisted', async () => {
    const run = await runAgainst(ALL_DEFECTS_ON);
    const modelAssisted = run.results.filter((result) => !result.deterministic);

    expect(modelAssisted.map((result) => result.ruleId)).toEqual(['AC-005-02']);
  });
});
