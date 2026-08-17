import type { CheckVerdict, RequirementVerdict } from '../../contracts/index.ts';

/**
 * The model boundary, declared by the side that consumes it.
 *
 * Invariant I1 in a type. A judge answers `satisfied`, `not-satisfied`, or `uncertain`
 * with one sentence of reasoning, and that is the entire vocabulary available to it.
 * There is no value a model can return from here that is a `Verdict`, so no amount of
 * prompt injection, hallucination, or future refactoring inside `llm/` can produce a
 * `fail`. The mapping from these three answers to a verdict is M5.6, and it lives on the
 * deterministic side of the boundary where a model cannot reach it.
 *
 * **Why the interface is here rather than in `llm/`.** The module's task list says to
 * implement `Judge` in `llm/`, and rule R1's lint enforcement forbids anything under
 * `checks/` importing `llm/` by path, with `allowTypeImports: false`. The fuzzy runner is
 * a check and needs this type, so a `Judge` declared in `llm/` would be unimportable by
 * its only consumer. Declaring the port beside the consumer and implementing it in `llm/`
 * keeps both rules intact and weakens neither. Recorded in the module's Open questions.
 */

/**
 * What a model may say. Deliberately not the verdict vocabulary: these words do not
 * overlap with `pass`, `fail`, `inconclusive`, `verified`, `failed`, or `unverified`, and
 * the assertions below make that a compile error rather than a convention.
 */
export type JudgeAnswer = 'satisfied' | 'not-satisfied' | 'uncertain';

export interface JudgeQuestion {
  readonly criterionId: string;
  /** The criterion, as authored. A model is never shown the expected verdict. */
  readonly given: string;
  readonly when: string;
  readonly then: string;
  /** Accessible text of the page, redacted before it gets here. */
  readonly pageText: string;
  /** Evidence id of the screenshot, never the image bytes. */
  readonly screenshotRef?: string;
}

export interface JudgeResponse {
  readonly answer: JudgeAnswer;
  /** One sentence. Always surfaced as model assisted, never as a finding on its own. */
  readonly reason: string;
}

export interface Judge {
  /** Named for what it produces: an opinion, not a decision. */
  judge(question: JudgeQuestion): Promise<JudgeResponse>;
}

/** Fails to compile if `T` is anything but `never`. */
type AssertNever<T extends never> = T;

type AnyVerdict = CheckVerdict | RequirementVerdict;

/**
 * The proof. If someone adds `'pass'` or `'failed'` to `JudgeAnswer`, or widens it to
 * `string`, this stops compiling and the build fails. Invariant I1 is the product's
 * trust argument, and a boundary that lives only in a document is one a future refactor
 * walks through without noticing.
 */
export type NoJudgeAnswerIsAVerdict = AssertNever<Extract<JudgeAnswer, AnyVerdict>>;

export type NoJudgeResponseIsAVerdict = AssertNever<Extract<JudgeResponse, AnyVerdict>>;
