/**
 * Condition tokenizer and parser.
 *
 * Conditions are parsed, never evaluated. There is no `eval` here, no `new Function`,
 * and no path by which a spec string becomes executable code. Evaluation of the AST
 * belongs to M3 for access rules and M5 for behavioral criteria.
 *
 * The grammar, from modules/M1-spec.md:
 *
 *   condition   := comparison (("and" | "&&") comparison)*
 *   comparison  := operand op operand
 *   op          := "==" | "!=" | "in" | "not in"
 *   operand     := actorRef | entityRef | literal
 *   actorRef    := "actor." IDENT
 *   entityRef   := IDENT "." IDENT
 *   literal     := STRING | NUMBER | "null" | "[" literal ("," literal)* "]"
 *
 * Anything outside it is an error naming the offending substring. It is never silently
 * ignored: a skipped access rule reads as coverage that was never performed, which is
 * worse than no coverage at all because it is invisible.
 */

export type ComparisonOperator = '==' | '!=' | 'in' | 'not in';

export interface ActorRefNode {
  readonly kind: 'actorRef';
  readonly property: string;
}

export interface EntityRefNode {
  readonly kind: 'entityRef';
  readonly entity: string;
  readonly property: string;
}

export interface LiteralNode {
  readonly kind: 'literal';
  readonly value: string | number | null;
}

export interface ListNode {
  readonly kind: 'list';
  readonly items: readonly LiteralNode[];
}

export type OperandNode = ActorRefNode | EntityRefNode | LiteralNode | ListNode;

export interface ComparisonNode {
  readonly kind: 'comparison';
  readonly operator: ComparisonOperator;
  readonly left: OperandNode;
  readonly right: OperandNode;
}

/** A single comparison parses to a conjunction of one, so consumers see one shape. */
export interface ConditionAst {
  readonly kind: 'and';
  readonly comparisons: readonly ComparisonNode[];
}

export interface ConditionParseError {
  readonly kind: 'error';
  /** Written for an engineer reading a load diagnostic, not for a parser generator. */
  readonly message: string;
  /** The offending substring, quoted back so the author can find it in the file. */
  readonly offendingText: string;
  /** Zero-based offset into the input, for callers that can point at a column. */
  readonly offset: number;
}

export function isConditionParseError(
  result: ConditionAst | ConditionParseError,
): result is ConditionParseError {
  return result.kind === 'error';
}

type TokenType =
  'ident' | 'string' | 'number' | 'dot' | 'comma' | 'lbracket' | 'rbracket' | 'operator' | 'end';

interface Token {
  readonly type: TokenType;
  readonly text: string;
  readonly offset: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

class TokenizeFailure extends Error {
  constructor(
    override readonly message: string,
    readonly offendingText: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === undefined) break;

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }

    if (char === '.') {
      tokens.push({ type: 'dot', text: '.', offset: index });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'comma', text: ',', offset: index });
      index += 1;
      continue;
    }

    if (char === '[') {
      tokens.push({ type: 'lbracket', text: '[', offset: index });
      index += 1;
      continue;
    }

    if (char === ']') {
      tokens.push({ type: 'rbracket', text: ']', offset: index });
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const start = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < input.length) {
        const next = input[index];
        if (next === char) {
          closed = true;
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      if (!closed) {
        throw new TokenizeFailure('unterminated string', input.slice(start), start);
      }
      tokens.push({ type: 'string', text: value, offset: start });
      continue;
    }

    if (DIGIT.test(char) || (char === '-' && DIGIT.test(input[index + 1] ?? ''))) {
      const start = index;
      index += 1;
      while (index < input.length) {
        const next = input[index] ?? '';
        if (!DIGIT.test(next) && next !== '.') break;
        index += 1;
      }
      tokens.push({ type: 'number', text: input.slice(start, index), offset: start });
      continue;
    }

    if (char === '=' || char === '!' || char === '&') {
      const pair = input.slice(index, index + 2);
      if (pair === '==' || pair === '!=' || pair === '&&') {
        tokens.push({ type: 'operator', text: pair, offset: index });
        index += 2;
        continue;
      }
      throw new TokenizeFailure(`unsupported operator "${char}"`, char, index);
    }

    if (IDENT_START.test(char)) {
      const start = index;
      while (index < input.length && IDENT_PART.test(input[index] ?? '')) {
        index += 1;
      }
      tokens.push({ type: 'ident', text: input.slice(start, index), offset: start });
      continue;
    }

    throw new TokenizeFailure(`unexpected character "${char}"`, char, index);
  }

  tokens.push({ type: 'end', text: '', offset: input.length });
  return tokens;
}

class ParseFailure extends Error {
  constructor(
    override readonly message: string,
    readonly offendingText: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
  ) {}

  parseCondition(): ConditionAst {
    const comparisons: ComparisonNode[] = [this.parseComparison()];

    while (this.isConjunction()) {
      this.advance();
      comparisons.push(this.parseComparison());
    }

    const token = this.peek();
    if (token.type !== 'end') {
      throw new ParseFailure(`expected "and" or end of condition`, token.text, token.offset);
    }

    return { kind: 'and', comparisons };
  }

  private isConjunction(): boolean {
    const token = this.peek();
    if (token.type === 'operator' && token.text === '&&') return true;
    return token.type === 'ident' && token.text === 'and';
  }

