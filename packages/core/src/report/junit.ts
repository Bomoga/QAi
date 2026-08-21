import type { CheckResultRecord, RunResult } from '../contracts/index.ts';

/**
 * The JUnit XML projection of a RunResult, for a CI dashboard.
 *
 * **Inconclusive is `skipped`, never `failure`.** That is the whole point of this
 * emitter's mapping and it is invariant I4 in the one format most likely to break it. A
 * dashboard that counts red and green has no third column, so a check that could not
 * reach a verdict has to land in the column that means nobody knows rather than in either
 * of the two that claim somebody does. Reporting it as a failure would also train the
 * reader to ignore failures, which costs more than the gap it hid.
 *
 * **A requirement with no checks still gets a suite.** One skipped case, named with the
 * reason. Emitting nothing would drop the requirement out of the dashboard and a reader
 * comparing two runs would see a requirement disappear rather than a gap appear.
 *
 * **Hand-rolled, escaping included.** No XML library is on the approved list and the
 * document is a few hundred bytes of five element types. What matters is that every
 * attribute and every text node goes through one escape function, since a detail string
 * quoting a JSON body will contain the characters that end an attribute.
 */

/** The five XML entities, plus the characters XML 1.0 has no representation for. */
function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Not escapable, only removable. A raw control byte in a captured detail would
      // produce a document no parser will read, which loses the whole report rather
      // than one character of one message.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

