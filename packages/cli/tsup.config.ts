import { defineConfig } from 'tsup';

/**
 * The CLI is bundled, and it is the only package here that is.
 *
 * **Because a GitHub Action is checked out and never built.** The action runs
 * `packages/cli/bin/specgate.js`, which imports this output. Unbundled, that output carries
 * bare imports for `commander`, `zod`, `yaml`, and the rest, so a consumer would need a
 * `node_modules` tree beside it: 1.3 MB of build output standing on 511 MB of
 * dependencies. Bundled, the file runs on its own.
 *
 * `better-sqlite3` is the one exception and cannot be anything else. It is a compiled
 * binary rather than JavaScript, so no bundler can inline it. It stays external and
 * `store/schema.ts` resolves it with `createRequire` at the moment the store is opened,
 * which turns its absence into the warning `specgate check` already says it should be: the
 * report is the product, and a run that produced one should not die because it could not
 * also write a history file.
 *
 * The cost is that a stale bundle is invisible in a diff. Whatever release mechanism ends
 * up committing this has to rebuild first, every time.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
  /** Everything that is JavaScript goes in the file. */
  noExternal: [/.*/],
  /** Everything that is not. */
  external: ['better-sqlite3'],
  banner: {
    /**
     * Gives the bundle a real `require`, which several of its dependencies need.
     *
     * The output is ESM and some of what it inlines is CommonJS. `fast-glob` reaches for
     * `require('os')` at load, and esbuild cannot resolve a call it only sees at runtime,
     * so it substitutes a stub that throws `Dynamic require of "os" is not supported`.
     * The bundle then died on startup, which the standalone rehearsal caught and a build
     * that only ever ran beside `node_modules` never would have.
     *
     * esbuild's stub checks for a `require` in scope before throwing, so defining one
     * here is enough for it to delegate instead.
     */
    js: [
      "import { createRequire as __specgateCreateRequire } from 'node:module';",
      'const require = __specgateCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
