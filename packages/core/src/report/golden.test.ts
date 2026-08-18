import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RunResultSchema, type RunResult } from '../contracts/index.ts';
import { computeExitCode } from './exit-code.ts';
import { renderJson } from './json.ts';
import { renderJunit } from './junit.ts';
import { SarifLogSchema } from './sarif-schema.ts';
import { renderSarif } from './sarif.ts';
import { renderText } from './text.ts';

/**
 * The emitters, rendered from canonical run results captured against
 * `fixtures/ledger` in both configurations.
 *
 * 06-TESTING.md asks for exactly this and gives the reason: emitter tests render from
 * these files rather than from a live run, which keeps report work decoupled from check
 * work. Nothing here starts a target or issues a request, so a change to a check cannot
 * turn these red and a change to an emitter cannot hide behind a check that stopped
 * running.
 *
 * Regenerate with `pnpm --filter @qai/core capture:goldens <defective|fixed>`, against a
 * freshly started ledger, and read the diff. The run mutates the target, so a capture
 * against a target that has already been run is drifted state and will not reproduce.
 * Never regenerate in bulk to make this suite pass: a golden that changed is either an
 * intended product change or a regression, and telling which is a person's job.
 */

function golden(name: 'defective' | 'fixed'): RunResult {
  const path = resolve(import.meta.dirname, 'goldens', `${name}.run.json`);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = RunResultSchema.safeParse(parsed);

  expect(result.error?.issues ?? [], `${name} golden does not match the contract`).toStrictEqual(
    [],
  );
  return result.data as RunResult;
}

const CONFIGURATIONS = ['defective', 'fixed'] as const;

describe('the golden run results', () => {
  it.each(CONFIGURATIONS)('%s parses as a RunResult', (name) => {
    expect(golden(name).runId).toBe(`RUN-golden-${name}`);
  });

  it('describes the same spec and the same checks in both configurations', () => {
    // The two runs differ in what the target does, not in what was asked of it. If the
    // check count moved, one capture was taken against a different spec or a different
    // configuration and the pair no longer compares.
    const defective = golden('defective');
    const fixed = golden('fixed');

    expect(fixed.spec.hash).toBe(defective.spec.hash);
    expect(fixed.summary.checks.total).toBe(defective.summary.checks.total);
    expect(fixed.summary.requirements.total).toBe(defective.summary.requirements.total);
  });

  it('holds findings in the defective configuration and none in the fixed one', () => {
    // Neither direction can pass vacuously. An emitter that reported everything as
    // failing breaks the second, and one that reported nothing breaks the first.
    expect(golden('defective').summary.checks.fail).toBeGreaterThan(0);
    expect(golden('fixed').summary.checks.fail).toBe(0);
  });

  it('carries the entity the spec declares and the application never built, both ways', () => {
    // D6 is intentional and permanent, so it is a structural finding in both
    // configurations. A defect switch cannot turn it off, which is what makes it the
    // right thing to pin here.
    for (const name of CONFIGURATIONS) {
      const declared = golden(name).structural.specifiedNotObserved.map((entry) => entry.name);
      expect(declared).toContain('AuditLog');
    }
  });

  it('keeps unverified requirements in both configurations, since fixing a defect is not coverage', () => {
    for (const name of CONFIGURATIONS) {
      const result = golden(name);
      expect(result.summary.requirements.unverified).toBeGreaterThan(0);
      expect(result.unverifiedReasons.length).toBe(result.summary.requirements.unverified);
    }
  });
});

