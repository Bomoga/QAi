import { defineConfig } from 'vitest/config';

/**
 * Core needs its own config because the module's Definition of Done runs
 * `pnpm --filter @qai/core test`. Without this, vitest walks up to the root config
 * whose include patterns are written relative to the repository root, matches nothing
 * from inside this package, and exits 0. A Definition of Done that passes by running
 * no tests is worse than one that fails.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
