export type Severity = "error" | "warning" | "info";

export type FileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

/** A file changed by the pull request, normalized from the GitHub API. */
export interface ChangedFile {
  filename: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunk. GitHub omits it for binary or very large files. */
  patch?: string;
  previousFilename?: string;
}

export interface Finding {
  /** Id of the check that produced the finding, e.g. "missing-tests". */
  check: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
}

/** Outcome of one check, shown as a row in the report table. */
export interface CheckResult {
  name: string;
  /** True when the check is disabled or has no input to work from. */
  skipped?: boolean;
  /** One-line detail for the report table, e.g. "84.2% (min 80%)". */
  detail?: string;
  findings: Finding[];
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  author: string;
  baseRef: string;
  headRef: string;
}
