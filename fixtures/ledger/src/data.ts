/**
 * Seeded state. Field names on Invoice are the wire names on purpose, so the shape
 * the app returns matches the shape spec/ledger.spec.yaml describes without a
 * translation layer sitting between them and quietly absorbing a mismatch.
 */

export interface Organization {
  readonly id: string;
  readonly name: string;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly org_id: string;
  readonly token: string;
}

export interface Invoice {
  readonly id: string;
  readonly org_id: string;
  readonly total_cents: number;
  readonly notes: string;
}

export interface LedgerData {
  readonly organizations: readonly Organization[];
  readonly users: readonly User[];
  readonly invoices: readonly Invoice[];
}

/** Fixture credentials. They authenticate against this app and nothing else. */
export const OWNER_TOKEN = 'ledger-owner-token';
export const OUTSIDER_TOKEN = 'ledger-outsider-token';

/**
 * Two organizations with one user each is the minimum that makes cross-organization
 * access observable. One organization proves nothing: every read is a read of your own.
 */
export function seedLedger(): LedgerData {
  return {
    organizations: [
      { id: 'org-1', name: 'Northwind Trading' },
      { id: 'org-2', name: 'Contoso Supply' },
    ],
    users: [
      { id: 'usr-1', email: 'owner@northwind.example', org_id: 'org-1', token: OWNER_TOKEN },
      { id: 'usr-2', email: 'outsider@contoso.example', org_id: 'org-2', token: OUTSIDER_TOKEN },
    ],
    invoices: [
      {
        id: 'INV-1001',
        org_id: 'org-1',
        total_cents: 125_000,
        notes: 'Net 30, billing contact ap@northwind.example',
      },
      {
        id: 'INV-2001',
        org_id: 'org-2',
        total_cents: 90_000,
        notes: 'Renewal discount applied, approved by finance',
      },
    ],
  };
}
