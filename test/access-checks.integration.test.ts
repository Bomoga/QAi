import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../fixtures/ledger/src/app.ts';
import { OUTSIDER_TOKEN, OWNER_TOKEN, seedLedger } from '../fixtures/ledger/src/data.ts';
import type { DefectSwitches } from '../fixtures/ledger/src/defects.ts';
import {
  SpecSchema,
  createActorSessions,
  createHttpClient,
  fixedDeps,
  parseCondition,
  planAccessChecks,
  rulesFor,
  runAccessChecks,
  type AccessCheckPlan,
  type CheckResult,
  type ConditionAst,
  type PlanningContext,
  type ResolvedActor,
  type Spec,
} from '../packages/core/src/index.ts';

/**
 * The integration test the M3 Definition of Done asks for: the real access checks
 * against the real fixture app over a real socket.
 *
 * It lives at the workspace root rather than in either package because it is the only
 * thing here that legitimately depends on both. 02-ARCHITECTURE.md says `core` depends
 * on nothing in this repository and `fixtures/ledger` likewise, and an integration test
 * inside either one would quietly make that false.
 *
 * The gate that matters most is the negative controls. A finding against N1 or N2 is a
 * false positive, and invariant I2 says two of those lose a user permanently, so the
 * absence of findings is asserted at least as carefully as their presence.
 */

