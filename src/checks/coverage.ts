import { existsSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { CheckResult } from "../types.js";

/** Returns line coverage percentage from an istanbul json-summary or an lcov file. */
export function parseCoverage(content: string): number {
  if (content.trimStart().startsWith("{")) {
    const pct = JSON.parse(content)?.total?.lines?.pct;
    if (typeof pct !== "number") throw new Error("coverage JSON has no total.lines.pct (expected istanbul json-summary)");
    return pct;
  }
  if (!content.includes("end_of_record")) throw new Error("unrecognized coverage format (expected json-summary or lcov)");
  let found = 0;
  let hit = 0;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("LF:")) found += Number(line.slice(3));
    else if (line.startsWith("LH:")) hit += Number(line.slice(3));
  }
  return found === 0 ? 100 : (hit / found) * 100;
}

export function checkCoverage(config: Config): CheckResult {
  const { file, minimum, severity } = config.coverage;
  const name = "Coverage";
  if (!file) return { name, skipped: true, detail: "no coverage file configured", findings: [] };
  if (!existsSync(file)) {
    return {
      name,
      detail: "report not found",
      findings: [
        { check: "coverage", severity: "warning", message: `Coverage file \`${file}\` not found. Did the test step run first?` },
      ],
    };
  }

  let pct: number;
  try {
    pct = parseCoverage(readFileSync(file, "utf8"));
  } catch (err) {
    return {
      name,
      detail: "unreadable report",
      findings: [{ check: "coverage", severity: "warning", message: `Could not parse \`${file}\`: ${(err as Error).message}` }],
    };
  }

  const detail = `${pct.toFixed(1)}% lines (min ${minimum}%)`;
  if (pct >= minimum) return { name, detail, findings: [] };
  return {
    name,
    detail,
    findings: [
      { check: "coverage", severity, message: `Line coverage ${pct.toFixed(1)}% is below the ${minimum}% threshold.` },
    ],
  };
}
