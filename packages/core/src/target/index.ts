/**
 * Target configuration, actor sessions, fixtures, and reset. Owned by M2.
 *
 * This is where the safety posture lives: the disposability gate, the rule that
 * credentials are named rather than held, and the capture point that redacts before
 * anything reaches disk.
 *
 * Present: config resolution, credential resolution, and the request layer.
 * Pending: evidence capture, actor sessions, seed and reset, and the startup
 * capability report.
 */
export * from './config.ts';
export * from './credentials.ts';
export * from './deps.ts';
export * from './request.ts';
