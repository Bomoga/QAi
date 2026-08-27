// src/index.ts
import { appendFileSync, readFileSync } from "fs";
import process from "process";

// src/outputs.ts
function count(results, level) {
  return results.filter((result) => result.level === level).length;
}
function outputsFromSarif(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `the SARIF report could not be parsed: ${cause instanceof Error ? cause.message : "unknown"}`,
      { cause }
    );
  }
  const run = document.runs?.[0];
  if (run === void 0) {
    throw new Error("the SARIF report contains no run, so there is nothing to report on");
  }
  const results = run.results ?? [];
  const properties = run.properties ?? {};
  return {
    findingsTotal: results.length,
    findingsError: count(results, "error"),
    findingsWarning: count(results, "warning"),
    findingsNote: count(results, "note"),
    // Rounded to a whole percent. A workflow comparing against a threshold does not want
    // sixteen decimal places, and the underlying fraction is in the report itself.
    coveragePercent: Math.round((properties.coverage ?? 0) * 100),
    requirementsUnverified: properties.requirementsUnverified ?? 0,
    modelAssistedChecks: properties.modelAssistedCheckCount ?? 0
  };
}
var OUTPUT_NAMES = {
  findingsTotal: "findings-total",
  findingsError: "findings-error",
  findingsWarning: "findings-warning",
  findingsNote: "findings-note",
  coveragePercent: "coverage-percent",
  requirementsUnverified: "requirements-unverified",
  modelAssistedChecks: "model-assisted-checks"
};
function formatOutputs(outputs) {
  const lines = Object.keys(OUTPUT_NAMES).map(
    (key) => `${OUTPUT_NAMES[key]}=${outputs[key]}`
  );
  return `${lines.join("\n")}
`;
}
function summaryLine(outputs) {
  return [
    `${outputs.findingsTotal} finding(s):`,
    `${outputs.findingsError} error,`,
    `${outputs.findingsWarning} warning,`,
    `${outputs.findingsNote} note.`,
    `Coverage ${outputs.coveragePercent}% of requirements with at least one check that reached a verdict.`,
    `${outputs.requirementsUnverified} requirement(s) unverified.`,
    `${outputs.modelAssistedChecks} model assisted check(s).`
  ].join(" ");
}

// src/index.ts
function main(argv) {
  const reportPath = argv[2];
  if (reportPath === void 0) {
    process.stderr.write("error: no SARIF report path was given\n");
    return 2;
  }
  let outputs;
  try {
    outputs = outputsFromSarif(readFileSync(reportPath, "utf8"));
  } catch (cause) {
    process.stderr.write(
      `error: ${cause instanceof Error ? cause.message : "the SARIF report could not be read"}
  at ${reportPath}
`
    );
    return 2;
  }
  const target = process.env["GITHUB_OUTPUT"];
  if (target !== void 0 && target !== "") appendFileSync(target, formatOutputs(outputs), "utf8");
  process.stdout.write(`${summaryLine(outputs)}
`);
  return 0;
}
if (process.argv[1] !== void 0 && import.meta.filename.endsWith("index.js")) {
  process.exitCode = main(process.argv);
}
export {
  OUTPUT_NAMES,
  formatOutputs,
  main,
  outputsFromSarif,
  summaryLine
};
//# sourceMappingURL=index.js.map