import { describe, expect, it } from 'vitest';

import { renderDeltaJson, renderDeltaText } from './render.ts';
import type { RunDelta } from './run-run.ts';

/**
 * What a reader takes away from a delta.
 *
 * Each assertion is scoped to the section it is about. A test that greps a whole
 * rendered document for an identifier finds the first occurrence, which is usually in a
 * different section than the one under test, and this repository has been bitten by that
 * three times.
 */

function delta(overrides: Partial<RunDelta> = {}): RunDelta {
  return {
    from: 'RUN-20260820-000001',
    to: 'RUN-20260820-000002',
    comparable: true,
    specChanged: false,
    requirements: {
      regressed: [],
      fixed: [],
      stillFailing: [],
      newlyUnverified: [],
      added: [],
      removed: [],
    },
    structural: {
      endpointsAdded: [],
      endpointsRemoved: [],
      fieldsAdded: [],
      accessLoosened: [],
    },
    ...overrides,
  };
}

/** The lines of one section, from its heading to the next one at the same indent. */
function section(document: string, heading: string): string {
  const lines = document.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`  ${heading}`));
  if (start === -1) throw new Error(`no section named ${heading} in the rendered delta`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

describe('rendering a delta as text', () => {
  it('names both runs at the top', () => {
    expect(renderDeltaText(delta())).toMatch(/^Delta RUN-20260820-000001 to RUN-20260820-000002/);
  });

  it('puts access loosening above the verdict movements', () => {
    // The module calls it the headline and gives it its own detection path. Printing it
    // below a list of transitions would bury the one entry that says something forbidden
    // became reachable.
    const document = renderDeltaText(
      delta({
        requirements: {
          regressed: [
            { requirementId: 'REQ-001', from: 'verified', to: 'failed', checkIds: ['CHK-a'] },
          ],
          fixed: [],
          stillFailing: [],
          newlyUnverified: [],
          added: [],
          removed: [],
        },
        structural: {
          endpointsAdded: [],
          endpointsRemoved: [],
          fieldsAdded: [],
          accessLoosened: [
            {
              endpoint: 'AR-001-01',
              detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200',
              requirementId: 'REQ-001',
              ruleId: 'AR-001-01',
            },
          ],
        },
      }),
    );

    expect(document.indexOf('Access loosened')).toBeLessThan(document.indexOf('Regressed'));
  });

  it('states what loosened and what it saw', () => {
    const document = renderDeltaText(
      delta({
        structural: {
          endpointsAdded: [],
          endpointsRemoved: [],
          fieldsAdded: [],
          accessLoosened: [
            {
              endpoint: 'AR-014-01',
              detail: 'GET /api/invoices/42 as actor outsider returned 200 with Invoice fields',
              requirementId: 'REQ-014',
              ruleId: 'AR-014-01',
            },
          ],
        },
      }),
    );

    const loosened = section(document, 'Access loosened');
    expect(loosened).toContain('(1)');
    expect(loosened).toContain('AR-014-01');
    expect(loosened).toContain('REQ-014');
    // The observation, not a label. A finding that said "IDOR" would be claiming intent.
    expect(loosened).toContain('returned 200 with Invoice fields');
  });

  it('says nothing loosened rather than leaving the section out', () => {
    // An absent section reads as a report that does not cover loosening at all, which is
    // the opposite of what a reader should take from a clean delta.
    const loosened = section(renderDeltaText(delta()), 'Access loosened');
    expect(loosened).toContain('(0)');
    expect(loosened).toContain('nothing that was refused before is reachable now');
  });

  it('names every bucket with its count, including the empty ones', () => {
    const document = renderDeltaText(delta());

    expect(section(document, 'Regressed')).toContain('(0)');
    expect(section(document, 'Fixed')).toContain('(0)');
    expect(section(document, 'Still failing')).toContain('(0)');
    expect(section(document, 'Newly unverified')).toContain('(0)');
  });

  it('shows a transition as a movement, with the checks that moved', () => {
    const document = renderDeltaText(
      delta({
        requirements: {
          regressed: [],
          fixed: [
            {
              requirementId: 'REQ-014',
              from: 'failed',
              to: 'verified',
              checkIds: ['CHK-a91f2c', 'CHK-b02d55'],
            },
          ],
          stillFailing: [],
          newlyUnverified: [],
          added: [],
          removed: [],
        },
      }),
    );

    const fixed = section(document, 'Fixed');
    expect(fixed).toContain('REQ-014  failed -> verified');
    expect(fixed).toContain('CHK-a91f2c, CHK-b02d55');
    // The other buckets stay empty, so a reader cannot mistake one movement for four.
    expect(section(document, 'Regressed')).not.toContain('REQ-014');
  });

  it('explains a spec change before it reports any movement', () => {
    // Never present a delta across differing specs as though the application changed. A
    // reader who meets the counts first has already drawn a conclusion from them.
    const document = renderDeltaText(
      delta({
        specChanged: true,
        requirements: {
          regressed: [],
          fixed: [],
          stillFailing: [],
          newlyUnverified: [],
          added: ['REQ-020'],
          removed: ['REQ-002'],
        },
      }),
    );

    expect(document.indexOf('The spec changed')).toBeLessThan(document.indexOf('Access loosened'));
    expect(document).toContain('requirements added: REQ-020');
    expect(document).toContain('requirements removed: REQ-002');
  });

  it('says a run is not comparable, and why, rather than printing an empty delta', () => {
    // An empty delta with no explanation is indistinguishable from nothing having
    // changed, which is the most misleading thing this could report.
    const document = renderDeltaText(
      delta({
        comparable: false,
        incomparableReason: 'the two runs share no requirement',
      }),
    );

    expect(document).toContain('Not comparable');
    expect(document).toContain('the two runs share no requirement');
  });

  it('reports structural change in both directions', () => {
    const document = renderDeltaText(
      delta({
        structural: {
          endpointsAdded: ['POST /api/export'],
          endpointsRemoved: ['GET /api/legacy'],
          fieldsAdded: [{ entity: 'Invoice', field: 'internal_notes' }],
          accessLoosened: [],
        },
      }),
    );

    const structure = section(document, 'Structure');
    expect(structure).toContain('endpoints appeared (1)');
    expect(structure).toContain('POST /api/export');
    expect(structure).toContain('endpoints disappeared (1)');
    expect(structure).toContain('GET /api/legacy');
    expect(structure).toContain('fields appeared (1)');
    expect(structure).toContain('Invoice.internal_notes');
  });

  it('never uses a word that claims more than the tool checked', () => {
    // The same rule the findings section of a report follows. A delta is read by the
    // same person and must not start calling things vulnerabilities.
    const document = renderDeltaText(
      delta({
        structural: {
          endpointsAdded: [],
          endpointsRemoved: [],
          fieldsAdded: [],
          accessLoosened: [
            { endpoint: 'AR-001-01', detail: 'a deny rule now returns 200', ruleId: 'AR-001-01' },
          ],
        },
      }),
    ).toLowerCase();

    for (const term of ['vulnerability', 'exploit', 'idor', 'audit', 'scan']) {
      expect(document).not.toContain(term);
    }
  });
});

describe('rendering a delta as JSON', () => {
  it('round trips through JSON.parse unchanged', () => {
    const original = delta({
      structural: {
        endpointsAdded: ['POST /api/export'],
        endpointsRemoved: [],
        fieldsAdded: [{ entity: 'Invoice', field: 'internal_notes' }],
        accessLoosened: [],
      },
    });

    expect(JSON.parse(renderDeltaJson(original))).toStrictEqual(original);
  });

  it('sorts keys so two identical deltas are byte identical', () => {
    // The same rule renderJson follows, and for the same reason: JSON.stringify emits
    // keys in insertion order, so a document built differently would differ byte for
    // byte while saying the same thing.
    const base = delta();
    const one = renderDeltaJson({ ...base, from: 'RUN-a', to: 'RUN-b' });
    // The same content, with the keys inserted in a different order.
    const other = renderDeltaJson({
      to: 'RUN-b',
      structural: base.structural,
      specChanged: base.specChanged,
      requirements: base.requirements,
      comparable: base.comparable,
      from: 'RUN-a',
    });

    expect(one).toBe(other);
  });

  it('leaves array order alone, since it carries meaning', () => {
    const document = renderDeltaJson(
      delta({
        structural: {
          endpointsAdded: ['POST /b', 'POST /a'],
          endpointsRemoved: [],
          fieldsAdded: [],
          accessLoosened: [],
        },
      }),
    );

    expect(JSON.parse(document)).toMatchObject({
      structural: { endpointsAdded: ['POST /b', 'POST /a'] },
    });
  });
});
