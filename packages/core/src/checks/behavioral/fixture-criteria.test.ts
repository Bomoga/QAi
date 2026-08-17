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

/** Criteria that stay in prose, each with a comment in the spec saying why. */
const RECORDED_GAPS = {
  /** A per-row comparison against a caller attribute. No assertion form states it. */
  unexpressibleThen: 'AC-002-01',
  /** Needs an actor holding a token belonging to no user, which config does not have. */
  unexpressibleWhen: 'AC-011-01',
  /** The browser path, which does not go through either vocabulary. */
  fuzzy: 'AC-005-02',
} as const;

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
  it('warns about the one criterion whose then clause is outside the table', () => {
    const diagnostics = validateAcceptanceCriteria(loadFixture().spec, SPEC_PATH);

    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['warning']);
    expect(diagnostics[0]?.message).toContain(RECORDED_GAPS.unexpressibleThen);
  });

  it('offers the author both ways out rather than only naming the problem', () => {
    const [diagnostic] = validateAcceptanceCriteria(loadFixture().spec, SPEC_PATH);

    expect(diagnostic?.message).toContain('mode: fuzzy');
    expect(diagnostic?.message).toContain('status is');
  });
});

describe('the fixture spec read through the request vocabulary', () => {
  it('plans every deterministic criterion but the two recorded gaps', () => {
    const { plans, unplannable } = planned();

    const deterministic = loadFixture()
      .spec.requirements.flatMap((requirement) => requirement.acceptanceCriteria)
      .filter((criterion) => criterion.mode === 'deterministic');

    expect(plans).toHaveLength(deterministic.length - 2);
    expect(unplannable.map((entry) => entry.criterionId).sort()).toEqual([
      RECORDED_GAPS.unexpressibleThen,
      RECORDED_GAPS.fuzzy,
      RECORDED_GAPS.unexpressibleWhen,
    ]);
  });

  it('says which half of each gap could not be read', () => {
    const byId = new Map(planned().unplannable.map((entry) => [entry.criterionId, entry]));

    expect(byId.get(RECORDED_GAPS.unexpressibleThen)?.detail).toContain('then clause');
    expect(byId.get(RECORDED_GAPS.unexpressibleWhen)?.detail).toContain('when clause');
    expect(byId.get(RECORDED_GAPS.fuzzy)?.reason).toBe('capability-unavailable');
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
