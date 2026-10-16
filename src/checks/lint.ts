import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Config } from "../config.js";
import type { ChangedFile, CheckResult, Finding } from "../types.js";

interface EslintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line?: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

const MAX_LISTED = 20;

export function checkLint(files: ChangedFile[], config: Config, workspace = process.cwd()): CheckResult {
  const { report, maxErrors, maxWarnings, onlyChangedFiles, severity } = config.lint;
  const name = "Lint";
  if (!report) return { name, skipped: true, detail: "no lint report configured", findings: [] };
  if (!existsSync(report)) {
    return {
      name,
      detail: "report not found",
      findings: [
        { check: "lint", severity: "warning", message: `Lint report \`${report}\` not found. Did the lint step run first?` },
      ],
    };
  }

  let results: EslintFileResult[];
  try {
    results = JSON.parse(readFileSync(report, "utf8"));
    if (!Array.isArray(results)) throw new Error("expected an array (ESLint `-f json` output)");
  } catch (err) {
    return {
      name,
      detail: "unreadable report",
      findings: [{ check: "lint", severity: "warning", message: `Could not parse \`${report}\`: ${(err as Error).message}` }],
    };
  }

  const changed = new Set(files.map((f) => f.filename));
  const problems: { file: string; msg: EslintMessage }[] = [];
  for (const r of results) {
    // ESLint reports absolute paths; GitHub reports repo-relative paths with forward slashes.
    const file = relative(workspace, resolve(workspace, r.filePath)).split("\\").join("/");
    if (onlyChangedFiles && !changed.has(file)) continue;
    for (const msg of r.messages) problems.push({ file, msg });
  }

  const errors = problems.filter((p) => p.msg.severity === 2);
  const warningCount = problems.length - errors.length;
  const findings: Finding[] = [];
  if (errors.length > maxErrors) {
    findings.push({ check: "lint", severity, message: `${errors.length} lint errors (max ${maxErrors}).` });
  }
  if (maxWarnings !== undefined && warningCount > maxWarnings) {
    findings.push({ check: "lint", severity, message: `${warningCount} lint warnings (max ${maxWarnings}).` });
  }
  if (findings.length) {
    for (const { file, msg } of errors.slice(0, MAX_LISTED)) {
      findings.push({
        check: "lint",
        severity: "info",
        file,
        line: msg.line,
        message: `${msg.message}${msg.ruleId ? ` (\`${msg.ruleId}\`)` : ""}`,
      });
    }
  }

  return {
    name,
    detail: `${errors.length} errors, ${warningCount} warnings${onlyChangedFiles ? " in changed files" : ""}`,
    findings,
  };
}
