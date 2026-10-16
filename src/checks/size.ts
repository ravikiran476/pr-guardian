import type { Config } from "../config.js";
import { matchesAny } from "../glob.js";
import type { ChangedFile, CheckResult, Finding } from "../types.js";

export function checkSize(files: ChangedFile[], config: Config): CheckResult {
  const { maxFiles, maxLines, severity, ignore } = config.size;
  const counted = files.filter((f) => !matchesAny(f.filename, ignore));
  const lines = counted.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const findings: Finding[] = [];
  if (counted.length > maxFiles) {
    findings.push({
      check: "pr-size",
      severity,
      message: `PR touches ${counted.length} files (limit ${maxFiles}). Consider splitting it.`,
    });
  }
  if (lines > maxLines) {
    findings.push({
      check: "pr-size",
      severity,
      message: `PR changes ${lines} lines (limit ${maxLines}). Large PRs are harder to review well.`,
    });
  }
  return {
    name: "PR size",
    detail: `${counted.length} files, ${lines} lines`,
    findings,
  };
}
