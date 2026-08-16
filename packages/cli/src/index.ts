/**
 * Public API of @qai/cli.
 *
 * Deliberately empty at S0. The command surface, its flags, and the exit code policy
 * are owned by M8 and land in S6; naming a command here before then would create a
 * second source of truth for something 03-CONTRACTS.md already pins down. There is
 * no `bin` entry yet for the same reason: `npx qai` should not exist until it works.
 */
export {};
