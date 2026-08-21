import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RunResultSchema } from '../packages/core/src/index.ts';
import {
  EMPTY_LEDGER,
  falsePositiveRates,
  findingsOf,
  mergeFindings,
  type Ledger,
  type LedgerEntry,
  type Rate,
} from './lib/ledger.ts';

/**
 * Folds a corpus run into the review ledger, and says what is still waiting.
 *
 * **It never classifies anything.** Every finding arrives unreviewed and a human decides
 * what it is. A script that guessed would be answering the question the whole stage
 * exists to ask, and the answer would be worth nothing.
 *
 * **A review already recorded is never overwritten.** That is what makes running the
 * corpus again cheap: only findings that are actually new come back unreviewed.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_DIR = join(ROOT, 'corpus', 'results');
const LEDGER_PATH = join(ROOT, 'corpus', 'ledger.json');

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The most recent run, since the directories are named for the instant they started. */
export function latestResults(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;

  const stamps = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const last = stamps[stamps.length - 1];
  return last === undefined ? undefined : join(dir, last);
}

function readLedger(): Ledger {
  if (!existsSync(LEDGER_PATH)) return EMPTY_LEDGER;

  const parsed: unknown = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || !('entries' in parsed)) {
    throw new Error(`${LEDGER_PATH} is not a ledger`);
  }
  return parsed as Ledger;
}

function percent(rate: number | undefined): string {
  return rate === undefined ? 'no rate yet' : `${(rate * 100).toFixed(1)}%`;
}

function describeRate(label: string, rate: Rate): string {
  const flag = rate.aboveThreshold ? '  OVER THRESHOLD' : '';
  const partial = rate.complete ? '' : `, ${rate.unreviewed} unreviewed`;
  return `  ${label.padEnd(24)} ${percent(rate.rate).padStart(11)}  (${rate.falsePositives} of ${rate.judged} judged${partial})${flag}`;
}

export function reviewCorpus(): number {
  const resultsDir = latestResults(RESULTS_DIR);
  if (resultsDir === undefined) {
    log('No corpus results yet. Run corpus/run.ts first.');
    return 0;
  }

  const runFiles = readdirSync(resultsDir)
    .filter((name) => name.endsWith('.run.json'))
    .sort();

  const findings: LedgerEntry[] = [];
  for (const name of runFiles) {
    const slug = name.slice(0, -'.run.json'.length);
    // Parsed rather than cast. A document off disk is a boundary, rule R2, and a ledger
    // built from an unchecked shape would put the wrong thing in front of a reviewer.
    const result = RunResultSchema.parse(JSON.parse(readFileSync(join(resultsDir, name), 'utf8')));
    findings.push(...findingsOf(slug, result));
  }

  const { ledger, added, absent } = mergeFindings(readLedger(), findings);
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');

  log(`Folded ${runFiles.length} run(s) from ${resultsDir} into the ledger.`);
  log(`  ${findings.length} finding(s) in this run`);
  log(`  ${added.length} new, arriving unreviewed`);
  if (absent.length > 0) {
    log(
      `  ${absent.length} reviewed finding(s) this run did not produce, kept: ${absent.join(', ')}`,
    );
  }

  const rates = falsePositiveRates(ledger);
  const waiting = ledger.entries.filter((entry) => entry.classification === 'unreviewed');

  log('\nFalse positive rate');
  log(describeRate('overall', rates.overall));
  for (const one of rates.byType) log(describeRate(`type ${one.type}`, one.rate));
  for (const one of rates.byRule) log(describeRate(`rule ${one.ruleId}`, one.rate));

  if (rates.overThreshold.length > 0) {
    log(`\nAbove five percent, and disabled before the demo per invariant I2:`);
    for (const name of rates.overThreshold) log(`  ${name}`);
  }

  if (waiting.length > 0) {
    log(`\n${waiting.length} finding(s) waiting for review, in ${LEDGER_PATH}:`);
    for (const entry of waiting) {
      log(`  ${entry.app}  ${entry.findingId}  ${entry.severity}  ${entry.title}`);
    }
    log('\nSet each classification to true-positive, false-positive, or unclear, with a note.');
  }

  return 0;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith('review.ts')) {
  try {
    process.exitCode = reviewCorpus();
  } catch (error) {
    process.stderr.write(
      `review failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 3;
  }
}
