import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/**/*.test.ts',
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
