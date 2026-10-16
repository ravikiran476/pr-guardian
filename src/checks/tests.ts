import { basename } from "node:path";
import type { Config } from "../config.js";
import { matchesAny } from "../glob.js";
import type { ChangedFile, CheckResult, Finding } from "../types.js";

/** "src/foo/user-service.ts" -> "user-service"; "test_user_service.py" -> "user_service". */
export function stem(file: string): string {
  return basename(file)
    .replace(/\.[^.]+$/, "")
    .replace(/[._-](test|spec)$/i, "")
    .replace(/^test_/i, "")
    .toLowerCase();
}

export function checkTests(files: ChangedFile[], config: Config): CheckResult {
  const cfg = config.tests;
  if (!cfg.enabled) return { name: "Tests", skipped: true, detail: "disabled", findings: [] };

  const isTest = (f: string) => matchesAny(f, cfg.testPatterns);
  const tests = files.filter((f) => isTest(f.filename));
  const sources = files.filter(
    (f) =>
      f.status !== "removed" &&
      !isTest(f.filename) &&
      matchesAny(f.filename, cfg.sourcePatterns) &&
      !matchesAny(f.filename, cfg.ignore),
  );

  const touchedTestStems = new Set(tests.filter((t) => t.status !== "removed").map((t) => stem(t.filename)));
  const untested = sources.filter((s) => !touchedTestStems.has(stem(s.filename)));

  const findings: Finding[] = untested.map((s) => ({
    check: "missing-tests",
    severity: cfg.severity,
    file: s.filename,
    message: "Changed without a matching test change.",
  }));

  if (cfg.flagDeletedTests) {
    for (const t of tests.filter((t) => t.status === "removed")) {
      findings.push({
        check: "deleted-test",
        severity: "warning",
        file: t.filename,
        message: "Test file deleted.",
      });
    }
  }

  return {
    name: "Tests",
    detail: sources.length
      ? `${sources.length - untested.length}/${sources.length} source files have matching test changes`
      : "no source files changed",
    findings,
  };
}
