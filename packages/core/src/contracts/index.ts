/**
 * The three serialized contracts plus Evidence, defined once as Zod schemas with
 * TypeScript types derived by inference.
 *
 * 03-CONTRACTS.md is the specification for everything in this directory, and it says
 * there is no second definition of these shapes anywhere in the repository. That means
 * no hand-written interface mirrors a schema: if you need the type, infer it from the
 * schema, and if you need to change a field, change 03-CONTRACTS.md in the same commit.
 */
export * from './spec.ts';
export * from './observation.ts';
export * from './run-result.ts';
export * from './evidence.ts';
