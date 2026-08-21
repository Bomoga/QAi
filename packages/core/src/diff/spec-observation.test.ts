import { describe, expect, it } from 'vitest';

import type { Observation, ObservedEndpoint, Spec } from '../contracts/index.ts';
import { StructuralFindingsSchema } from '../contracts/index.ts';
import {
  diffSpecObservation,
  matchEntities,
  namesMatch,
  normalizeName,
  severityForUndeclared,
  singular,
} from './spec-observation.ts';

function endpoint(overrides: Partial<ObservedEndpoint> = {}): ObservedEndpoint {
  const path = overrides.path ?? '/api/invoices';
  const method = overrides.method ?? 'GET';

  return {
    id: `${method} ${path}`,
    method,
    path,
    origin: 'blackbox',
    confidence: 'low',
    authRequired: 'unknown',
    actorVisibility: {},
    evidence: [],
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observationVersion: '0.1',
    observedAt: '2026-01-01T00:00:00.000Z',
    mode: 'hybrid',
    target: {},
    entities: [],
    endpoints: [],
    notes: [],
    ...overrides,
  };
}

/** An entity read out of a schema, whose field list is an inventory rather than a sample. */
function schemaEntity(name: string, fields: readonly string[]): Observation['entities'][number] {
  return {
    name,
    origin: 'schema',
    confidence: 'high',
    fields: fields.map((field) => ({ name: field, origin: 'schema' as const })),
    evidence: [],
  };
}

const SPEC: Spec = {
  specVersion: '0.1',
  name: 'Ledger',
  actors: [{ id: 'owner', description: 'owner' }],
  entities: [
    {
      name: 'Invoice',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'org_id', type: 'string' },
        { name: 'total_cents', type: 'number' },
      ],
    },
    { name: 'AuditLog', fields: [{ name: 'action', type: 'string' }] },
  ],
  requirements: [
    {
      id: 'REQ-001',
      statement: 'A user reads only their own invoices',
      entities: ['Invoice'],
      fields: ['Invoice.org_id'],
      tags: [],
      accessRules: [
        { id: 'AR-001-01', actor: 'owner', action: 'read', resource: 'Invoice', effect: 'allow' },
      ],
      acceptanceCriteria: [],
    },
    {
      id: 'REQ-002',
      statement: 'Every change is recorded in the audit log',
      entities: ['AuditLog'],
      fields: [],
      tags: [],
      accessRules: [],
      acceptanceCriteria: [],
    },
  ],
};

describe('name handling', () => {
  it.each([
    ['invoices', 'invoice'],
    ['entries', 'entry'],
    ['boxes', 'box'],
    ['status', 'status'],
    ['invoice', 'invoice'],
  ])('reads %s as %s', (word, expected) => {
    expect(singular(word)).toBe(expected);
  });

  it('strips case and separators', () => {
    expect(normalizeName('Audit_Log')).toBe('auditlog');
    expect(normalizeName('audit-logs')).toBe('auditlogs');
  });

  it.each([
    ['Invoice', 'invoices'],
    ['AuditLog', 'audit-logs'],
    ['Invoice', 'Invoice'],
  ])('matches %s against %s', (left, right) => {
    expect(namesMatch(left, right)).toBe(true);
  });

  it('does not match two different models', () => {
    expect(namesMatch('Invoice', 'Organization')).toBe(false);
  });
});

describe('entity matching', () => {
  it('is most certain when an adapter read the model', () => {
    const matches = matchEntities(
      SPEC,
      observation({
        entities: [
          { name: 'Invoice', origin: 'schema', confidence: 'high', fields: [], evidence: [] },
        ],
      }),
    );

    expect(matches[0]).toMatchObject({ via: 'schema', confidence: 'high', observed: 'Invoice' });
  });

  it('is less certain when only a route is named after the model', () => {
    const matches = matchEntities(SPEC, observation({ endpoints: [endpoint()] }));
    expect(matches[0]).toMatchObject({ via: 'endpoint', confidence: 'medium' });
  });

  it('is least certain when only response fields line up', () => {
    const matches = matchEntities(
      SPEC,
      observation({
        endpoints: [
          endpoint({
            path: '/api/records',
            responseShape: { fields: ['org_id', 'total_cents'] },
          }),
        ],
      }),
    );

    expect(matches[0]).toMatchObject({ via: 'fields', confidence: 'low' });
  });

  it('does not read a shared id field as evidence of a model', () => {
    const matches = matchEntities(
      SPEC,
      observation({
        endpoints: [endpoint({ path: '/api/records', responseShape: { fields: ['id'] } })],
      }),
    );

    expect(matches[0]).toMatchObject({ entity: 'Invoice', via: 'none' });
  });

  it('reports an entity nothing accounts for', () => {
    const matches = matchEntities(SPEC, observation({ endpoints: [endpoint()] }));
    expect(matches[1]).toMatchObject({ entity: 'AuditLog', via: 'none' });
  });
});

