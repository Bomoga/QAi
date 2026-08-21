import { renderJsonDocument } from '../report/json.ts';
import type { RequirementTransition, RunDelta } from './run-run.ts';

/**
 * How a RunDelta is read.
 *
 * **Access loosening leads.** The module calls it the headline and gives it its own
 * detection path; printing it below a list of verdict movements would bury the one entry
 * that says something forbidden became reachable. A reader who stops after the first
 * screen should have seen it.
 *
 * **A delta across two specs says so before it says anything else.** Never present a
 * delta across differing specs as though the application changed. The line about which
 * requirements arrived and left comes before the transitions, so a reader meets the
 * explanation before the numbers it explains.
 *
 * **An empty bucket is named, not omitted.** A report that prints only what happened
 * leaves a reader unable to tell "nothing regressed" from "regressions are not reported
 * here". The counts are cheap and the ambiguity is not.
 *
 * **Nothing here decides anything.** Rule R5: this returns a string, and the surface
 * writes it.
 */

function heading(delta: RunDelta): string[] {
  const lines = [`Delta ${delta.from} to ${delta.to}`, ''];

  if (!delta.comparable) {
    lines.push(
      '  Not comparable.',
      `    ${delta.incomparableReason ?? 'the two runs share no requirement'}`,
      '',
    );
  }

  if (delta.specChanged) {
    // Said out loud, because every count below is restricted to the requirements the two
    // runs share, and a reader who does not know that will read a shorter list as calm.
    lines.push(
      '  The spec changed between these runs, so the comparison covers only the',
      '  requirements both runs had.',
    );

    const { added, removed } = delta.requirements;
    lines.push(
      `    requirements added: ${added.length === 0 ? 'none' : added.join(', ')}`,
      `    requirements removed: ${removed.length === 0 ? 'none' : removed.join(', ')}`,
      '',
    );
  }

  return lines;
}

function loosenings(delta: RunDelta): string[] {
  const entries = delta.structural.accessLoosened;
  const lines = [`  Access loosened (${entries.length})`];

  if (entries.length === 0) {
    lines.push('    nothing that was refused before is reachable now', '');
    return lines;
  }

  for (const entry of entries) {
    const where = [entry.requirementId, entry.ruleId].filter((one) => one !== undefined).join(' ');
    lines.push(`    ${entry.endpoint}${where === '' ? '' : `  (${where})`}`);
    lines.push(`      ${entry.detail}`);
  }

  lines.push('');
  return lines;
}

/** `REQ-014  verified -> failed  CHK-a91f2c, CHK-b02d55` */
function transition(entry: RequirementTransition): string {
  const checks = entry.checkIds.length === 0 ? 'no check moved' : entry.checkIds.join(', ');
  return `    ${entry.requirementId}  ${entry.from} -> ${entry.to}  ${checks}`;
}

function bucket(label: string, entries: readonly RequirementTransition[]): string[] {
  const lines = [`  ${label} (${entries.length})`];
  for (const entry of entries) lines.push(transition(entry));
  return lines;
}

function structure(delta: RunDelta): string[] {
  const { endpointsAdded, endpointsRemoved, fieldsAdded } = delta.structural;
  const lines = ['  Structure'];

  lines.push(`    endpoints appeared (${endpointsAdded.length})`);
  for (const id of endpointsAdded) lines.push(`      ${id}`);

  lines.push(`    endpoints disappeared (${endpointsRemoved.length})`);
  for (const id of endpointsRemoved) lines.push(`      ${id}`);

  lines.push(`    fields appeared (${fieldsAdded.length})`);
  for (const field of fieldsAdded) lines.push(`      ${field.entity}.${field.field}`);

  return lines;
}

export function renderDeltaText(delta: RunDelta): string {
  const lines = [
    ...heading(delta),
    ...loosenings(delta),
    ...bucket('Regressed', delta.requirements.regressed),
    ...bucket('Fixed', delta.requirements.fixed),
    ...bucket('Still failing', delta.requirements.stillFailing),
    ...bucket('Newly unverified', delta.requirements.newlyUnverified),
    '',
    ...structure(delta),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

/** The machine readable projection, sorted the same way a run document is. */
export function renderDeltaJson(delta: RunDelta): string {
  return renderJsonDocument(delta);
}
