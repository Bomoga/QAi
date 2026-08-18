#!/usr/bin/env node
/**
 * The `qai` binary.
 *
 * A shim on purpose. Everything it could do belongs in `src/` where it can be tested
 * without spawning a process, so this file exists to be the thing `npx qai` resolves to
 * and to be the one place that ends the process. It did not exist before M8: S0.2
 * withheld the `bin` entry deliberately, on the grounds that `npx qai` should not
 * resolve until it does something.
 *
 * It is also the only place that asks whether the destination is a terminal. Nothing
 * below sniffs for it, per rule R6, so the answer travels in as an argument.
 *
 * `process` is imported rather than taken from the global, so this file needs no lint
 * environment of its own to be understood as Node.
 */
import process from 'node:process';

import { main } from '../dist/index.js';

process.exitCode = await main(process.argv, {
  stderrTty: process.stderr.isTTY === true,
  stdoutTty: process.stdout.isTTY === true,
});
