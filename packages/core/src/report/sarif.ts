import {
  FIELD_MISMATCH_SEVERITY,
  SPECIFIED_NOT_OBSERVED_SEVERITY,
} from '../diff/spec-observation.ts';
import type { CheckResultRecord, CheckType, RunResult, Severity } from '../contracts/index.ts';

/**
 * The SARIF 2.1.0 projection of a RunResult, hand-rolled.
 *
 * The module says to hand-roll it, and the reason holds up: exact control over what
 * appears in a code scanning tab is worth more than the hour a library saves, and no
 * SARIF library is on the approved dependency list anyway.
 *
 * **What becomes a result.** A finding, which is a failed check, plus the structural
 * disagreements. 01-PRODUCT.md calls those structural findings and 03-CONTRACTS.md
 * reserves a `structural` check type for them, so the rule the module asks for has
 * something to carry. Leaving them out would mean the entity the spec declares and the
 * application never built, which is the sharpest thing this tool reports, never reaches
 * the one surface a CI user actually reads.
 *
 * **Redaction, rule R8.** Nothing here opens an evidence body. `message.text` is built
 * from `detail`, which the check wrote from an already redacted capture, so the emitter
 * cannot leak what it never reads. That is a structural guarantee rather than a habit.
 *
 * **Determinism.** Every array is sorted before it is written and every object is built
 * literally, so two runs over one RunResult produce the same bytes. Keys are left in
 * written order rather than sorted, unlike `renderJson`: `version` and `$schema` leading
 * the document is what every reader and every tool expects to see first, and no golden
 * file depends on the alphabet here.
 */

/** One per check type, per the module. All three are always emitted so a `ruleId` resolves. */
const RULES: readonly {
  readonly id: CheckType;
  readonly name: string;
  readonly shortDescription: string;
  readonly fullDescription: string;
}[] = [
  {
    id: 'access',
    name: 'AccessRule',
    shortDescription: 'An access rule in the spec was not enforced by the target',
    fullDescription:
      'The spec states who may perform an action on a resource. The tool attempted the action as the named actor and the target answered in a way the rule does not permit.',
  },
  {
    id: 'behavioral',
    name: 'AcceptanceCriterion',
    shortDescription: 'An acceptance criterion in the spec was not satisfied by the target',
    fullDescription:
      'The spec states an observable outcome for a request. The tool issued the request and asserted on the response and on persisted state, and at least one clause did not hold.',
  },
  {
    id: 'structural',
    name: 'SpecObservationDisagreement',
    shortDescription: 'What the spec declares and what the target contains disagree',
    fullDescription:
      'The probe recorded what the target actually contains and the tool compared it against the spec. This result names something one side has and the other does not.',
  },
];

const TOOL_INFORMATION_URI = 'https://github.com/Bomoga/QAi';

/**
 * Severity to SARIF level, exactly as the module states it: high and medium become
 * error and warning, low and info become note.
 */
