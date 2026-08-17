/**
 * The model layer, and the only directory in this package permitted to import a model
 * client. Rule R1, enforced by lint and asserted by `boundary.test.ts`.
 *
 * Everything here returns a suggestion, a summary, an extraction, or an opinion. Nothing
 * here returns a verdict, and nothing here is reachable from `checks/`, which is what
 * makes invariant I1 a property of the build rather than a habit.
 *
 * Present: the judge implementations behind the M5 boundary.
 * Pending: a model-backed judge, which needs a dependency this project has not approved,
 * and prose extraction from M9.
 */
export * from './judge.ts';
