import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  capturePage,
  loadLauncher,
  PLAYWRIGHT_REMEDY,
  type BrowserInstance,
  type BrowserLauncher,
  type BrowserPage,
} from './browser.ts';

/**
 * A fake launcher, so no test here starts a browser or reaches a network, per rule R9.
 * The absent-Playwright path is not faked: this repository genuinely does not have it
 * installed, so `loadLauncher` is exercised against reality.
 */

interface Recorded {
  readonly gotos: string[];
  readonly screenshots: string[];
  readonly headers: (Readonly<Record<string, string>> | undefined)[];
  closed: number;
}

function fakeLauncher(
  text: string,
  recorded: Recorded,
  behavior: { gotoThrows?: string } = {},
): BrowserLauncher {
  const page: BrowserPage = {
    goto(url) {
      recorded.gotos.push(url);
      if (behavior.gotoThrows !== undefined) throw new Error(behavior.gotoThrows);
      return Promise.resolve(undefined);
    },
    innerText() {
      return Promise.resolve(text);
    },
    screenshot(options) {
      recorded.screenshots.push(options.path);
      return Promise.resolve(undefined);
    },
  };

  const browser: BrowserInstance = {
    newContext(options) {
      recorded.headers.push(options?.extraHTTPHeaders);
      return Promise.resolve({ newPage: () => Promise.resolve(page) });
    },
    close() {
      recorded.closed += 1;
      return Promise.resolve(undefined);
    },
  };

  return { launch: () => Promise.resolve(browser) };
}

function recorder(): Recorded {
  return { gotos: [], screenshots: [], headers: [], closed: 0 };
}

describe('when Playwright is not installed', () => {
  it('finds no launcher, rather than throwing', async () => {
    // This project does not depend on Playwright, so this is the real path, not a fake.
    await expect(loadLauncher()).resolves.toBeUndefined();
  });

  it('reports the capability as unavailable and says how to enable it', async () => {
    const result = await capturePage('http://127.0.0.1:3000/invoices');

    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') throw new Error('unreachable');
    expect(result.reason).toContain('Playwright is not installed');
    expect(result.remedy).toBe(PLAYWRIGHT_REMEDY);
    expect(result.remedy).toContain('playwright install chromium');
  });
});

describe('capturing a page', () => {
  it('reports the rendered text of the document', async () => {
    const recorded = recorder();
    const result = await capturePage('http://127.0.0.1:3000/invoices', {
      launcher: fakeLauncher('Invoice INV-1001 total 4200', recorded),
    });

    expect(result.kind).toBe('captured');
    if (result.kind !== 'captured') throw new Error('unreachable');
    expect(result.capture.text).toBe('Invoice INV-1001 total 4200');
    expect(recorded.gotos).toEqual(['http://127.0.0.1:3000/invoices']);
  });

  it('takes no screenshot unless one was asked for', async () => {
    const recorded = recorder();
    const result = await capturePage('http://127.0.0.1:3000/', {
      launcher: fakeLauncher('hello', recorded),
    });

    // A screenshot cannot be redacted, so it is opt in. Rule R8.
    expect(recorded.screenshots).toEqual([]);
    if (result.kind !== 'captured') throw new Error('unreachable');
    expect(result.capture.screenshotPath).toBeUndefined();
  });

  it('takes one where it was told to when asked', async () => {
    const recorded = recorder();
    const result = await capturePage('http://127.0.0.1:3000/', {
      launcher: fakeLauncher('hello', recorded),
      screenshotPath: '.qai/evidence/EV-000001.png',
    });

    expect(recorded.screenshots).toEqual(['.qai/evidence/EV-000001.png']);
    if (result.kind !== 'captured') throw new Error('unreachable');
    expect(result.capture.screenshotPath).toBe('.qai/evidence/EV-000001.png');
  });

  it('carries the actor credential as headers, which is how the page authenticates', async () => {
    const recorded = recorder();
    await capturePage('http://127.0.0.1:3000/', {
      launcher: fakeLauncher('hello', recorded),
      headers: { authorization: 'Bearer token' },
    });

    expect(recorded.headers).toEqual([{ authorization: 'Bearer token' }]);
  });

  it('passes no header block at all when there is no credential', async () => {
    const recorded = recorder();
    await capturePage('http://127.0.0.1:3000/', { launcher: fakeLauncher('hello', recorded) });

    expect(recorded.headers).toEqual([undefined]);
  });

  it('reports a page that would not load as a value, not a throw', async () => {
    const recorded = recorder();
    const result = await capturePage('http://127.0.0.1:3000/', {
      launcher: fakeLauncher('', recorded, { gotoThrows: 'net::ERR_CONNECTION_REFUSED' }),
    });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('ERR_CONNECTION_REFUSED');
  });

  it('closes the browser even when the page failed', async () => {
    const recorded = recorder();
    await capturePage('http://127.0.0.1:3000/', {
      launcher: fakeLauncher('', recorded, { gotoThrows: 'boom' }),
    });

    expect(recorded.closed).toBe(1);
  });

  it('closes the browser after a successful capture', async () => {
    const recorded = recorder();
    await capturePage('http://127.0.0.1:3000/', { launcher: fakeLauncher('hello', recorded) });

    expect(recorded.closed).toBe(1);
  });
});

describe('the selector policy, invariant I6', () => {
  /** Source with comments removed, so the policy is read off the code and not the prose. */
  function codeOf(file: string): string {
    return readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  }

  it('reads the rendered text and never the markup', () => {
    const code = codeOf('./browser.ts');

    // Nothing here may locate by class, tag structure, or generated identifier. The one
    // selector used is `body`, which is the document rather than a piece of its markup.
    for (const forbidden of ['querySelector', 'nth-child', 'getAttribute', 'evaluate(']) {
      expect(code).not.toContain(forbidden);
    }

    expect(code).toContain("innerText('body')");
  });

  it('imports Playwright lazily, never at module top level', () => {
    const code = codeOf('./browser.ts');
    const topLevelImports = code
      .split('\n')
      .filter((line) => line.startsWith('import ') || line.startsWith('export * from'));

    for (const line of topLevelImports) {
      expect(line).not.toContain('playwright');
    }

    expect(code).toContain('await import(');
  });
});
