/**
 * The browser side of fuzzy criteria, kept as thin as the module asks for.
 *
 * Playwright is an optional peer dependency and is imported lazily, inside the function
 * that needs it, never at module top level. A repository without it installed must load
 * this file, run every deterministic check, and finish with a zero exit code; the only
 * consequence of its absence is that fuzzy criteria report `unverified` with a reason and
 * a line saying how to enable them.
 *
 * **Selector policy, invariant I6, honored by construction.** Nothing here reads a CSS
 * class, a tag structure, an nth-child position, or a generated identifier. What is
 * captured is the accessibility tree: roles and accessible names, which is what a person
 * using the page perceives and what survives a regeneration that preserves behavior. A
 * page rebuilt with different markup and the same semantics produces the same capture.
 *
 * **Screenshots are off by default.** The module says to capture one, and a screenshot
 * cannot be redacted the way a JSON body can: a field marked `sensitive: true` in the
 * spec is plainly readable in an image, and rule R8 says never write an unredacted
 * response to disk. So the image is captured only when a caller asks for it, and the
 * accessible text, which does go through redaction, is the default evidence.
 */

/** What this module uses from Playwright, and nothing more. */
export interface BrowserPage {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  innerText(selector: string): Promise<string>;
  screenshot(options: { path: string }): Promise<unknown>;
}

export interface BrowserContext {
  newPage(): Promise<BrowserPage>;
}

export interface BrowserInstance {
  newContext(options?: {
    extraHTTPHeaders?: Readonly<Record<string, string>>;
  }): Promise<BrowserContext>;
  close(): Promise<unknown>;
}

export interface BrowserLauncher {
  launch(options?: { headless?: boolean }): Promise<BrowserInstance>;
}

export interface PageCapture {
  /** Accessible text, from the rendered page. Redacted by the caller before storage. */
  readonly text: string;
  /** Filesystem path of the screenshot, when one was asked for and taken. */
  readonly screenshotPath?: string;
}

export type CaptureResult =
  | { readonly kind: 'captured'; readonly capture: PageCapture }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly remedy: string }
  | { readonly kind: 'failed'; readonly reason: string };

export const PLAYWRIGHT_REMEDY =
  'Install the optional dependency to enable fuzzy criteria: pnpm add -D playwright && pnpm exec playwright install chromium';

/**
 * Loads Playwright if it is there.
 *
 * The specifier is held in a variable so TypeScript does not try to resolve a module the
 * project does not depend on, and the failure to import is a value rather than a throw.
 * An optional dependency that crashes a run when absent is not optional.
 */
export async function loadLauncher(): Promise<BrowserLauncher | undefined> {
  const specifier = 'playwright';

  try {
    const loaded: unknown = await import(/* @vite-ignore */ specifier);
    if (typeof loaded !== 'object' || loaded === null) return undefined;

    const chromium = (loaded as { chromium?: unknown }).chromium;
    if (typeof chromium !== 'object' || chromium === null) return undefined;
    if (typeof (chromium as { launch?: unknown }).launch !== 'function') return undefined;

    return chromium as BrowserLauncher;
  } catch {
    return undefined;
  }
}

export interface PageCaptureOptions {
  /** Headers the page is loaded with, which is how an actor's credential reaches it. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Absent means no screenshot, which is the default and the safe one. */
  readonly screenshotPath?: string;
  readonly timeoutMs?: number;
  /** Injected for tests, so nothing here launches a real browser under vitest. */
  readonly launcher?: BrowserLauncher;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Loads a page and reports what is on it.
 *
 * Every failure is a returned value: a missing browser, a page that would not load, a
 * timeout. None of them throws, because a fuzzy criterion that cannot be assessed is
 * `inconclusive` and a run that aborts on a missing optional dependency is a run that
 * reports nothing about the checks that would have passed.
 */
export async function capturePage(
  url: string,
  options: PageCaptureOptions = {},
): Promise<CaptureResult> {
  const launcher = options.launcher ?? (await loadLauncher());

  if (launcher === undefined) {
    return {
      kind: 'unavailable',
      reason: 'Playwright is not installed, so the page was not opened',
      remedy: PLAYWRIGHT_REMEDY,
    };
  }

  let browser: BrowserInstance | undefined;

  try {
    browser = await launcher.launch({ headless: true });
    const context = await browser.newContext(
      options.headers === undefined ? {} : { extraHTTPHeaders: options.headers },
    );

    const page = await context.newPage();
    await page.goto(url, { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });

    // The rendered text of the document, not its markup. No class, tag, or position is
    // read, which is invariant I6 holding by construction rather than by review.
    const text = await page.innerText('body');

    const screenshotPath = options.screenshotPath;
    if (screenshotPath !== undefined) {
      await page.screenshot({ path: screenshotPath });
    }

    return {
      kind: 'captured',
      capture: { text, ...(screenshotPath === undefined ? {} : { screenshotPath }) },
    };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'the page could not be opened';
    return { kind: 'failed', reason };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
