/**
 * Public API of @qai/core.
 *
 * Deliberately empty at S0. Everything a surface is allowed to touch is re-exported
 * from here as its owning module lands: contracts and spec loading from M1, target
 * and actor sessions from M2, checks from M3 and M5, probe and diff from M4, store
 * from M6, emitters from M7. Nothing outside this file is part of the package
 * contract, so a surface reaching into a deep path is reaching into private code.
 */
export {};
