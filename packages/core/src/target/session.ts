import { captureHttpEvidence, type EvidenceWriter } from '../evidence/capture.ts';
import type { RedactionRules } from '../evidence/redact.ts';
import type { Evidence } from '../contracts/index.ts';
import type { ResolvedActor } from './credentials.ts';
import type { Deps } from './deps.ts';
import {
  applyCredential,
  type HttpClient,
  type RequestOutcome,
  type RequestSpec,
} from './request.ts';

/**
 * An authenticated identity, and the only way a check reaches the target.
 *
 * Every request produces an evidence record, whether it succeeded, failed, or never
 * connected. That is rule R7 made structural: there is no method here that performs a
 * request without recording one, so a verdict cannot be reached about traffic that was
 * never captured.
 */

export interface SessionResult {
  readonly outcome: RequestOutcome;
  readonly evidenceId: string;
  readonly evidence: Evidence;
}

export interface ActorSession {
  readonly id: string;
  /** Attributes the condition grammar compares against, for example `actor.org_id`. */
  readonly attributes: Readonly<Record<string, string>>;
  request(spec: RequestSpec): Promise<SessionResult>;
}

export interface SessionOptions {
  readonly client: HttpClient;
  readonly rules: RedactionRules;
  readonly deps: Deps;
  readonly writer?: EvidenceWriter;
  readonly evidenceDir?: string;
}

export function createActorSession(actor: ResolvedActor, options: SessionOptions): ActorSession {
  return {
    id: actor.id,
    attributes: actor.attributes,

    async request(spec) {
      const outcome = await options.client.send(spec, actor.credential);

      /**
       * Evidence records the headers that were actually sent, not the ones the caller
       * passed. `applyCredential` is pure, so deriving them again here changes nothing
       * about the request. Capturing the caller's headers instead left the record with
       * no authorization header at all, which reads as "no credential was sent" and is
       * exactly the ambiguity between redaction and absence that the redactions list
       * exists to remove.
       */
      const sent: RequestSpec = {
        ...spec,
        headers: applyCredential(spec.headers ?? {}, actor.credential),
      };

      const capture = captureHttpEvidence(sent, outcome, options.rules, options.deps, {
        actorId: actor.id,
        ...(options.evidenceDir === undefined ? {} : { evidenceDir: options.evidenceDir }),
      });

      options.writer?.write(capture);

      return {
        outcome,
        evidenceId: capture.evidence.id,
        evidence: capture.evidence,
      };
    },
  };
}

export function createActorSessions(
  actors: readonly ResolvedActor[],
  options: SessionOptions,
): Map<string, ActorSession> {
  return new Map(actors.map((actor) => [actor.id, createActorSession(actor, options)]));
}

/**
 * Access checking compares what one identity may see against what another may. With
 * one identity there is nothing to compare, so the honest answer is `unverified` with
 * reason `actor-unavailable`, said out loud at startup. A quiet green run here is the
 * single most dangerous output this tool can produce.
 */
export const MINIMUM_ACTORS_FOR_ACCESS_CHECKS = 2;

export function accessChecksArePossible(sessions: ReadonlyMap<string, ActorSession>): boolean {
  return sessions.size >= MINIMUM_ACTORS_FOR_ACCESS_CHECKS;
}
