import { describe, expect, it } from 'vitest';

import config, {
  LLM_BOUNDARY_DIR,
  LLM_BOUNDARY_RULE,
  LLM_CLIENT_PATTERNS,
} from '../eslint.config.js';

/**
 * Hard rule R1 requires a test asserting the model boundary rule is configured.
 * The boundary is structural, so its enforcement has to be structural too: a config
 * edit that drops the rule fails here rather than being noticed during review.
 */
describe('lint enforces the model boundary', () => {
  const blocks = config.filter((block) => block.rules?.[LLM_BOUNDARY_RULE] !== undefined);

  it('restricts model client imports for every TypeScript file', () => {
    const restricting = blocks.filter((block) => block.rules?.[LLM_BOUNDARY_RULE] !== 'off');
    expect(restricting).toHaveLength(1);

    const block = restricting[0];
    expect(block?.files).toContain('**/*.ts');

    const setting = block?.rules?.[LLM_BOUNDARY_RULE];
    expect(Array.isArray(setting)).toBe(true);
    const [severity, options] = setting as [string, { patterns: { group: string[] }[] }];
    expect(severity).toBe('error');
    expect(options.patterns[0]?.group).toEqual(LLM_CLIENT_PATTERNS);
  });

  it('exempts only the llm directory', () => {
    const exempt = blocks.filter((block) => block.rules?.[LLM_BOUNDARY_RULE] === 'off');
    expect(exempt).toHaveLength(1);
    expect(exempt[0]?.files).toEqual([`${LLM_BOUNDARY_DIR}**/*.ts`]);
  });

  it('names the clients a verdict path must not reach for', () => {
    expect(LLM_CLIENT_PATTERNS).toContain('@anthropic-ai/*');
    expect(LLM_CLIENT_PATTERNS).toContain('openai');
  });
});
