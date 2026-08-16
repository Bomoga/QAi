import type { Spec } from '../contracts/index.ts';

/**
 * Redaction, applied at capture, before anything reaches disk. Rule R8.
 *
 * The order is fixed and stated in modules/M2-target.md: authorization and cookie
 * headers always, then configured patterns, then any field the Spec marks
 * `sensitive: true`, matched by name at any depth.
 *
 * Every alteration is recorded in `redactions`. That list is the substance of the
 * feature, not bookkeeping: a reader who cannot tell redaction from absence will read
 * a missing field as evidence that the field was not returned, which is the opposite
 * of what happened.
 */

export const REDACTED = '[redacted]';

/** Always removed, whatever the spec or config say. */
export const ALWAYS_REDACTED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
];

export interface RedactionRules {
  /** Field names from the spec marked sensitive, lowercased. */
  readonly sensitiveFields: ReadonlySet<string>;
  /** Extra patterns from the config, already compiled. */
  readonly extraPatterns: readonly RegExp[];
}

export interface RedactionResult<T> {
  readonly value: T;
  /** Dotted paths that were altered, in the order they were found. */
  readonly redactions: readonly string[];
}

/**
 * Compiles config patterns. An invalid pattern is dropped rather than thrown, and the
 * caller is told, because a bad regex in a config file should not take down a run that
 * would otherwise produce findings.
 */
export function compilePatterns(patterns: readonly string[]): {
  compiled: RegExp[];
  invalid: string[];
} {
  const compiled: RegExp[] = [];
  const invalid: string[] = [];

  for (const pattern of patterns) {
    // YAML configs commonly carry the inline `(?i)` flag, which JavaScript does not
    // support. Translating it is friendlier than rejecting a pattern that reads fine.
    const caseInsensitive = pattern.startsWith('(?i)');
    const source = caseInsensitive ? pattern.slice(4) : pattern;
    try {
      compiled.push(new RegExp(source, caseInsensitive ? 'iu' : 'u'));
    } catch {
      invalid.push(pattern);
    }
  }

  return { compiled, invalid };
}

/** Every field name any entity in the spec marks sensitive, lowercased. */
export function sensitiveFieldsOf(spec: Spec): Set<string> {
  const names = new Set<string>();
  for (const entity of spec.entities) {
    for (const field of entity.fields) {
      if (field.sensitive === true) names.add(field.name.toLowerCase());
    }
  }
  return names;
}

export function rulesFor(spec: Spec, extraPatterns: readonly string[] = []): RedactionRules {
  return {
    sensitiveFields: sensitiveFieldsOf(spec),
    extraPatterns: compilePatterns(extraPatterns).compiled,
  };
}

function keyIsSensitive(key: string, rules: RedactionRules): boolean {
  const lower = key.toLowerCase();
  if (rules.sensitiveFields.has(lower)) return true;
  return rules.extraPatterns.some((pattern) => pattern.test(key));
}

export function redactHeaders(
  headers: Readonly<Record<string, string>>,
  rules: RedactionRules,
  pathPrefix: string,
): RedactionResult<Record<string, string>> {
  const value: Record<string, string> = {};
  const redactions: string[] = [];

  for (const [key, headerValue] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (ALWAYS_REDACTED_HEADERS.includes(lower) || keyIsSensitive(key, rules)) {
      value[key] = REDACTED;
      redactions.push(`${pathPrefix}.${key}`);
      continue;
    }
    value[key] = headerValue;
  }

  return { value, redactions };
}

/**
 * Walks a parsed JSON body replacing sensitive values. Arrays keep their indices in
 * the recorded path so a reader can find the element that was altered.
 */
function redactValue(
  input: unknown,
  rules: RedactionRules,
  path: string,
  redactions: string[],
): unknown {
  if (Array.isArray(input)) {
    return input.map((item, index) => redactValue(item, rules, `${path}[${index}]`, redactions));
  }

  if (typeof input === 'object' && input !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (keyIsSensitive(key, rules)) {
        output[key] = REDACTED;
        redactions.push(childPath);
        continue;
      }
      output[key] = redactValue(child, rules, childPath, redactions);
    }
    return output;
  }

  return input;
}

/**
 * Redacts a response body. A body that is not JSON is passed through unchanged: this
 * function does not guess at structure it cannot parse, and a caller that needs a
 * guarantee over opaque bodies should not be storing them.
 */
export function redactBody(
  body: string,
  rules: RedactionRules,
  pathPrefix: string,
): RedactionResult<string> {
  if (body === '') return { value: body, redactions: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { value: body, redactions: [] };
  }

  const redactions: string[] = [];
  const redacted = redactValue(parsed, rules, pathPrefix, redactions);

  if (redactions.length === 0) return { value: body, redactions: [] };
  return { value: JSON.stringify(redacted), redactions };
}
