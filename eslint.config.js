import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Two import boundaries are enforced here, and they overlap in `packages/core`, so
 * they are composed rather than layered. `no-restricted-imports` is a single rule
 * key: a later config block that sets it replaces the earlier setting outright.
 * Every block below therefore restates every group that applies to its scope.
 */

export const LLM_BOUNDARY_RULE = '@typescript-eslint/no-restricted-imports';

/** Invariant I1, hard rule R1: only this directory may import a model client. */
export const LLM_BOUNDARY_DIR = 'packages/core/src/llm/';

export const LLM_CLIENT_PATTERNS = [
  '@anthropic-ai/*',
  'openai',
  'openai/*',
  '@google/genai',
  '@google/generative-ai',
  '@mistralai/*',
  '@aws-sdk/client-bedrock-runtime',
  'cohere-ai',
  'replicate',
  'ollama',
  'ai',
  '@ai-sdk/*',
  'langchain',
  'langchain/*',
  '@langchain/*',
];

export const LLM_BOUNDARY_MESSAGE =
  'Invariant I1: model clients may only be imported from ' +
  LLM_BOUNDARY_DIR +
  '. Everywhere else, a verdict must be produced by deterministic assertion.';

/** 02-ARCHITECTURE.md: core depends on nothing here, cli depends on core, action depends on cli. */
export const CORE_FORBIDDEN_PATTERNS = ['@qai/cli', '@qai/cli/*', '@qai/action', '@qai/action/*'];
export const CLI_FORBIDDEN_PATTERNS = ['@qai/action', '@qai/action/*'];

export const CORE_DIRECTION_MESSAGE =
  'core imports nothing from cli or action. If core needs to tell the user something, it returns data.';

export const CLI_DIRECTION_MESSAGE =
  'cli does not import action. action is the outer shell and depends on cli, not the reverse.';

const llmGroup = { group: LLM_CLIENT_PATTERNS, message: LLM_BOUNDARY_MESSAGE };
const coreDirectionGroup = { group: CORE_FORBIDDEN_PATTERNS, message: CORE_DIRECTION_MESSAGE };
const cliDirectionGroup = { group: CLI_FORBIDDEN_PATTERNS, message: CLI_DIRECTION_MESSAGE };

/** @param {{ group: string[], message: string }[]} groups */
function restrict(groups) {
  return ['error', { patterns: groups.map((entry) => ({ ...entry, allowTypeImports: false })) }];
}

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '.qai/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      [LLM_BOUNDARY_RULE]: restrict([llmGroup]),
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      [LLM_BOUNDARY_RULE]: restrict([llmGroup, coreDirectionGroup]),
    },
  },
  {
    // The one place a model client is allowed. The dependency direction still holds.
    files: [`${LLM_BOUNDARY_DIR}**/*.ts`],
    rules: {
      [LLM_BOUNDARY_RULE]: restrict([coreDirectionGroup]),
    },
  },
  {
    files: ['packages/cli/**/*.ts'],
    rules: {
      [LLM_BOUNDARY_RULE]: restrict([llmGroup, cliDirectionGroup]),
    },
  },
);
