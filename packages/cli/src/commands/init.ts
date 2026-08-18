import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { Stream } from '../reporter.ts';

/**
 * `qai init`: a config, a starter spec, and the `.gitignore` entry for `.qai/`.
 *
 * **It never overwrites.** Invariant I7 says the tool is read only by default, and this
 * is the one command that writes, so the rule matters most here. Somebody running `init`
 * a second time in a configured repository must not lose the config they spent an
 * afternoon on. An existing file is left alone and named, and that is a success rather
 * than an error: running init twice is a reasonable thing to do and refusing would make
 * the command hostile to the exact user who is unsure whether they ran it.
 *
 * **The templates have to load.** A starter config that fails to parse, or a starter
 * spec that produces authoring warnings, makes a user's first `qai validate` red through
 * no fault of their own. The tests run the real loaders over the real output for that
 * reason, and assert zero diagnostics rather than merely no error.
 */

/** Where the starter spec goes. `spec/*.spec.yaml` is the default in 00-INDEX.md. */
export const SPEC_PATH = 'spec/app.spec.yaml';

/** The state directory, which is git ignored per 00-INDEX.md. */
export const GITIGNORE_ENTRY = '.qai/';

/**
 * The starter config.
 *
 * Two actors, because 00-INDEX.md says at least two are required for meaningful access
 * checking, and one of anything teaches the wrong shape. `disposable` is false, since a
 * target is not disposable until somebody writes it down. Credentials are variable names
 * and never values: M2.1 rejects a literal at load time, and a template that taught the
 * habit would be worse than the check that catches it.
 */
export const CONFIG_TEMPLATE = `# Points at the application under inspection.
# Credentials are named here and set in the environment, never written down.

target:
  baseUrl: http://localhost:3000
  sourceRoot: .
  # A target is not disposable until you say so. Mutating checks and seeding refuse
  # to run without this, and without a resetCommand to put the target back.
  disposable: false
  # resetCommand: 'npm run db:reset'

actors:
  # At least two actors are needed to check access rules meaningfully. One actor can
  # only establish that a thing works, never that it is refused to anybody else.
  - id: owner
    auth:
      kind: bearer
      tokenEnv: QAI_OWNER_TOKEN
    attributes:
      org_id: org-1

  - id: outsider
    auth:
      kind: bearer
      tokenEnv: QAI_OUTSIDER_TOKEN
    attributes:
      org_id: org-2

# Where a resource lives, and one record to act on. An access rule names a resource
# rather than a URL, and the tool refuses to guess one from the entity name. Once a
# probe has run, what it observed takes precedence over this.
resources:
  - name: Document
    routes:
      read: /api/documents/{id}
      list: /api/documents
    instances:
      - id: DOC-1
        attributes:
          org_id: org-1

redaction:
  extraPatterns:
    - '(?i)api[_-]?key'
`;

/**
 * The starter spec.
 *
 * Every actor is referenced by an access rule, or the loader warns. Every criterion is
 * written in the request and assertion vocabularies, or `validate` reports it as
 * unsupported. Both of those would be warnings about a file the user did not write, on
 * the first command they run.
 */