const SPEC: Spec = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger invoicing',
  entities: [
    {
      name: 'Invoice',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'org_id', type: 'string' },
        { name: 'total_cents', type: 'number' },
        { name: 'notes', type: 'string', sensitive: true },
      ],
    },
  ],
  requirements: [
    {
      id: 'REQ-001',
      statement: 'A user can only read invoices belonging to their own organization',
      accessRules: [
        {
          id: 'AR-001-01',
          actor: 'outsider',
          action: 'read',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
      ],
    },
    {
      id: 'REQ-002',
      statement: 'Listing invoices returns only invoices belonging to the caller organization',
      accessRules: [
        {
          id: 'AR-002-01',
          actor: 'outsider',
          action: 'list',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
      ],
    },
    {
      id: 'REQ-003',
      statement: 'Modifying an invoice requires an authenticated caller',
      accessRules: [
        {
          id: 'AR-003-01',
          actor: 'anonymous',
          action: 'update',
          resource: 'Invoice',
          effect: 'deny',
        },
      ],
    },
    {
      id: 'REQ-008',
      statement: 'A user can read invoices belonging to their own organization',
      accessRules: [
        {
          id: 'AR-008-01',
          actor: 'owner',
          action: 'read',
          resource: 'Invoice',
          condition: 'Invoice.org_id == actor.org_id',
          effect: 'allow',
        },
      ],
    },
    {
      id: 'REQ-009',
      statement: 'A user cannot modify invoices belonging to another organization',
      accessRules: [
        {
          id: 'AR-009-01',
          actor: 'outsider',
          action: 'update',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
      ],
    },
  ],
});

const CONDITION_SOURCES: Record<string, string> = {
  'AR-001-01': 'Invoice.org_id != actor.org_id',
  'AR-002-01': 'Invoice.org_id != actor.org_id',
  'AR-008-01': 'Invoice.org_id == actor.org_id',
  'AR-009-01': 'Invoice.org_id != actor.org_id',
};

function conditions(): Map<string, ConditionAst> {
  const map = new Map<string, ConditionAst>();
  for (const [id, source] of Object.entries(CONDITION_SOURCES)) {
    const parsed = parseCondition(source);
    if (parsed.kind !== 'error') map.set(id, parsed);
  }
  return map;
}

const PLANNING: PlanningContext = {
  actorIds: new Set(['owner', 'outsider', 'anonymous']),
  resources: [
    {
      name: 'Invoice',
      routes: {
        read: '/api/invoices/{id}',
        list: '/api/invoices',
        update: '/api/invoices/{id}',
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
  d5UndeclaredDebugEndpoint: true,
};

const ALL_DEFECTS_OFF: DefectSwitches = {
  d1CrossOrgInvoiceRead: false,
  d2UnscopedInvoiceList: false,
  d3UnauthenticatedMutation: false,
  d5UndeclaredDebugEndpoint: false,
};

const running: Server[] = [];

async function startLedger(defects: DefectSwitches): Promise<string> {
  const server = createLedgerServer({ data: seedLedger(), defects });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function runAgainst(defects: DefectSwitches): Promise<CheckResult[]> {
  const baseUrl = await startLedger(defects);

  const { plans } = planAccessChecks(SPEC, conditions(), null, PLANNING);
  const sessions = createActorSessions(ACTORS, {
    client: createHttpClient({ baseUrl }),
    rules: rulesFor(SPEC),
    deps: fixedDeps(),
  });

  return runAccessChecks(plans as AccessCheckPlan[], {
    sessions,
    mutation: { allowed: true },
  });
}

function byRule(results: readonly CheckResult[]): Map<string, CheckResult> {
  return new Map(results.map((result) => [result.ruleId ?? '', result]));
}

describe('the defective ledger', () => {
  it('reports D1 as one high severity finding with evidence', async () => {
    const d1 = byRule(await runAgainst(ALL_DEFECTS_ON)).get('AR-001-01');

    expect(d1?.verdict).toBe('fail');
    expect(d1?.severity).toBe('high');
    expect(d1?.evidence).toHaveLength(1);
    expect(d1?.detail).toContain('GET /api/invoices/INV-1001');
    expect(d1?.detail).toContain('actor outsider');
    expect(d1?.detail).toContain('org_id');
  });

  it('reports D2 as one high severity finding naming the foreign row', async () => {
    const d2 = byRule(await runAgainst(ALL_DEFECTS_ON)).get('AR-002-01');

    expect(d2?.verdict).toBe('fail');
    expect(d2?.severity).toBe('high');
    expect(d2?.detail).toContain('INV-1001');
    expect(d2?.evidence).toHaveLength(1);
  });

  it('reports D3 as one high severity finding', async () => {
    const d3 = byRule(await runAgainst(ALL_DEFECTS_ON)).get('AR-003-01');

    expect(d3?.verdict).toBe('fail');
    expect(d3?.severity).toBe('high');
    expect(d3?.detail).toContain('PATCH /api/invoices/');
    expect(d3?.detail).toContain('actor anonymous');
  });

  it('produces exactly three findings, one per defect', async () => {
    const results = await runAgainst(ALL_DEFECTS_ON);
    const failures = results.filter((result) => result.verdict === 'fail');

    expect(failures.map((result) => result.ruleId).sort()).toEqual([
      'AR-001-01',
      'AR-002-01',
      'AR-003-01',
    ]);
  });
});

describe('the negative controls, which matter most', () => {
  it('N1: the owner reading their own invoice produces no finding', async () => {
    const n1 = byRule(await runAgainst(ALL_DEFECTS_ON)).get('AR-008-01');
    expect(n1?.verdict).toBe('pass');
  });

  it('N2: a cross-organization write is refused and produces no finding', async () => {
    const n2 = byRule(await runAgainst(ALL_DEFECTS_ON)).get('AR-009-01');
    expect(n2?.verdict).toBe('pass');
  });

  it('N1 and N2 still pass with every defect switched off', async () => {
    const results = byRule(await runAgainst(ALL_DEFECTS_OFF));

    expect(results.get('AR-008-01')?.verdict).toBe('pass');
    expect(results.get('AR-009-01')?.verdict).toBe('pass');
  });
});

describe('the fixed ledger', () => {
  it('produces no findings at all', async () => {
    const results = await runAgainst(ALL_DEFECTS_OFF);
    const failures = results.filter((result) => result.verdict === 'fail');

    expect(failures).toEqual([]);
  });

  it('reports every rule as a pass rather than as unverified', async () => {
    const results = await runAgainst(ALL_DEFECTS_OFF);
    expect(results.every((result) => result.verdict === 'pass')).toBe(true);
  });

  it('runs the same set of checks as the defective run, so the two compare', async () => {
    const defective = await runAgainst(ALL_DEFECTS_ON);
    const fixed = await runAgainst(ALL_DEFECTS_OFF);

    expect(fixed.map((result) => result.checkId).sort()).toEqual(
      defective.map((result) => result.checkId).sort(),
    );
  });
});

describe('evidence and output discipline', () => {
  it('gives every check evidence, whatever its verdict', async () => {
    const results = await runAgainst(ALL_DEFECTS_ON);
    expect(results.every((result) => result.evidence.length > 0)).toBe(true);
  });

  it('never writes a credential or a sensitive field into a finding', async () => {
    const results = await runAgainst(ALL_DEFECTS_ON);
    const text = results.map((result) => `${result.title} ${result.detail ?? ''}`).join('\n');

    expect(text).not.toContain('billing contact');
    expect(text).not.toContain(OWNER_TOKEN);
    expect(text).not.toContain(OUTSIDER_TOKEN);
  });

  it('marks every access check deterministic', async () => {
    const results = await runAgainst(ALL_DEFECTS_ON);
    expect(results.every((result) => result.deterministic)).toBe(true);
  });
});
