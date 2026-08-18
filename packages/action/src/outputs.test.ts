import { describe, expect, it } from 'vitest';

import { OUTPUT_NAMES, formatOutputs, outputsFromSarif, summaryLine } from './outputs.ts';

/**
 * The outputs come from the SARIF the run already wrote, never from a second run.
 *
 * These tests build SARIF the way `renderSarif` does, so a change to that emitter that
 * moved coverage out of `runs[0].properties` would fail here rather than silently
 * reporting zero.
 */
function sarif(
  results: readonly { level: string }[] = [],
  properties: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    $schema:
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'QAi', rules: [] } },
        results,
        properties: {
          specHash: 'sha256:abc',
          coverage: 0.8,
          coverageMeaning: 'requirements with at least one check that reached a verdict',
          modelAssistedCheckCount: 1,
          requirementsUnverified: 2,
          ...properties,
        },
      },
    ],
  });
}

describe('reading the outputs out of a SARIF report', () => {
  it('counts findings by level', () => {
    const outputs = outputsFromSarif(
      sarif([{ level: 'error' }, { level: 'error' }, { level: 'warning' }, { level: 'note' }]),
    );

    expect(outputs.findingsTotal).toBe(4);
    expect(outputs.findingsError).toBe(2);
    expect(outputs.findingsWarning).toBe(1);
    expect(outputs.findingsNote).toBe(1);
  });

  it('reports zero findings for a clean run rather than failing to read it', () => {
    const outputs = outputsFromSarif(sarif([]));

    expect(outputs.findingsTotal).toBe(0);
    expect(outputs.findingsError).toBe(0);
  });

  it('takes coverage and the two counts from the run properties', () => {
    // These are in the SARIF because M7.4 put them there for this caller. If they move,
    // this fails rather than quietly reporting zero.
    const outputs = outputsFromSarif(sarif([]));

    expect(outputs.coveragePercent).toBe(80);
    expect(outputs.requirementsUnverified).toBe(2);
    expect(outputs.modelAssistedChecks).toBe(1);
  });

  it('rounds coverage to a whole percent', () => {
    // A workflow comparing against a threshold does not want sixteen decimal places.
    expect(outputsFromSarif(sarif([], { coverage: 2 / 3 })).coveragePercent).toBe(67);
  });

  it('throws on a report it cannot parse rather than reporting nothing found', () => {
    // An Action reporting zero findings from an unreadable file is the quietest possible
    // failure, and the one worth being loud about.
    expect(() => outputsFromSarif('not json at all')).toThrow(/could not be parsed/);
  });

  it('throws on a document with no run in it', () => {
    expect(() => outputsFromSarif(JSON.stringify({ version: '2.1.0', runs: [] }))).toThrow(
      /no run/,
    );
  });

  it('treats an absent property as zero rather than as undefined', () => {
    const bare = JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'QAi' } } }],
    });
    const outputs = outputsFromSarif(bare);

    expect(outputs.findingsTotal).toBe(0);
    expect(outputs.coveragePercent).toBe(0);
    expect(formatOutputs(outputs)).not.toContain('undefined');
  });
});

describe('writing the outputs', () => {
  it('writes one name=value line per output, in the kebab case a workflow reads', () => {
    const text = formatOutputs(outputsFromSarif(sarif([{ level: 'error' }])));

    for (const name of Object.values(OUTPUT_NAMES)) expect(text).toContain(`${name}=`);
    expect(text).toContain('findings-error=1');
    expect(text).toContain('coverage-percent=80');
  });

  it('writes only numbers, so no value can contain a newline', () => {
    // A value that could would need the heredoc form. Keeping every output numeric is
    // what makes the simple form safe rather than lucky.
    const text = formatOutputs(outputsFromSarif(sarif([{ level: 'note' }])));

    for (const line of text.trimEnd().split('\n')) {
      const value = line.split('=')[1];
      expect(value).toMatch(/^\d+$/);
    }
  });

  it('names every declared output and nothing else', () => {
    // An output declared in action.yml with nothing writing it comes back as an empty
    // string, which a workflow reads as zero findings.
    const written = formatOutputs(outputsFromSarif(sarif([])))
      .trimEnd()
      .split('\n')
      .map((line) => line.split('=')[0]);

    expect(written.sort()).toStrictEqual([...Object.values(OUTPUT_NAMES)].sort());
  });
});

describe('the summary line', () => {
  it('states coverage as coverage and says what it counts', () => {
    const line = summaryLine(outputsFromSarif(sarif([{ level: 'error' }])));

    expect(line).toContain('Coverage 80%');
    expect(line).toContain('requirements with at least one check that reached a verdict');
    expect(line.toLowerCase()).not.toContain('pass rate');
  });

  it('says how much of the run was not deterministic, and how much went unverified', () => {
    const line = summaryLine(outputsFromSarif(sarif([])));

    expect(line).toContain('2 requirement(s) unverified');
    expect(line).toContain('1 model assisted check(s)');
  });

  it('contains no em dash', () => {
    expect(summaryLine(outputsFromSarif(sarif([])))).not.toContain('—');
  });
});
