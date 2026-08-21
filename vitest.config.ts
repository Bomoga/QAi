import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/**/*.test.ts',
      // The corpus harness computes the false positive rate S8 exists to produce, so it
      // is held to the same standard as the product rather than living in a script.
      'corpus/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'fixtures/*/src/**/*.test.ts',
      'fixtures/*/test/**/*.test.ts',
    ],
    environment: 'node',
    // R9: tests never touch the network, so nothing here should be slow enough
    // to need a raised timeout. A test that hits this limit is doing the wrong thing.
    testTimeout: 10_000,
  },
});