function attributes(pairs: readonly (readonly [string, string | number])[]): string {
  return pairs.map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`).join('');
}

/**
 * Seconds between two instants, or nothing when either will not parse.
 *
 * Read from the run result rather than from a clock, per rule R6. Per-case timing is not
 * recorded anywhere, and writing zero for it would claim a measurement that was never
 * taken, so a testcase carries no `time` at all.
 */
function durationSeconds(startedAt: string, finishedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;

  return (end - start) / 1000;
}

/**
 * `AR-014-01 CHK-a91f2c Invoice readable by ...`
 *
 * The check id is in the name because two actors against one access rule are two checks
 * that share a rule id, per M3.1. A dashboard tracking a case across runs needs the name
 * to identify one check, and the content-hashed id is the only part that does.
 */
function caseName(check: CheckResultRecord): string {
  const lead = check.ruleId === undefined ? check.checkId : `${check.ruleId} ${check.checkId}`;
  return `${lead} ${check.title}`;
}

function failureText(check: CheckResultRecord): string {
  const parts: string[] = [];
  if (check.detail !== undefined) parts.push(check.detail);
  if (check.locationRef !== undefined) parts.push(`Source: ${check.locationRef}`);
  if (check.evidence.length > 0) parts.push(`Evidence: ${check.evidence.join(', ')}`);
  if (!check.deterministic) parts.push('Model assisted');
  return parts.join('\n');
}

interface Suite {
  readonly name: string;
  readonly cases: readonly string[];
  readonly failures: number;
  readonly skipped: number;
}

function renderCase(check: CheckResultRecord, classname: string): string {
  const open = `    <testcase${attributes([
    ['name', caseName(check)],
    ['classname', classname],
  ])}`;

  if (check.verdict === 'fail') {
    const body = failureText(check);
    const failure = `      <failure${attributes([
      ['message', check.title],
      ['type', `${check.type}:${check.severity}`],
    ])}>${escapeXml(body)}</failure>`;
    return `${open}>\n${failure}\n    </testcase>`;
  }

  if (check.verdict === 'inconclusive') {
    // Never a failure. A coverage gap that reads as a failure is as wrong as one that
    // reads as a pass, and it is the wrong one people notice second.
    const reason = check.detail ?? 'The check did not reach a verdict.';
    // Said here as well as on a failure. A skipped case is exactly where a reader asks
    // why nobody knows, and whether a model was involved is part of that answer.
    const message = check.deterministic ? reason : `${reason} Model assisted`;
    return `${open}>\n      <skipped${attributes([['message', message]])} />\n    </testcase>`;
  }

  return `${open} />`;
}

function suiteFor(name: string, checks: readonly CheckResultRecord[]): Suite {
  return {
    name,
    cases: checks.map((check) => renderCase(check, name)),
    failures: checks.filter((check) => check.verdict === 'fail').length,
    skipped: checks.filter((check) => check.verdict === 'inconclusive').length,
  };
}

/**
 * The suite a requirement gets when nothing ran for it: one skipped case carrying the
 * reason from `unverifiedReasons`, which is the closed set in 03-CONTRACTS.md.
 */
function emptySuite(requirementId: string, reason: string): Suite {
  return {
    name: requirementId,
    cases: [
      `    <testcase${attributes([
        ['name', `${requirementId} no checks ran`],
        ['classname', requirementId],
      ])}>\n      <skipped${attributes([['message', reason]])} />\n    </testcase>`,
    ],
    failures: 0,
    skipped: 1,
  };
}

function renderSuite(suite: Suite): string {
  const open = `  <testsuite${attributes([
    ['name', suite.name],
    ['tests', suite.cases.length],
    ['failures', suite.failures],
    ['skipped', suite.skipped],
    // Rule R4 turns a thrown check into an inconclusive result, so nothing reaching this
    // emitter is an error in the JUnit sense. Stated rather than left off, since an
    // absent attribute reads as unknown and zero reads as a fact.
    ['errors', 0],
  ])}>`;

  return [open, ...suite.cases, '  </testsuite>'].join('\n');
}

export function renderJunit(result: RunResult): string {
  const byRequirement = new Map<string, CheckResultRecord[]>();
  const unassigned: CheckResultRecord[] = [];

  for (const check of result.checks) {
    if (check.requirementId === undefined) {
      unassigned.push(check);
      continue;
    }
    const bucket = byRequirement.get(check.requirementId) ?? [];
    bucket.push(check);
    byRequirement.set(check.requirementId, bucket);
  }

  const reasons = new Map(
    result.unverifiedReasons.map((entry) => [entry.requirementId, entry] as const),
  );

  const suites: Suite[] = [];

  // Requirement order follows the run result, which follows the spec, so two runs read
  // down the same list in a dashboard.
  for (const requirement of result.requirements) {
    const own = byRequirement.get(requirement.requirementId) ?? [];

    if (own.length === 0) {
      const recorded = reasons.get(requirement.requirementId);
      const reason =
        recorded === undefined
          ? (requirement.reason ?? 'no reason was recorded')
          : recorded.detail === undefined
            ? recorded.reason
            : `${recorded.reason}: ${recorded.detail}`;
      suites.push(emptySuite(requirement.requirementId, reason));
      continue;
    }

    suites.push(suiteFor(requirement.requirementId, own));
  }

  // A check belonging to no requirement is still a check that ran. Dropping it would
  // lose a finding, and a structural result is the obvious case.
  if (unassigned.length > 0) {
    suites.push(suiteFor('unassigned', unassigned));
  }

  const tests = suites.reduce((total, suite) => total + suite.cases.length, 0);
  const failures = suites.reduce((total, suite) => total + suite.failures, 0);
  const skipped = suites.reduce((total, suite) => total + suite.skipped, 0);
  const seconds = durationSeconds(result.startedAt, result.finishedAt);

  // Counted from what was emitted rather than copied from `summary`. Two sources for one
  // number is how a report starts contradicting itself.
  const root = `<testsuites${attributes([
    ['name', result.runId],
    ['tests', tests],
    ['failures', failures],
    ['skipped', skipped],
    ['errors', 0],
    ...(seconds === undefined
      ? []
      : ([['time', seconds]] as readonly (readonly [string, number])[])),
  ])}>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    root,
    ...suites.map(renderSuite),
    '</testsuites>',
    '',
  ].join('\n');
}
