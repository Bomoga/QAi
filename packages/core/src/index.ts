/**
 * Public API of @qai/core.
 *
 * Everything a surface is allowed to touch is re-exported from here as its owning
 * module lands. Anything reached by a deeper path is private code, and a surface
 * importing it has crossed a boundary the package does not promise to keep.
 *
 * Present: the contracts and spec loading from M1; target configuration, actor
 * sessions, and evidence capture from M2.
 * Pending: checks from M3 and M5, probe and diff from M4, store from M6, emitters
 * from M7.
 */
export * from './contracts/index.ts';
export * from './spec/index.ts';
export * from './target/index.ts';
export * from './evidence/index.ts';
export * from './checks/index.ts';
export * from './probe/index.ts';
