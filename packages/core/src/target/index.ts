/**
 * Target configuration, actor sessions, fixtures, and reset. Owned by M2.
 *
 * This is where the safety posture lives: the disposability gate, the rule that
 * credentials are named rather than held, and the capture point that redacts before
 * anything reaches disk.
 *
 * Present: config resolution.
 * Pending: environment resolution, the request layer, actor sessions, seed and reset,
 * and the startup capability report.
 */
export * from './config.ts';