describe.each(CONFIGURATIONS)('rendering the %s golden', (name) => {
  it('renders JSON identically twice, and back into something the contract accepts', () => {
    const result = golden(name);
    const rendered = renderJson(result);

    expect(rendered).toBe(renderJson(result));
    expect(RunResultSchema.safeParse(JSON.parse(rendered)).success).toBe(true);
  });

  it('round trips through JSON without changing a byte', () => {
    // The golden file is itself `renderJson` output, so re-rendering what it parses to
    // has to reproduce the file. This is what makes the committed file the format.
    const path = resolve(import.meta.dirname, 'goldens', `${name}.run.json`);

    expect(renderJson(golden(name))).toBe(readFileSync(path, 'utf8'));
  });

  it('renders text identically twice, with every section present', () => {
    const rendered = renderText(golden(name), {});

    expect(rendered).toBe(renderText(golden(name), {}));
    for (const heading of [
      'Run',
      'What was built',
      'Disagreements',
      'Findings',
      'Unverified',
      'Summary',
    ]) {
      expect(rendered).toContain(heading);
    }
  });

  it('states coverage as coverage and the model assisted count in the text summary', () => {
    const rendered = renderText(golden(name), {});
    const summary = rendered.slice(rendered.indexOf('Summary'));

    expect(summary).toContain('Coverage');
    expect(summary).toContain('Model assisted checks:');
    expect(rendered.toLowerCase()).not.toContain('pass rate');
  });

  it('renders SARIF identically twice, conforming to 2.1.0', () => {
    const rendered = renderSarif(golden(name));

    expect(rendered).toBe(renderSarif(golden(name)));
    expect(SarifLogSchema.safeParse(JSON.parse(rendered)).error?.issues ?? []).toStrictEqual([]);
  });

  it('renders JUnit identically twice, with a suite for every requirement', () => {
    const result = golden(name);
    const rendered = renderJunit(result);

    expect(rendered).toBe(renderJunit(result));
    for (const requirement of result.requirements) {
      expect(rendered).toContain(`<testsuite name="${requirement.requirementId}"`);
    }
  });

  it('never renders an inconclusive check as a JUnit failure', () => {
    // Invariant I4 against a real run rather than a hand-built one. Both goldens carry
    // inconclusive checks, so neither direction of this can pass vacuously.
    const result = golden(name);
    const rendered = renderJunit(result);

    expect(result.summary.checks.inconclusive).toBeGreaterThan(0);
    expect((rendered.match(/<failure/g) ?? []).length).toBe(result.summary.checks.fail);
    expect((rendered.match(/<skipped/g) ?? []).length).toBeGreaterThanOrEqual(
      result.summary.checks.inconclusive,
    );
  });

  it('writes no unredacted credential into any format, per rule R8', () => {
    const result = golden(name);
    const everything = [
      renderJson(result),
      renderText(result, {}),
      renderSarif(result),
      renderJunit(result),
    ].join('\n');

    // The tokens the capture used. An emitter that reached an evidence body would put
    // one of these in its output, and no emitter reads one.
    for (const secret of ['ledger-owner-token', 'ledger-outsider-token', 'ledger-unknown-token']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('contains no em dash in any format', () => {
    const result = golden(name);

    for (const rendered of [
      renderJson(result),
      renderText(result, {}),
      renderSarif(result),
      renderJunit(result),
    ]) {
      expect(rendered).not.toContain('—');
    }
  });
});

describe('the exit code each golden recommends', () => {
  it('is 1 for the defective run and 0 for the fixed one at the default threshold', () => {
    // The MVP success sequence in 01-PRODUCT.md, in the two states it names: non-zero
    // before the fix and zero after.
    expect(computeExitCode(golden('defective'), {})).toBe(1);
    expect(computeExitCode(golden('fixed'), {})).toBe(0);
  });

  it('stays 0 for the fixed run even at the lowest threshold', () => {
    // There are no findings at all, so no threshold reaches one. A run that went red at
    // `--fail-on info` would mean something that is not a finding is being counted.
    expect(computeExitCode(golden('fixed'), { failOn: 'info' })).toBe(0);
  });

  it('goes to 1 for the fixed run only when the caller opts into coverage gaps', () => {
    expect(computeExitCode(golden('fixed'), { failOnUnverified: true })).toBe(1);
  });
});
