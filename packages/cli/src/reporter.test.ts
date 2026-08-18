import { describe, expect, it } from 'vitest';

import { createReporter, type Stream } from './reporter.ts';

/**
 * The one rule these tests exist to hold: progress goes to stderr.
 *
 * Stdout carries the report and nothing else, so `qai check --format json | jq` has to
 * work. A single progress line on stdout breaks every pipe a user builds, and it breaks
 * it silently, because the JSON is still in there somewhere.
 */
function capture(): { stream: Stream; written: string[] } {
  const written: string[] = [];
  return { stream: { write: (chunk: string) => void written.push(chunk) }, written };
}

describe('the CLI reporter', () => {
  it('writes every level to stderr and nothing at all to stdout', () => {
    const out = capture();
    const err = capture();
    const reporter = createReporter({ stdout: out.stream, stderr: err.stream, tty: false });

    reporter.step('Probing target');
    reporter.info('4 endpoints observed');
    reporter.warn('Playwright is not installed');
    reporter.error('The target refused the connection');

    expect(out.written).toStrictEqual([]);
    expect(err.written).toHaveLength(4);
  });

  it('carries the message text through at every level', () => {
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: false,
    });

    reporter.step('Probing target');
    reporter.warn('Playwright is not installed');

    const all = err.written.join('');
    expect(all).toContain('Probing target');
    expect(all).toContain('Playwright is not installed');
  });

  it('labels a warning and an error so a log reader can tell them apart', () => {
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: false,
    });

    reporter.info('plain');
    reporter.warn('degraded');
    reporter.error('broken');

    expect(err.written[1]).toContain('warning');
    expect(err.written[2]).toContain('error');
    expect(err.written[0]).not.toContain('warning');
  });

  it('ends every line, so a CI log does not run two messages together', () => {
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: false,
    });

    reporter.step('one');
    reporter.step('two');

    for (const chunk of err.written) expect(chunk.endsWith('\n')).toBe(true);
  });

  it('emits no escape codes when the destination is not a terminal', () => {
    // What a CI log needs. Whether the stream is a TTY is passed in rather than sniffed,
    // so a test states the case instead of depending on how the suite was launched.
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: false,
    });

    reporter.step('Probing target');
    reporter.error('broken');

    expect(err.written.join('')).not.toContain('[');
  });

  it('emits escape codes when the destination is a terminal', () => {
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: true,
    });

    reporter.error('broken');

    expect(err.written.join('')).toContain('[');
  });

  it('stays plain on a terminal when color is turned off', () => {
    // `--no-color` has to win over the terminal, since that is the whole point of asking.
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: true,
      color: false,
    });

    reporter.error('broken');

    expect(err.written.join('')).not.toContain('[');
  });

  it('says the same words with color as without', () => {
    const plain = capture();
    const colored = capture();
    createReporter({ stdout: capture().stream, stderr: plain.stream, tty: false }).warn('careful');
    createReporter({ stdout: capture().stream, stderr: colored.stream, tty: true }).warn('careful');

    // eslint-disable-next-line no-control-regex
    const stripped = colored.written.join('').replace(/\[[0-9;]*m/g, '');
    expect(stripped).toBe(plain.written.join(''));
  });

  it('contains no em dash', () => {
    const err = capture();
    const reporter = createReporter({
      stdout: capture().stream,
      stderr: err.stream,
      tty: false,
    });

    reporter.step('Probing target');
    reporter.warn('degraded');

    expect(err.written.join('')).not.toContain('—');
  });
});
