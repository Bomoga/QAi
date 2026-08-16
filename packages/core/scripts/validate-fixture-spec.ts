import { resolve } from 'node:path';

import { formatDiagnostic } from '../src/spec/diagnostics.ts';
import { isLoadFailure, loadSpec } from '../src/spec/load.ts';

/**
 * Loads the fixture spec and reports what came back. Named in the Definition of Done
 * in modules/M1-spec.md, and the closest thing to `qai validate` that exists before
 * the CLI does.
 *
 * Exit codes follow the table in 03-CONTRACTS.md: 0 for a clean load, 2 for a spec
 * that could not be loaded.
 */

export const FIXTURE_SPEC_PATH = 'fixtures/ledger/spec/ledger.spec.yaml';

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..');
}

function main(): void {
  const root = repositoryRoot();
  const result = loadSpec([FIXTURE_SPEC_PATH], { cwd: root });

  if (isLoadFailure(result)) {
    process.stdout.write(`${result.error.message}\n`);
    for (const diagnostic of result.error.diagnostics) {
      process.stdout.write(`  ${formatDiagnostic(diagnostic)}\n`);
    }
    process.exit(2);
  }

  const { spec, hash, diagnostics, conditions } = result;
  const accessRules = spec.requirements.flatMap((requirement) => requirement.accessRules);
  const criteria = spec.requirements.flatMap((requirement) => requirement.acceptanceCriteria);
  const withoutChecks = spec.requirements.filter(
    (requirement) =>
      requirement.accessRules.length === 0 && requirement.acceptanceCriteria.length === 0,
  );

  process.stdout.write(`${spec.name}, specVersion ${spec.specVersion}\n`);
  process.stdout.write(`  file          ${FIXTURE_SPEC_PATH}\n`);
  process.stdout.write(`  hash          ${hash}\n`);
  process.stdout.write(`  actors        ${spec.actors.length}\n`);
  process.stdout.write(`  entities      ${spec.entities.length}\n`);
  process.stdout.write(`  requirements  ${spec.requirements.length}\n`);
  process.stdout.write(`  access rules  ${accessRules.length}\n`);
  process.stdout.write(`  criteria      ${criteria.length}\n`);
  process.stdout.write(`  conditions    ${conditions.size} parsed\n`);
  process.stdout.write(`  no checks     ${withoutChecks.map((r) => r.id).join(', ') || 'none'}\n`);

  if (diagnostics.length > 0) {
    process.stdout.write(`\n${diagnostics.length} diagnostic(s):\n`);
    for (const diagnostic of diagnostics) {
      process.stdout.write(`  ${formatDiagnostic(diagnostic)}\n`);
    }
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main();
}
