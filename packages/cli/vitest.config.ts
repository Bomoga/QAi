import { defineConfig } from 'vitest/config';

/**
 * The CLI needs its own config because the module's Definition of Done runs
 * `pnpm --filter @qai/cli test`. Without this, vitest walks up to the root config whose
 * include patterns are written relative to the repository root, matches nothing from
 * inside this package, and exits 0. A Definition of Done that passes by running no tests
 * is worse than one that fails, which is the M1.2 trap arriving exactly where that note
 * predicted it would.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
