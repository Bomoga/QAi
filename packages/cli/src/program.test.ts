import { describe, expect, it } from 'vitest';

import { GLOBAL_FLAGS, createProgram } from './program.ts';

/**
 * The command surface is the public API of this package, so these tests are about what
 * the surface accepts rather than about what any command does. The commands themselves
 * arrive at M8.3 through M8.6.
 *
 * `createProgram` sets `exitOverride`, so a parse error throws instead of killing the
 * test runner. That is also what lets M8.7 present errors itself rather than letting
 * Commander print them.
 */
function parse(argv: readonly string[]) {
  const program = createProgram();
  program.parse(['node', 'qai', ...argv]);
  return program;
}

describe('the qai program', () => {
  it('is named qai, since every identifier in this project derives from that token', () => {
    expect(createProgram().name()).toBe('qai');
  });

  it('accepts every global flag the module lists', () => {
    // Read as a list rather than one assertion each, so a flag dropped from the surface
    // fails here and not in whichever command happened to use it.
    const options = createProgram().options.map((option) => option.long);

    for (const flag of GLOBAL_FLAGS) expect(options).toContain(flag);
  });

  it('parses the flags that take a value', () => {
    const options = parse([
      '--config',
      'other.yaml',
      '--format',
      'sarif',
      '--out',
      'results.sarif',
      '--fail-on',
      'medium',
      '--concurrency',
      '4',
    ]).opts();

    expect(options['config']).toBe('other.yaml');
    expect(options['format']).toBe('sarif');
    expect(options['out']).toBe('results.sarif');
    expect(options['failOn']).toBe('medium');
    expect(options['concurrency']).toBe('4');
  });

  it('parses the flags that are switches, and defaults them off', () => {
    expect(parse([]).opts()['failOnUnverified']).toBe(undefined);
    expect(parse([]).opts()['verbose']).toBe(undefined);

    const on = parse(['--fail-on-unverified', '--verbose']).opts();
    expect(on['failOnUnverified']).toBe(true);
    expect(on['verbose']).toBe(true);
  });

  it('treats --no-color as color off and its absence as color on', () => {
    expect(parse([]).opts()['color']).toBe(true);
    expect(parse(['--no-color']).opts()['color']).toBe(false);
  });

  it('refuses a format outside the four the module names', () => {
    for (const format of ['text', 'json', 'sarif', 'junit']) {
      expect(() => parse(['--format', format])).not.toThrow();
    }
    // Guessing at what somebody meant by a misspelled format would produce a report in a
    // shape their pipeline cannot read, which is worse than refusing.
    expect(() => parse(['--format', 'xml'])).toThrow();
  });

  it('refuses a severity outside high, medium, and low', () => {
    for (const severity of ['high', 'medium', 'low']) {
      expect(() => parse(['--fail-on', severity])).not.toThrow();
    }
    // `info` is deliberately absent: the module's flag list stops at low.
    expect(() => parse(['--fail-on', 'info'])).toThrow();
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    // A silently ignored flag is a user believing they configured something they did not.
    expect(() => parse(['--fail-onn', 'high'])).toThrow();
  });

  it('throws rather than exiting the process, so a caller can present the error', () => {
    // Commander exits on its own by default, which would take the test runner with it and
    // would leave M8.7 no way to print an error in this project's own voice.
    let thrown: unknown;
    try {
      parse(['--format', 'xml']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
  });

  it('reports a version', () => {
    expect(createProgram().version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('describes itself without naming a vulnerability class or claiming intent', () => {
    const description = createProgram().description();

    expect(description.length).toBeGreaterThan(0);
    for (const term of ['vulnerability', 'exploit', 'audit', 'scan']) {
      expect(description.toLowerCase()).not.toContain(term);
    }
  });

  it('contains no em dash in its help text', () => {
    expect(createProgram().helpInformation()).not.toContain('—');
  });
});
