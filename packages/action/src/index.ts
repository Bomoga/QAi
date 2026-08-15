/**
 * Public API of @qai/action.
 *
 * Deliberately empty at S0. The action resolves inputs, invokes the CLI, and forwards
 * outputs; it holds no verification logic of its own. It lands with M8 in S6, once
 * there is a CLI for it to be a thin shell around.
 */
export {};
