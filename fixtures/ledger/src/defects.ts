/**
 * Defect switches, one per entry in the catalog in 06-TESTING.md.
 *
 * Defects default to on. This app exists to be found wanting; a run that has to be
 * told to misbehave would let a broken toggle pass for a clean target.
 */

export interface DefectSwitches {
  /** D1: an invoice is readable across organizations by id. */
  readonly d1CrossOrgInvoiceRead: boolean;
  /** D2: the invoice list returns every row rather than the caller organization. */
  readonly d2UnscopedInvoiceList: boolean;
  /** D3: an invoice can be modified without any credentials. */
  readonly d3UnauthenticatedMutation: boolean;
}

const SWITCHES = {
  d1CrossOrgInvoiceRead: 'LEDGER_DEFECT_D1',
  d2UnscopedInvoiceList: 'LEDGER_DEFECT_D2',
  d3UnauthenticatedMutation: 'LEDGER_DEFECT_D3',
} as const satisfies Record<keyof DefectSwitches, string>;

/**
 * An unrecognized value is a startup error, not a fallback. A mistyped switch that
 * silently leaves a defect enabled makes a passing run mean nothing, which is the
 * one failure mode a fixture app cannot have.
 */
export function readDefectSwitches(env: Record<string, string | undefined>): DefectSwitches {
  const entries = Object.entries(SWITCHES) as [keyof DefectSwitches, string][];

  const resolved = entries.map(([key, variable]): [keyof DefectSwitches, boolean] => {
    const raw = env[variable];
    if (raw === undefined || raw === 'on') return [key, true];
    if (raw === 'off') return [key, false];
    throw new Error(`${variable} must be "on" or "off", received "${raw}"`);
  });

  return Object.fromEntries(resolved) as unknown as DefectSwitches;
}