  private parseComparison(): ComparisonNode {
    const left = this.parseOperand();
    const operator = this.parseOperator();
    const right = this.parseOperand();
    return { kind: 'comparison', operator, left, right };
  }

  private parseOperator(): ComparisonOperator {
    const token = this.peek();

    if (token.type === 'operator' && (token.text === '==' || token.text === '!=')) {
      this.advance();
      return token.text;
    }

    if (token.type === 'ident' && token.text === 'in') {
      this.advance();
      return 'in';
    }

    if (token.type === 'ident' && token.text === 'not') {
      const next = this.tokens[this.position + 1];
      if (next?.type === 'ident' && next.text === 'in') {
        this.advance();
        this.advance();
        return 'not in';
      }
      throw new ParseFailure('expected "in" after "not"', this.textFrom(token), token.offset);
    }

    throw new ParseFailure(
      'expected one of ==, !=, in, not in',
      token.type === 'end' ? this.source : token.text,
      token.offset,
    );
  }

  private parseOperand(): OperandNode {
    const token = this.peek();

    if (token.type === 'string') {
      this.advance();
      return { kind: 'literal', value: token.text };
    }

    if (token.type === 'number') {
      this.advance();
      return { kind: 'literal', value: this.toNumber(token) };
    }

    if (token.type === 'lbracket') {
      return this.parseList();
    }

    if (token.type === 'ident') {
      if (token.text === 'null') {
        this.advance();
        return { kind: 'literal', value: null };
      }
      return this.parseReference();
    }

    throw new ParseFailure(
      'expected a reference or a literal',
      token.type === 'end' ? this.source : token.text,
      token.offset,
    );
  }

  /**
   * Both `actor.x` and `Entity.x` are two identifiers separated by a dot. A bare
   * identifier is rejected rather than treated as a string, since `org_id == admin`
   * almost certainly means a reference the author mistyped, and guessing which would
   * turn an authoring mistake into a silently wrong check.
   */
  private parseReference(): ActorRefNode | EntityRefNode {
    const head = this.expect('ident', 'expected a reference');

    const dot = this.peek();
    if (dot.type !== 'dot') {
      throw new ParseFailure(
        `bare identifier "${head.text}", expected actor.<field> or <Entity>.<field>`,
        head.text,
        head.offset,
      );
    }
    this.advance();

    const property = this.expect('ident', 'expected a property name after "."');

    if (head.text === 'actor') {
      return { kind: 'actorRef', property: property.text };
    }
    return { kind: 'entityRef', entity: head.text, property: property.text };
  }

  private parseList(): ListNode {
    const open = this.expect('lbracket', 'expected "["');
    const items: LiteralNode[] = [];

    if (this.peek().type === 'rbracket') {
      this.advance();
      return { kind: 'list', items };
    }

    for (;;) {
      items.push(this.parseListLiteral());

      const next = this.peek();
      if (next.type === 'comma') {
        this.advance();
        continue;
      }
      if (next.type === 'rbracket') {
        this.advance();
        return { kind: 'list', items };
      }
      throw new ParseFailure(
        'expected "," or "]" in list',
        next.type === 'end' ? this.source.slice(open.offset) : next.text,
        next.offset,
      );
    }
  }

  /** Lists hold literals only. A nested list or a reference inside one is out of grammar. */
  private parseListLiteral(): LiteralNode {
    const token = this.peek();

    if (token.type === 'string') {
      this.advance();
      return { kind: 'literal', value: token.text };
    }
    if (token.type === 'number') {
      this.advance();
      return { kind: 'literal', value: this.toNumber(token) };
    }
    if (token.type === 'ident' && token.text === 'null') {
      this.advance();
      return { kind: 'literal', value: null };
    }

    throw new ParseFailure(
      'a list may hold string, number, or null literals only',
      token.type === 'end' ? this.source : token.text,
      token.offset,
    );
  }

  private toNumber(token: Token): number {
    const value = Number(token.text);
    if (!Number.isFinite(value)) {
      throw new ParseFailure(`"${token.text}" is not a number`, token.text, token.offset);
    }
    return value;
  }

  private expect(type: TokenType, message: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ParseFailure(
        message,
        token.type === 'end' ? this.source : token.text,
        token.offset,
      );
    }
    this.advance();
    return token;
  }

  private textFrom(token: Token): string {
    return this.source.slice(token.offset) || token.text;
  }

  private peek(): Token {
    const token = this.tokens[this.position];
    if (token === undefined) {
      const last = this.tokens[this.tokens.length - 1];
      return last ?? { type: 'end', text: '', offset: 0 };
    }
    return token;
  }

  private advance(): void {
    this.position += 1;
  }
}

/**
 * Parses a condition string. Errors are returned as values rather than thrown, so a
 * malformed condition becomes a load diagnostic naming the file and requirement rather
 * than an exception unwinding a whole spec load.
 */
export function parseCondition(input: string): ConditionAst | ConditionParseError {
  if (input.trim() === '') {
    return {
      kind: 'error',
      message: 'condition is empty',
      offendingText: input,
      offset: 0,
    };
  }

  try {
    const tokens = tokenize(input);
    return new Parser(tokens, input).parseCondition();
  } catch (error) {
    if (error instanceof TokenizeFailure || error instanceof ParseFailure) {
      return {
        kind: 'error',
        message: error.message,
        offendingText: error.offendingText,
        offset: error.offset,
      };
    }
    throw error;
  }
}
