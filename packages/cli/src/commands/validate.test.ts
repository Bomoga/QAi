import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Stream } from '../reporter.ts';
import { DEFAULT_SPEC_GLOB, runValidate } from './validate.ts';
import { SPEC_TEMPLATE } from './init.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-validate-'));
  mkdirSync(join(dir, 'spec'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

function writeSpec(body: string, name = 'app.spec.yaml'): void {
  writeFileSync(join(dir, 'spec', name), body, 'utf8');
}

async function validate(paths: readonly string[] = [], format?: string) {
  const out = capture();
  const err = capture();
  const code = await runValidate({
    cwd: dir,
    paths,
    stdout: out.stream,
    stderr: err.stream,
    ...(format === undefined ? {} : { format }),
  });
  return { code, out: out.text(), err: err.text() };
}

/** The smallest spec that loads without a single diagnostic. */
const CLEAN_SPEC = `specVersion: '0.1'
name: 'Small app'
actors:
  - id: owner
    description: 'The owner'
entities:
  - name: Document
    fields:
      - name: id
        type: string
requirements:
  - id: REQ-001
    statement: 'An owner can read their own document'
    entities: [Document]
    accessRules:
      - id: AR-001-01
        actor: owner
        action: read
        resource: Document
        effect: allow
    acceptanceCriteria:
      - id: AC-001-01
        mode: deterministic
        given: 'a document'
        when: 'actor owner reads Document DOC-1'
        then: 'status is 200'
`;

describe('qai validate', () => {
  it('exits 0 and summarises a spec that loads cleanly', async () => {
    writeSpec(CLEAN_SPEC);

    const { code, out } = await validate();

    expect(code).toBe(0);
    expect(out).toContain('Small app');
    expect(out).toContain('sha256:');
  });

  it('counts what the spec contains, not merely that it parsed', async () => {
    // The module says print a summary of requirements, rules, and criteria. A user runs
    // this to confirm the file says what they think it says.
    writeSpec(CLEAN_SPEC);

    const { out } = await validate();

    expect(out).toContain('1 requirement');
    expect(out).toContain('1 access rule');
    expect(out).toContain('1 acceptance criterion');
    expect(out).toContain('1 actor');
    expect(out).toContain('1 entity');
  });

  it('names every file it read', async () => {
    writeSpec(CLEAN_SPEC);

    expect((await validate()).out).toContain('app.spec.yaml');
  });

  it('finds specs through the default glob when no path is given', async () => {
    writeSpec(CLEAN_SPEC, 'one.spec.yaml');
    // A second file has to declare a different requirement, since the loader treats one
    // id defined in two files as a conflicting redefinition.
    writeSpec(CLEAN_SPEC.replaceAll('001', '002'), 'two.spec.yaml');

    const { code, out } = await validate();

    expect(code).toBe(0);
    expect(out).toContain('one.spec.yaml');
    expect(out).toContain('two.spec.yaml');
    expect(DEFAULT_SPEC_GLOB).toContain('spec/');
  });

  it('validates the exact paths it was given instead of the glob', async () => {
    writeSpec(CLEAN_SPEC, 'wanted.spec.yaml');
    writeSpec('this is not a spec at all', 'broken.spec.yaml');

    const { code, out } = await validate(['spec/wanted.spec.yaml']);

    expect(code).toBe(0);
    expect(out).toContain('wanted.spec.yaml');
    expect(out).not.toContain('broken.spec.yaml');
  });

  it('exits 2 when no spec file matches at all', async () => {
    // Reporting a clean run over nothing is the vacuous green this project keeps
    // catching elsewhere. Nothing to validate is a configuration problem.
    const { code, err } = await validate();

    expect(code).toBe(2);
    expect(err).toContain('no spec files matched');
  });

  it('exits 2 with the file, the path, and the reason when a spec will not load', async () => {
    writeSpec("specVersion: '0.1'\nname: 'Broken'\nrequirements: not-a-list\n");

    const { code, err } = await validate();

    expect(code).toBe(2);
    expect(err).toContain('app.spec.yaml');
    expect(err).toContain('requirements');
  });

  it('exits 2 on an error diagnostic even when a spec was produced', async () => {
    // A spec that loaded with errors is still a spec no run should proceed on.
    writeSpec(`${CLEAN_SPEC}`.replace('effect: allow', 'effect: sideways'));

    expect((await validate()).code).toBe(2);
  });

  it('exits 0 on a warning, since a warning means the spec loaded', async () => {
    // An actor nothing references is a coverage fact, not an authoring mistake, and
    // failing the command over one would teach people to stop reading warnings.
    writeSpec(
      CLEAN_SPEC.replace(
        "  - id: owner\n    description: 'The owner'\n",
        "  - id: owner\n    description: 'The owner'\n  - id: nobody\n    description: 'Referenced by nothing'\n",
      ),
    );

    const { code, out } = await validate();

    expect(code).toBe(0);
    expect(out).toContain('nobody');
    expect(out).toContain('warning');
  });

  it('reports a criterion the assertion vocabulary cannot read, without failing', async () => {
    // An unsupported `then` is a coverage gap the author should see. It is not a load
    // error, and treating it as one would refuse a spec the loader accepted.
    writeSpec(CLEAN_SPEC.replace("then: 'status is 200'", "then: 'it all works nicely'"));

    const { code, out } = await validate();

    expect(code).toBe(0);
    expect(out).toContain('AC-001-01');
  });

  it('accepts the spec that init writes, with nothing to report', async () => {
    // The two commands a user runs first, in order. A starter spec that warns on the
    // very next command would be the tool's own fault.
    writeSpec(SPEC_TEMPLATE);

    const { code, out } = await validate();

    expect(code).toBe(0);
    expect(out).toContain('0 warning');
  });

  it('says a format flag does not apply rather than ignoring it', async () => {
    // A silently ignored flag is a user believing they configured something they did
    // not. The emitters project a RunResult and a spec summary is not one.
    writeSpec(CLEAN_SPEC);

    const { code, err } = await validate([], 'json');

    expect(code).toBe(0);
    expect(err).toContain('--format');
  });

  it('writes the summary to stdout and diagnostics that stop the run to stderr', async () => {
    writeSpec("specVersion: '0.1'\nname: 'Broken'\nrequirements: not-a-list\n");

    const { out, err } = await validate();

    expect(out).toBe('');
    expect(err).not.toBe('');
  });

  it('contains no em dash', async () => {
    writeSpec(CLEAN_SPEC);

    const { out } = await validate();
    expect(out).not.toContain('—');
  });
});
