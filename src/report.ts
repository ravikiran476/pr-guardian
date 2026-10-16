import type { CheckResult, Finding, Severity } from "./types.js";

/** Hidden marker used to find and update our own comment instead of posting a new one each run. */
export const COMMENT_MARKER = "<!-- pr-guardian:report -->";

/** GitHub rejects comments over 65,536 characters. */
const MAX_COMMENT_CHARS = 60_000;

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };
const ICON = { passed: "✅", info: "ℹ️", warning: "⚠️", error: "❌", skipped: "⏭️" } as const;

export type FailOn = Severity | "never";

export function worstSeverity(findings: Finding[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const f of findings) if (!worst || RANK[f.severity] > RANK[worst]) worst = f.severity;
  return worst;
}

export function shouldFail(results: CheckResult[], failOn: FailOn): boolean {
  if (failOn === "never") return false;
  return results.some((r) => r.findings.some((f) => RANK[f.severity] >= RANK[failOn]));
}

function statusIcon(r: CheckResult): string {
  if (r.skipped) return ICON.skipped;
  const worst = worstSeverity(r.findings);
  return worst && worst !== "info" ? ICON[worst] : ICON.passed;
}

function location(f: Finding): string {
  if (!f.file) return "";
  return `\`${f.file}${f.line ? `:${f.line}` : ""}\` `;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export interface RenderOptions {
  failed: boolean;
  aiSummary?: string;
  /** Shown when AI was enabled but produced nothing, e.g. "the model declined". */
  aiNote?: string;
  runUrl?: string;
}

export function renderReport(results: CheckResult[], opts: RenderOptions): string {
  const all = results.flatMap((r) => r.findings);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of all) counts[f.severity]++;

  const headline = opts.failed
    ? `${ICON.error} **PR Guardian: changes need attention**`
    : counts.warning
      ? `${ICON.warning} **PR Guardian: passed with warnings**`
      : `${ICON.passed} **PR Guardian: all checks passed**`;

  const lines: string[] = [COMMENT_MARKER, `### ${headline}`, ""];
  lines.push(`${counts.error} errors · ${counts.warning} warnings · ${counts.info} notes`, "");

  lines.push("| | Check | Result |", "|---|---|---|");
  for (const r of results) lines.push(`| ${statusIcon(r)} | ${r.name} | ${escapeCell(r.detail ?? "")} |`);
  lines.push("");

  for (const sev of ["error", "warning"] as const) {
    const items = all.filter((f) => f.severity === sev);
    if (!items.length) continue;
    lines.push(`#### ${ICON[sev]} ${sev === "error" ? "Errors" : "Warnings"}`, "");
    for (const f of items) lines.push(`- ${location(f)}${f.message}`);
    lines.push("");
  }

  const notes = all.filter((f) => f.severity === "info");
  if (notes.length) {
    lines.push(`<details><summary>${ICON.info} Notes (${notes.length})</summary>`, "");
    for (const f of notes) lines.push(`- ${location(f)}${f.message}`);
    lines.push("", "</details>", "");
  }

  if (opts.aiSummary) {
    lines.push("#### 🤖 AI review summary", "", opts.aiSummary, "", "<sub>AI-generated; verify before acting on it.</sub>", "");
  } else if (opts.aiNote) {
    lines.push(`<sub>🤖 AI summary unavailable: ${opts.aiNote}</sub>`, "");
  }

  if (opts.runUrl) lines.push(`<sub>[View workflow run](${opts.runUrl})</sub>`);

  return lines.join("\n");
}

/** The job summary gets the full report; the PR comment is cut to fit GitHub's size limit. */
export function fitForComment(body: string): string {
  if (body.length <= MAX_COMMENT_CHARS) return body;
  return `${body.slice(0, MAX_COMMENT_CHARS)}\n\n_Report truncated to fit a GitHub comment. The workflow run's job summary has the full report._`;
}
