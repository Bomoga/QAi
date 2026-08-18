/**
 * The progress interface `core` is given, since `core` produces no output itself.
 *
 * Rule R5 forbids `console.*`, `process.stdout`, and `process.exit` anywhere in this
 * package, and 03-CONTRACTS.md lists `Reporter` among the shared runtime types with M7
 * as its owner. This is that type. It is a port: `core` declares what it needs to say,
 * and a surface decides where the words go and what they look like.
 *
 * **Nothing in `core` accepts one yet.** The probe and the two check runners predate this
 * and report no progress at all, so today the only implementation is the CLI's and the
 * only caller is the CLI. Threading it into `probe`, `runAccessChecks`, and
 * `runBehavioralChecks` changes signatures owned by M4 and M5, which is a cross-module
 * change rather than something to slip in here. Declaring the port first is what makes
 * that a mechanical follow-up instead of a design question.
 *
 * **Levels, and what they are for.** A reader watching a run wants to know what is
 * happening, and a reader reading a log afterwards wants to know what went wrong. `step`
 * and `info` serve the first, `warn` and `error` the second. None of them is a verdict:
 * a check that failed is a finding in the RunResult, not a call to `error`, and a surface
 * that inferred a run's outcome from these calls would be reading the wrong thing.
 */
export interface Reporter {
  /** A unit of work has started. Named in the imperative, for example "Probing target". */
  step(message: string): void;
  /** Something worth seeing that is not a problem. */
  info(message: string): void;
  /** Something degraded the run without stopping it, for example an absent capability. */
  warn(message: string): void;
  /** Something failed. Not a check verdict; see the note above. */
  error(message: string): void;
}

/**
 * A reporter that discards everything.
 *
 * The default wherever a caller has nothing to report to, so no code path has to test
 * whether it was given one. A silent run is a legitimate configuration, and an optional
 * reporter threaded through with `?.` would put that question at every call site.
 */
export const silentReporter: Reporter = {
  step: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