describe('specified and not observed', () => {
  it('reports an entity the application does not implement, naming the requirements', () => {
    const findings = diffSpecObservation(SPEC, observation({ endpoints: [endpoint()] }));

    expect(findings.specifiedNotObserved).toEqual([
      { kind: 'entity', name: 'AuditLog', requirementIds: ['REQ-002'] },
    ]);
  });

  it('says nothing when the probe saw nothing at all', () => {
    const findings = diffSpecObservation(SPEC, observation());

    expect(findings.specifiedNotObserved).toEqual([]);
    expect(findings.observedNotSpecified).toEqual([]);
  });
});

describe('observed and not specified', () => {
  it('reports an endpoint no requirement accounts for', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint(), endpoint({ path: '/api/debug/reset' })] }),
    );

    expect(findings.observedNotSpecified).toEqual([
      { kind: 'endpoint', id: 'GET /api/debug/reset', severity: 'medium' },
    ]);
  });

  it('leaves an endpoint alone when a requirement names its entity', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint({ path: '/api/invoices/:id' })] }),
    );

    expect(findings.observedNotSpecified).toEqual([]);
  });

  // Name matching relates `invoices` to `Invoice` and cannot relate `stock` to
  // `StockLine`. The configured routes are the authoritative mapping from an entity and
  // an action to a URL, and reading them is what stops the tool calling a specified
  // endpoint undeclared at medium, which is confident enough to be believed. Cause 3.
  it('accounts for an endpoint a configured route maps to a specified entity', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint({ path: '/api/ledger-entries' })] }),
      [{ name: 'Invoice', routes: { list: '/api/ledger-entries' } }],
    );

    expect(findings.observedNotSpecified).toEqual([]);
  });

  it('matches a configured template against the parameter the crawl derived', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint({ path: '/api/ledger-entries/:id' })] }),
      [{ name: 'Invoice', routes: { read: '/api/ledger-entries/{id}' } }],
    );

    expect(findings.observedNotSpecified).toEqual([]);
  });

  // The endpoint nobody specified is the sharpest thing this diff reports, and it is a
  // configured route for nothing. D5 in `fixtures/ledger` is exactly this shape.
  it('keeps reporting an endpoint no configured route covers', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint({ path: '/api/debug/state' })] }),
      [{ name: 'Invoice', routes: { list: '/api/invoices', read: '/api/invoices/{id}' } }],
    );

    expect(findings.observedNotSpecified).toEqual([
      { kind: 'endpoint', id: 'GET /api/debug/state', severity: 'medium' },
    ]);
  });

  it('ignores a configured route for an entity no requirement names', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint({ path: '/api/ghosts' })] }),
      [{ name: 'Ghost', routes: { list: '/api/ghosts' } }],
    );

    expect(findings.observedNotSpecified).toEqual([
      { kind: 'endpoint', id: 'GET /api/ghosts', severity: 'medium' },
    ]);
  });

  it.each(['/', '/health', '/favicon.ico', '/app.css', '/_next/static/chunk.js'])(
    'treats %s as noise rather than a finding',
    (path) => {
      expect(severityForUndeclared(endpoint({ path }), SPEC)).toBe('info');
    },
  );

  it('raises an unauthenticated endpoint returning entity fields', () => {
    const severity = severityForUndeclared(
      endpoint({
        path: '/api/debug/dump',
        authRequired: false,
        responseShape: { fields: ['org_id', 'total_cents'] },
      }),
      SPEC,
    );

    expect(severity).toBe('high');
  });

  it('does not raise one whose authentication was never established', () => {
    const severity = severityForUndeclared(
      endpoint({ path: '/api/debug/dump', responseShape: { fields: ['org_id'] } }),
      SPEC,
    );

    expect(severity).toBe('medium');
  });

  it('still raises a health route that leaks entity fields without credentials', () => {
    const severity = severityForUndeclared(
      endpoint({ path: '/health', authRequired: false, responseShape: { fields: ['org_id'] } }),
      SPEC,
    );

    expect(severity).toBe('high');
  });
});

