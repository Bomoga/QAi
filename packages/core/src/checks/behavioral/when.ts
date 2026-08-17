import type { HttpMethod } from '../../target/request.ts';

/**
 * The request vocabulary for `when` clauses.
 *
 * Added at M5.9 by decision, because `then` had a vocabulary and `when` had none: an
 * access rule carries actor, action, and resource as fields, while a criterion states
 * `when` in prose, so nothing could turn a criterion into a request.
 *
 *   actor owner reads Invoice
 *   actor owner reads Invoice INV-9999
 *   actor outsider lists Invoice
 *   actor owner creates Invoice
 *   actor outsider updates Invoice INV-1001
 *   actor admin deletes Invoice INV-1001
 *   actor anonymous requests /health
 *
 * The same discipline as the `then` parser, for the same reason: canonical forms, purely
 * mechanical tolerance, and a refusal rather than a guess. "the owner updates the
 * invoice" is prose about a request, not a request, and a parser that turned it into a
 * PATCH would be inventing the target's shape.
 *
 * The instance id is optional on a read so a spec need not carry target data, and
 * available so a criterion about a record that does not exist can name one.
 */

export type WhenAction = 'read' | 'list' | 'create' | 'update' | 'delete' | 'path';

export interface WhenRequest {
  readonly actorId: string;
  readonly action: WhenAction;
  /** Absent for the literal path form, which belongs to no entity. */
  readonly entity?: string;
  readonly instanceId?: string;
  /** Present only for the literal path form. */
  readonly path?: string;
  readonly mutates: boolean;
}

export interface WhenParsedRequest extends WhenRequest {
  readonly kind: 'request';
}

export interface WhenUnsupported {
  readonly kind: 'unsupported';
  readonly reason: string;
}

/**
 * Both members are named types rather than an intersection spelled inline. Only a
 * predicate naming a member lets TypeScript remove it on the negative branch, and the
 * assertion parser was written the other way first and rejected a `.reason` access that
 * could only be reached with an unsupported result.
 */
export type ParsedWhen = WhenParsedRequest | WhenUnsupported;

/** Read and list are safe. The rest mutate and run behind the disposability gate. */
export const METHOD_FOR_WHEN: Record<WhenAction, HttpMethod> = {
  read: 'GET',
  list: 'GET',
  create: 'POST',
  update: 'PATCH',
  delete: 'DELETE',
  path: 'GET',
};

const MUTATING: ReadonlySet<WhenAction> = new Set(['create', 'update', 'delete']);

const IDENTIFIER = '[A-Za-z_][\\w-]*';

const ENTITY_FORM = new RegExp(
  `^actor\\s+(${IDENTIFIER})\\s+(reads|lists|creates|updates|deletes)\\s+(${IDENTIFIER})(?:\\s+(\\S+))?$`,
  'u',
);

const PATH_FORM = new RegExp(`^actor\\s+(${IDENTIFIER})\\s+requests\\s+(/\\S*)$`, 'u');

const ACTION_FOR_VERB: Record<string, WhenAction> = {
  reads: 'read',
  lists: 'list',
  creates: 'create',
  updates: 'update',
  deletes: 'delete',
};

/** Actions that name one record, and so require an instance to act on. */
const INSTANCE_ACTIONS: ReadonlySet<WhenAction> = new Set(['read', 'update', 'delete']);

export const WHEN_FORMS: readonly string[] = [
  'actor <id> reads <Entity>, optionally followed by an instance id',
  'actor <id> lists <Entity>',
  'actor <id> creates <Entity>',
  'actor <id> updates <Entity> <instanceId>',
  'actor <id> deletes <Entity> <instanceId>',
  'actor <id> requests <path>',
];

export function parseWhen(text: string): ParsedWhen {
  const trimmed = text.trim().replace(/\.$/u, '').replace(/\s+/gu, ' ');

  const path = PATH_FORM.exec(trimmed);
  if (path?.[1] !== undefined && path[2] !== undefined) {
    return { kind: 'request', actorId: path[1], action: 'path', path: path[2], mutates: false };
  }

  const entity = ENTITY_FORM.exec(trimmed);
  if (entity?.[1] === undefined || entity[2] === undefined || entity[3] === undefined) {
    return {
      kind: 'unsupported',
      reason: 'it is not one of the request forms the vocabulary defines',
    };
  }

  const action = ACTION_FOR_VERB[entity[2]];
  if (action === undefined) {
    return { kind: 'unsupported', reason: `${entity[2]} is not a request form` };
  }

  const instanceId = entity[4];

  // Update and delete name one record, and the tool refuses to pick which. Read may
  // leave it out, since a read of any instance is still a read.
  if (instanceId === undefined && INSTANCE_ACTIONS.has(action) && action !== 'read') {
    return {
      kind: 'unsupported',
      reason: `${entity[2]} acts on one record and no instance id was given`,
    };
  }

  return {
    kind: 'request',
    actorId: entity[1],
    action,
    entity: entity[3],
    ...(instanceId === undefined ? {} : { instanceId }),
    mutates: MUTATING.has(action),
  };
}

export function isRequest(parsed: ParsedWhen): parsed is WhenParsedRequest {
  return parsed.kind === 'request';
}