export const SPEC_TEMPLATE = `specVersion: '0.1'
name: 'My application'

# This file states intent. It describes the application as it is meant to be, not as
# it was built, and the tool reports where the two disagree.
#
# Replace Document with an entity your application actually has, point the routes in
# qai.config.yaml at it, then run: qai check

actors:
  - id: owner
    description: 'Authenticated user belonging to organization org-1'
  - id: outsider
    description: 'Authenticated user belonging to organization org-2'

entities:
  - name: Document
    ownedBy: Organization
    fields:
      - name: id
        type: string
      - name: org_id
        type: string
      - name: title
        type: string
      # A field marked sensitive never appears in recorded evidence.
      - name: internal_notes
        type: string
        sensitive: true

requirements:
  - id: REQ-001
    statement: 'A user can only read documents belonging to their own organization'
    entities: [Document]
    fields: [Document.org_id]
    tags: [access-control]
    accessRules:
      # A deny rule is checked by attempting the action and requiring a refusal.
      - id: AR-001-01
        actor: outsider
        action: read
        resource: Document
        condition: 'Document.org_id != actor.org_id'
        effect: deny
      # An allow rule is checked by attempting it and requiring success, which is what
      # stops the tool reporting a locked door as a success.
      - id: AR-001-02
        actor: owner
        action: read
        resource: Document
        effect: allow
    acceptanceCriteria:
      - id: AC-001-01
        mode: deterministic
        given: 'a document belonging to organization org-1'
        when: 'actor outsider reads Document DOC-1'
        then: 'status in 403, 404 and body omits field Document.org_id'

  - id: REQ-002
    statement: 'A document list contains only documents from the caller organization'
    entities: [Document]
    fields: [Document.org_id]
    tags: [access-control]
    accessRules:
      - id: AR-002-01
        actor: outsider
        action: list
        resource: Document
        condition: 'Document.org_id != actor.org_id'
        effect: deny
    acceptanceCriteria:
      - id: AC-002-01
        mode: deterministic
        given: 'documents belonging to both organizations'
        when: 'actor outsider lists Document'
        then: 'every Document has org_id equal to actor.org_id'
`;

export interface InitOptions {
  readonly cwd: string;
  /** Where the config goes, already resolved through the flag and the environment. */
  readonly configPath: string;
  readonly stdout: Stream;
  readonly stderr: Stream;
}

function absolute(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Returns what happened, so the caller can report it in one voice. */
function writeIfAbsent(target: string, contents: string): 'created' | 'exists' {
  if (existsSync(target)) return 'exists';

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
  return 'created';
}

/**
 * Adds `.qai/` to `.gitignore`, or creates the file.
 *
 * The existing content is preserved exactly, and a file whose last line has no
 * terminator gets one first. Without that the entry is glued onto the last line,
 * producing something like `dist/.qai/`, which ignores neither.
 */
function ensureGitignore(target: string): 'created' | 'updated' | 'exists' {
  if (!existsSync(target)) {
    writeFileSync(target, `${GITIGNORE_ENTRY}\n`, 'utf8');
    return 'created';
  }

  const current = readFileSync(target, 'utf8');
  const alreadyIgnored = current
    .split(/\r?\n/)
    .some((line) => line.trim() === GITIGNORE_ENTRY || line.trim() === '.qai');
  if (alreadyIgnored) return 'exists';

  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  writeFileSync(target, `${current}${separator}${GITIGNORE_ENTRY}\n`, 'utf8');
  return 'updated';
}

export function runInit(options: InitOptions): Promise<number> {
  const { cwd, configPath, stdout, stderr } = options;

  const targets = [
    { label: configPath, path: absolute(cwd, configPath), contents: CONFIG_TEMPLATE },
    { label: SPEC_PATH, path: absolute(cwd, SPEC_PATH), contents: SPEC_TEMPLATE },
  ];

  const lines: string[] = [];

  try {
    for (const target of targets) {
      const outcome = writeIfAbsent(target.path, target.contents);
      lines.push(
        outcome === 'created'
          ? `  created  ${target.label}`
          : `  ${target.label} already exists, left alone`,
      );
    }

    const gitignore = ensureGitignore(absolute(cwd, '.gitignore'));
    lines.push(
      gitignore === 'exists'
        ? `  .gitignore already ignores ${GITIGNORE_ENTRY}, left alone`
        : `  ${gitignore === 'created' ? 'created' : 'updated'}  .gitignore, ignoring ${GITIGNORE_ENTRY}`,
    );
  } catch (cause) {
    // Exit 2: a configuration error with no run performed, per 03-CONTRACTS.md.
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    stderr.write(`error: could not write the starter files\n  ${reason}\n`);
    return Promise.resolve(2);
  }

  stdout.write(`${lines.join('\n')}\n`);
  stdout.write(`\nEdit ${SPEC_PATH} to describe your application, then run: qai validate\n`);

  return Promise.resolve(0);
}
