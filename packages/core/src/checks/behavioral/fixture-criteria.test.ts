import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isLoadFailure, loadSpec } from '../../spec/load.ts';
import { isConfigFailure, loadConfig } from '../../target/config.ts';
import type { PlanningContext } from '../access/plan.ts';
import { validateAcceptanceCriteria } from './assertions.ts';
import { planBehavioralChecks } from './plan.ts';

/**
 * The fixture spec, read through both vocabularies.
 *
 * It was authored at M1.8 in prose, before either table existed, and rewritten at
 * M5.8-pre2. This test is what keeps the rewrite honest in both directions: a criterion
 * that silently stops planning is coverage the report would claim and not have, and a
 * gap that silently starts planning is a clause somebody widened a parser to guess at.
 *
 * The context comes from the repository's own `qai.config.yaml` rather than a literal
 * written here, because the claim being made is that this spec plans against this
 * target. A hand-built context would assert that the spec plans against a context this
 * test invented, which is not the same statement and cannot fail when config drifts.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..', '..');
const SPEC_PATH = 'fixtures/ledger/spec/ledger.spec.yaml';

/**
 * No criterion in this file is a recorded gap any more.
 *
 * There were three when it was rewritten at M5.8-pre2, and three more criteria asserted
 * less than the sentences they replaced. Closing them took five assertion forms, one
 * config field, and one configured actor. This constant is kept as an empty list rather
 * than deleted, because the assertion that nothing is unplannable is the one that will
 * fail the day somebody writes a clause the vocabulary cannot read.
 */
const RECORDED_GAPS: readonly string[] = [];

/** The one fuzzy criterion. It plans, and the browser decides whether it can run. */
const FUZZY = 'AC-005-02';

function fixture(): ReturnType<typeof loadSpec> {
  return loadSpec([SPEC_PATH], { cwd: ROOT });
}

function loadFixture(): { spec: Parameters<typeof validateAcceptanceCriteria>[0] } {
  const result = fixture();
  if (isLoadFailure(result))
    throw new Error(`fixture spec failed to load: ${result.error.message}`);
  return { spec: result.spec };
}

function planningContext(): PlanningContext {
  const result = loadConfig('qai.config.yaml', ROOT);
  if (isConfigFailure(result)) throw new Error(`config failed to load: ${result.error.message}`);

  return {
    actorIds: new Set(result.config.actors.map((actor) => actor.id)),
    resources: result.config.resources,
  };
}

function planned(): ReturnType<typeof planBehavioralChecks> {
  return planBehavioralChecks(loadFixture().spec, null, planningContext());
}

describe('the fixture spec read through the assertion vocabulary', () => {
  it('has no then clause left that the table cannot state', () => {
    // Every warning here is a criterion nobody can check. The file carried one until
    // M5.10, and closing it is the whole reason the two forms were added.
    expect(validateAcceptanceCriteria(loadFixture().spec, SPEC_PATH)).toEqual([]);
  });

  it('reads the per-row form the scoping criterion needs', () => {
    const plan = planned().plans.find((candidate) => candidate.criterionId === 'AC-002-01');

    expect(plan?.assertions).toEqual([
      {
        kind: 'every-row',
        entity: 'Invoice',
        field: 'org_id',
        expected: { kind: 'actor', attribute: 'org_id' },
      },
    ]);
    expect(plan?.actorId).toBe('outsider');
  });
});

describe('the fixture spec read through the request vocabulary', () => {
  it('plans every criterion in the file', () => {
    const { plans, unplannable } = planned();

    const criteria = loadFixture().spec.requirements.flatMap(
      (requirement) => requirement.acceptanceCriteria,
    );

    expect(unplannable.map((entry) => entry.criterionId)).toEqual(RECORDED_GAPS);
    expect(plans).toHaveLength(criteria.length);
  });

  it('plans the forged credential criterion as the actor configured for it', () => {
    const plan = planned().plans.find((candidate) => candidate.criterionId === 'AC-011-01');

    // A caller presenting a credential that belongs to nobody is a different request
    // from one presenting nothing, so it needs an actor of its own.
    expect(plan?.actorId).toBe('impostor');
    expect(plan?.request).toEqual({ method: 'GET', path: '/api/invoices/INV-1001' });
  });

  it('plans the fuzzy criterion as a page to open with nothing to assert', () => {
    const plan = planned().plans.find((candidate) => candidate.criterionId === FUZZY);

    // Its `then` never goes through the assertion table, which is the whole meaning of
    // `mode: fuzzy`. What planning owes it is a page and an actor.
    expect(plan?.mode).toBe('fuzzy');
    expect(plan?.assertions).toEqual([]);
    expect(plan?.request).toEqual({ method: 'GET', path: '/' });
  });

  it('turns the D4 criterion into a list request asserting the sensitive field is absent', () => {
    const plan = planned().plans.find((candidate) => candidate.criterionId === 'AC-004-01');

    expect(plan?.request).toEqual({ method: 'GET', path: '/api/invoices' });
    expect(plan?.actorId).toBe('owner');
    expect(plan?.assertions).toEqual([{ kind: 'field-absent', entity: 'Invoice', field: 'notes' }]);
    expect(plan?.mutates).toBe(false);
  });

  it('resolves an instance id from the criterion, not only from config', () => {
    const plan = planned().plans.find((candidate) => candidate.criterionId === 'AC-012-01');

    // REQ-012 is about an invoice that was never created, so the criterion has to be
    // able to name one config does not seed.
    expect(plan?.request.path).toBe('/api/invoices/INV-9999');
  });

  it('marks the criteria that write, so the disposability gate can order them', () => {
    const mutating = planned()
      .plans.filter((plan) => plan.mutates)
      .map((plan) => plan.criterionId)
      .sort();

    expect(mutating).toEqual(['AC-003-01', 'AC-006-01', 'AC-009-01']);
  });

  it('plans a follow-up read only where a count is asserted', () => {
    const withReads = planned()
      .plans.filter((plan) => plan.stateReads !== undefined)
      .map((plan) => plan.criterionId);

    // AC-006-01 counts AuditLog, which the target serves no route for, so the plan
    // carries no read and the runner reports the count unevaluable rather than zero.
    expect(withReads).toEqual([]);
  });
});
