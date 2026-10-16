import { effectiveContentRules, type Config } from "../config.js";
import { addedLines } from "../diff.js";
import { matchesAny } from "../glob.js";
import type { ChangedFile, CheckResult, Finding } from "../types.js";

/** Scans added lines in each patch for risky patterns (secrets, focused tests, debug leftovers). */
export function checkContent(files: ChangedFile[], config: Config): CheckResult {
  const rules = effectiveContentRules(config);
  const { maxFindingsPerRule } = config.content;
  const findings: Finding[] = [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, rule.flags);
    let count = 0;
    for (const f of files) {
      if (rule.files.length && !matchesAny(f.filename, rule.files)) continue;
      if (matchesAny(f.filename, rule.exclude)) continue;
      for (const { line, text } of addedLines(f.patch)) {
        if (!regex.test(text)) continue;
        count++;
        if (count <= maxFindingsPerRule) {
          findings.push({ check: rule.id, severity: rule.severity, file: f.filename, line, message: rule.message });
        }
      }
    }
    if (count > maxFindingsPerRule) {
      findings.push({
        check: rule.id,
        severity: rule.severity,
        message: `...and ${count - maxFindingsPerRule} more \`${rule.id}\` matches not shown.`,
      });
    }
  }

  const unscanned = files.filter((f) => f.status !== "removed" && !f.patch).length;
  return {
    name: "Risky content",
    detail: `${rules.length} rules${unscanned ? `; ${unscanned} files without a diff (binary or too large) not scanned` : ""}`,
    findings,
  };
}