function levelOf(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

function ruleIndexOf(type: CheckType): number {
  return RULES.findIndex((rule) => rule.id === type);
}

function severityRank(severity: Severity): number {
  return ['high', 'medium', 'low', 'info'].indexOf(severity);
}

interface SarifLocationOut {
  readonly physicalLocation?: {
    readonly artifactLocation: { readonly uri: string };
    readonly region?: { readonly startLine: number };
  };
  readonly logicalLocations?: readonly {
    readonly name: string;
    readonly fullyQualifiedName?: string;
    readonly kind: string;
  }[];
}

interface SarifResultOut {
  readonly ruleId: CheckType;
  readonly ruleIndex: number;
  readonly kind: 'fail';
  readonly level: 'error' | 'warning' | 'note';
  readonly message: { readonly text: string };
  readonly locations: readonly SarifLocationOut[];
  readonly partialFingerprints: Readonly<Record<string, string>>;
  readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * `app/api/invoices/[id]/route.ts:12` into a uri and a line.
 *
 * Only a trailing colon and digits is read as a line number. A Windows path carrying a
 * drive letter has a colon too, and guessing there would point a reader at line 1 of a
 * file whose name lost its first two characters.
 */
function splitLocationRef(ref: string): { uri: string; startLine?: number } {
  const match = /^(.*):(\d+)$/.exec(ref);
  if (match === null) return { uri: ref };

  const [, uri, line] = match;
  if (uri === undefined || uri.length === 0 || line === undefined) return { uri: ref };

  return { uri, startLine: Number.parseInt(line, 10) };
}

/**
 * The spec file this run was loaded from, used as the anchor for a finding with no source.
 *
 * **Every result needs a physical location or GitHub will not ingest the document.** A
 * logical location alone is conformant SARIF 2.1.0 and is rejected at processing time
 * with `locationFromSarifResult: expected a physical location`, which is how this was
 * found: the upload succeeded and the analysis failed, once per result. No test here can
 * catch that, because the only authority on what GitHub ingests is GitHub.
 *
 * The spec file is the honest anchor. A finding is about a requirement, the requirement
 * is written there, and a reviewer following an alert lands on the thing that was
 * claimed rather than on a path this file invented. It is file level, since the loader
 * records no line numbers.
 *
 * With several spec files this names the first, which is the run's spec rather than
 * necessarily the file that declared this particular requirement. Recorded in the
 * module's open questions; the requirement id is in the message and the logical location
 * either way.
 */
function specAnchor(result: RunResult): string | undefined {
  const [first] = result.spec.files;
  return first;
}

/**
 * A physical location, plus a logical one naming what the finding is about.
 *
 * The module says the logical location names the endpoint. A `CheckResultRecord` has no
 * endpoint field, and the route appears only inside `detail` as prose, so this names the
 * rule and requirement the check came from rather than parsing a path back out of a
 * sentence. A structural entry does carry an endpoint id and does name it.
 *
 * The check's own source reference wins when it has one. Otherwise the anchor stands in,
 * and the logical location is kept beside it so nothing is lost by anchoring.
 */
function locationsFor(check: CheckResultRecord, anchor: string | undefined): SarifLocationOut[] {
  if (check.locationRef !== undefined) {
    const { uri, startLine } = splitLocationRef(check.locationRef);
    return [
      {
        physicalLocation: {
          artifactLocation: { uri },
          ...(startLine === undefined ? {} : { region: { startLine } }),
        },
      },
    ];
  }

  const name = check.ruleId ?? check.requirementId ?? check.checkId;
  const qualified = [check.requirementId, check.ruleId].filter(
    (part): part is string => part !== undefined,
  );

  return [
    {
      // Absent only when the run recorded no spec file at all, which leaves nothing true
      // to point at. Logical alone is what this emitted before, and GitHub will refuse it.
      ...(anchor === undefined ? {} : { physicalLocation: { artifactLocation: { uri: anchor } } }),
      logicalLocations: [
        {
          name,
          ...(qualified.length > 1 ? { fullyQualifiedName: qualified.join('/') } : {}),
          kind: 'rule',
        },
      ],
    },
  ];
}

/**
 * The message a reader sees in the GitHub UI without leaving the page: the title, then
 * the request and response summary the check already recorded, then where to look.
 *
 * One part per line, title first. A code scanning list shows the leading line and the
 * alert page shows the rest, so the reader gets the claim in the list and the evidence
 * behind it on the page. Joined with a space instead, the title runs into the request
 * summary and neither reads as a sentence.
 */
function messageFor(check: CheckResultRecord): string {
  const parts = [check.title];
  if (check.detail !== undefined) parts.push(check.detail);
  if (check.locationRef !== undefined) parts.push(`Source: ${check.locationRef}`);
  if (check.evidence.length > 0) parts.push(`Evidence: ${check.evidence.join(', ')}`);
  if (!check.deterministic) parts.push('Model assisted');
  return parts.join('\n');
}

function checkResults(result: RunResult): SarifResultOut[] {
  const anchor = specAnchor(result);

  return result.checks
    .filter((check) => check.verdict === 'fail')
    .sort(
      (left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        (left.requirementId ?? '').localeCompare(right.requirementId ?? '') ||
        left.checkId.localeCompare(right.checkId),
    )
    .map((check) => ({
      ruleId: check.type,
      ruleIndex: ruleIndexOf(check.type),
      kind: 'fail' as const,
      level: levelOf(check.severity),
      message: { text: messageFor(check) },
      locations: locationsFor(check, anchor),
      // Content-hashed at runtime, so the same check on the same target keeps one alert
      // across runs instead of opening a new one every time CI runs.
      partialFingerprints: { qaiCheckId: check.checkId },
      properties: {
        checkId: check.checkId,
        deterministic: check.deterministic,
        severity: check.severity,
        ...(check.requirementId === undefined ? {} : { requirementId: check.requirementId }),
        ...(check.ruleId === undefined ? {} : { specRuleId: check.ruleId }),
      },
    }));
}

function structuralResult(
  name: string,
  severity: Severity,
  text: string,
  logicalKind: string,
  fingerprint: string,
  anchor: string | undefined,
): SarifResultOut {
  return {
    ruleId: 'structural',
    ruleIndex: ruleIndexOf('structural'),
    kind: 'fail',
    level: levelOf(severity),
    message: { text },
    locations: [
      {
        // A structural entry never has a source reference: it is about something the
        // probe did or did not see, not about a line somebody wrote.
        ...(anchor === undefined
          ? {}
          : { physicalLocation: { artifactLocation: { uri: anchor } } }),
        logicalLocations: [{ name, kind: logicalKind }],
      },
    ],
    partialFingerprints: { qaiStructuralId: fingerprint },
    properties: { severity },
  };
}

/**
 * The disagreements, as results.
 *
 * `observedNotSpecified` carries its own severity. The other two do not: 03-CONTRACTS.md
 * gives them no severity field, and M4.8 exported the defaults as constants for whoever
 * turned an entry into a finding rather than adding a contract field. This is that
 * caller.
 */
function structuralResults(result: RunResult): SarifResultOut[] {
  const out: SarifResultOut[] = [];
  const anchor = specAnchor(result);

  for (const entry of [...result.structural.specifiedNotObserved].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name),
  )) {
    const required =
      entry.requirementIds.length > 0 ? ` Required by ${entry.requirementIds.join(', ')}.` : '';
    out.push(
      structuralResult(
        entry.name,
        SPECIFIED_NOT_OBSERVED_SEVERITY,
        `The spec declares ${entry.kind} ${entry.name} and the probe did not observe it in the target.${required}`,
        entry.kind,
        `specifiedNotObserved:${entry.kind}:${entry.name}`,
        anchor,
      ),
    );
  }

  for (const entry of [...result.structural.observedNotSpecified].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  )) {
    out.push(
      structuralResult(
        entry.id,
        entry.severity,
        `The probe observed ${entry.kind} ${entry.id} in the target and no requirement in the spec refers to it.`,
        entry.kind,
        `observedNotSpecified:${entry.kind}:${entry.id}`,
        anchor,
      ),
    );
  }

  for (const entry of [...result.structural.fieldMismatches].sort((left, right) =>
    left.entity.localeCompare(right.entity),
  )) {
    const clauses: string[] = [];
    if (entry.specifiedNotObserved.length > 0) {
      clauses.push(
        `declared and not observed: ${[...entry.specifiedNotObserved].sort().join(', ')}`,
      );
    }
    if (entry.observedNotSpecified.length > 0) {
      clauses.push(
        `observed and not declared: ${[...entry.observedNotSpecified].sort().join(', ')}`,
      );
    }
    if (clauses.length === 0) continue;

    out.push(
      structuralResult(
        entry.entity,
        FIELD_MISMATCH_SEVERITY,
        `Fields of ${entry.entity} disagree between the spec and the target, ${clauses.join('; ')}.`,
        'entity',
        `fieldMismatch:${entry.entity}`,
        anchor,
      ),
    );
  }

  return out;
}

export function renderSarif(result: RunResult): string {
  const log = {
    $schema:
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'QAi',
            version: result.toolVersion,
            informationUri: TOOL_INFORMATION_URI,
            rules: RULES.map((rule) => ({
              id: rule.id,
              name: rule.name,
              shortDescription: { text: rule.shortDescription },
              fullDescription: { text: rule.fullDescription },
            })),
          },
        },
        automationDetails: { id: result.runId },
        invocations: [
          {
            // The run produced a result. Whether that result contains findings is what
            // `level` says, and conflating the two would report a working tool as broken.
            executionSuccessful: true,
            startTimeUtc: result.startedAt,
            endTimeUtc: result.finishedAt,
          },
        ],
        results: [...checkResults(result), ...structuralResults(result)],
        properties: {
          specHash: result.spec.hash,
          coverage: result.summary.coverage,
          // Named for what it counts. It is not a pass rate and is never labeled one.
          coverageMeaning: 'requirements with at least one check that reached a verdict',
          modelAssistedCheckCount: result.summary.modelAssistedCheckCount,
          requirementsUnverified: result.summary.requirements.unverified,
        },
      },
    ],
  };

  return `${JSON.stringify(log, null, 2)}\n`;
}
