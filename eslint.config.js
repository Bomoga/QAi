import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Invariant I1, hard rule R1: only `packages/core/src/llm/` may import a model client.
 * These constants are exported so a test can assert the rule stays configured, rather
 * than the boundary quietly disappearing in a future config edit.
 */
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

export const LLM_BOUNDARY_RULE = '@typescript-eslint/no-restricted-imports';

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
      [LLM_BOUNDARY_RULE]: [
        'error',
        {
          patterns: [
            {
              group: LLM_CLIENT_PATTERNS,
              message: LLM_BOUNDARY_MESSAGE,
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
  {
    files: [`${LLM_BOUNDARY_DIR}**/*.ts`],
    rules: {
      [LLM_BOUNDARY_RULE]: 'off',
    },
  },
);
