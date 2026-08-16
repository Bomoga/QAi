import type { ObservationNote } from '../contracts/index.ts';
import { emptyScan, type SourceAdapter, type SourceScan } from './types.ts';

/**
 * Source adapter registration and dispatch.
 *
 * An adapter that fails is a partial Observation with a stated reason, not a failed
 * run. The architecture's failure posture is explicit about this: a probe that fails
 * partially produces a partial Observation with reduced confidence, and only a target
 * that cannot be reached at all aborts. So an adapter throwing produces a note naming
 * it, and the other adapters still run.
 *
 * More than one adapter may recognize a repository, and that is normal rather than a
 * conflict: a Next.js app with a Prisma schema is two adapters describing different
 * things. Their results are concatenated here and reconciled by the merge.
 */

export interface AdapterRegistry {
  register(adapter: SourceAdapter): void;
  all(): readonly SourceAdapter[];
  /** Adapters that recognize this root, in registration order. */
  detect(root: string): Promise<SourceAdapter[]>;
  /** Runs every adapter that applies, collecting notes rather than throwing. */
  scan(root: string): Promise<{ scan: SourceScan; applied: string[] }>;
}

function noteFor(adapter: string, message: string, level: 'warn' | 'error'): ObservationNote {
  return { level, message: `${adapter}: ${message}`, refs: [] };
}

export function createAdapterRegistry(initial: readonly SourceAdapter[] = []): AdapterRegistry {
  const adapters: SourceAdapter[] = [...initial];

  async function detect(root: string): Promise<SourceAdapter[]> {
    const applicable: SourceAdapter[] = [];

    for (const adapter of adapters) {
      try {
        if (await adapter.detect(root)) applicable.push(adapter);
      } catch {
        // A detector that throws has not recognized anything. The scan phase is where
        // a failure is worth reporting; a failed detect is just a no.
      }
    }

    return applicable;
  }

  return {
    register(adapter) {
      adapters.push(adapter);
    },

    all() {
      return [...adapters];
    },

    detect,

    async scan(root) {
      const applicable = await detect(root);

      if (applicable.length === 0) {
        return {
          scan: {
            ...emptyScan(),
            notes: [
              {
                level: 'warn',
                message:
                  'No source adapter recognized the source root, so endpoints and entities can only come from the black box crawl.',
                refs: [],
              },
            ],
          },
          applied: [],
        };
      }

      const endpoints = [];
      const entities = [];
      const notes: ObservationNote[] = [];
      const applied: string[] = [];

      for (const adapter of applicable) {
        try {
          const result = await adapter.scan(root);
          endpoints.push(...result.endpoints);
          entities.push(...result.entities);
          notes.push(...result.notes);
          applied.push(adapter.name);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : 'the adapter failed';
          notes.push(noteFor(adapter.name, `could not read the source root: ${reason}`, 'error'));
        }
      }

      return { scan: { endpoints, entities, notes }, applied };
    },
  };
}