describe('field mismatches', () => {
  it('reports a field the response carries and the spec does not declare', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({
        endpoints: [
          endpoint({
            responseShape: { fields: ['id', 'org_id', 'total_cents', 'internal_notes'] },
          }),
        ],
      }),
    );

    expect(findings.fieldMismatches).toEqual([
      { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: ['internal_notes'] },
    ]);
  });

  it('reports a declared field a schema reading does not carry', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ entities: [schemaEntity('Invoice', ['id', 'org_id'])] }),
    );

    expect(findings.fieldMismatches).toEqual([
      { entity: 'Invoice', specifiedNotObserved: ['total_cents'], observedNotSpecified: [] },
    ]);
  });

  // Absence is evidence only when the field list was an inventory. An entity recognized
  // from a response carries whatever that one response happened to contain, which is a
  // sample, and reporting what the crawl did not request as a fact about the application
  // is the crawl's coverage dressed up as a finding. Corpus cause 2.
  it('says nothing about a declared field an inferred reading did not happen to carry', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({ endpoints: [endpoint({ responseShape: { fields: ['id', 'org_id'] } })] }),
    );

    expect(findings.fieldMismatches).toEqual([]);
  });

  it('still reports an undeclared field an inferred reading did carry', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({
        endpoints: [endpoint({ responseShape: { fields: ['id', 'internal_notes'] } })],
      }),
    );

    expect(findings.fieldMismatches).toEqual([
      { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: ['internal_notes'] },
    ]);
  });

  // A field the spec forbids in output and the application withholds cannot also be a
  // finding. Redaction reads the same list. Corpus cause 1.
  it('does not report a field the spec forbids and no response carried', () => {
    const spec: Spec = {
      ...SPEC,
      entities: [
        {
          name: 'Invoice',
          fields: [
            { name: 'id', type: 'string' },
            { name: 'org_id', type: 'string' },
            { name: 'notes', type: 'string', sensitive: true },
          ],
        },
      ],
    };

    const findings = diffSpecObservation(
      spec,
      observation({ entities: [schemaEntity('Invoice', ['id', 'org_id'])] }),
    );

    expect(findings.fieldMismatches).toEqual([]);
  });

  it('excludes only the forbidden field, and keeps everything else the entry says', () => {
    const spec: Spec = {
      ...SPEC,
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
    };

    const findings = diffSpecObservation(
      spec,
      observation({ entities: [schemaEntity('Invoice', ['id', 'internal_notes'])] }),
    );

    // The two ordinary fields the schema does not carry are still reported, the
    // undeclared one is still reported, and the forbidden one is not. Dropping the
    // sensitive filter puts `notes` back in the first list.
    expect(findings.fieldMismatches).toEqual([
      {
        entity: 'Invoice',
        specifiedNotObserved: ['org_id', 'total_cents'],
        observedNotSpecified: ['internal_notes'],
      },
    ]);
  });

  it('says nothing about an entity whose fields were never observed', () => {
    const findings = diffSpecObservation(SPEC, observation({ endpoints: [endpoint()] }));
    expect(findings.fieldMismatches).toEqual([]);
  });

  it('says nothing when the two agree', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({
        endpoints: [endpoint({ responseShape: { fields: ['id', 'org_id', 'total_cents'] } })],
      }),
    );

    expect(findings.fieldMismatches).toEqual([]);
  });
});

describe('the block as a whole', () => {
  it('satisfies the contract', () => {
    const findings = diffSpecObservation(
      SPEC,
      observation({
        endpoints: [
          endpoint({ responseShape: { fields: ['id', 'org_id', 'notes'] } }),
          endpoint({ path: '/api/debug/reset' }),
        ],
      }),
    );

    expect(StructuralFindingsSchema.safeParse(findings).success).toBe(true);
  });

  it('gives the same answer twice over the same pair', () => {
    const obs = observation({ endpoints: [endpoint(), endpoint({ path: '/api/debug/reset' })] });
    expect(diffSpecObservation(SPEC, obs)).toEqual(diffSpecObservation(SPEC, obs));
  });

  it('does not mutate the spec it was given', () => {
    const before = JSON.stringify(SPEC);
    diffSpecObservation(SPEC, observation({ endpoints: [endpoint()] }));
    expect(JSON.stringify(SPEC)).toBe(before);
  });
});
