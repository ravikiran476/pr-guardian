import type { ChangedFile, CheckResult } from "../types.js";

/**
 * Flags a PR that changes PR Guardian's own config. The run itself uses the base branch's
 * config, so the change only takes effect after merge, and a reviewer should look at it.
 */
export function checkConfigChange(files: ChangedFile[], configPath: string): CheckResult | undefined {
  const touched = files.some((f) => f.filename === configPath || f.previousFilename === configPath);
  if (!touched) return undefined;
  return {
    name: "Guardian config",
    detail: "changed in this PR; applies after merge",
    findings: [
      {
        check: "config-changed",
        severity: "warning",
        file: configPath,
        message: "PR Guardian's own rules change in this PR. This run used the base branch's rules; review the change before merging.",
      },
    ],
  };
}
