import type { Config } from "../config.js";
import { matchesAny } from "../glob.js";
import type { ChangedFile, CheckResult, Finding } from "../types.js";

/** Changed file paths, including the old name of a rename so moves can't dodge a rule. */
function touchedPaths(f: ChangedFile): string[] {
  return f.previousFilename ? [f.filename, f.previousFilename] : [f.filename];
}

export function checkPaths(files: ChangedFile[], config: Config): CheckResult {
  const findings: Finding[] = [];

  for (const f of files) {
    const paths = touchedPaths(f);
    for (const rule of config.blockedPaths) {
      if (paths.some((p) => matchesAny(p, [rule.pattern]))) {
        findings.push({
          check: "blocked-path",
          severity: rule.severity,
          file: f.filename,
          message: `Must not be changed in a PR${rule.reason ? `: ${rule.reason}` : ""}.`,
        });
      }
    }
    for (const rule of config.sensitivePaths) {
      if (paths.some((p) => matchesAny(p, [rule.pattern]))) {
        findings.push({
          check: "sensitive-path",
          severity: rule.severity,
          file: f.filename,
          message: `${rule.reason ?? "Sensitive path"}.`,
        });
        break;
      }
    }
  }

  return {
    name: "Protected paths",
    detail: findings.length ? `${findings.length} flagged` : "none touched",
    findings,
  };
}
