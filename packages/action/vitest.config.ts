import { defineConfig } from 'vitest/config';

/**
 * The action package needs its own config for the reason M1.2 recorded and M8.1 hit
 * again: without one, vitest walks up to the root config whose include patterns are
 * relative to the repository root, matches nothing from inside this package, and exits 0.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
