import type { getOctokit } from "@actions/github";
import { COMMENT_MARKER } from "./report.js";
import type { ChangedFile, FileStatus } from "./types.js";

type Octokit = ReturnType<typeof getOctokit>;

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Lists every file in the PR. The API caps this at 3000 files. */
export async function listChangedFiles(octokit: Octokit, ref: RepoRef, pullNumber: number): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, { ...ref, pull_number: pullNumber, per_page: 100 });
  return files.map((f) => ({
    filename: f.filename,
    status: f.status as FileStatus,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
    previousFilename: f.previous_filename,
  }));
}

/** A file's text at a commit, or undefined when it does not exist there. */
export async function readFileAtRef(octokit: Octokit, ref: RepoRef, path: string, sha: string): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({ ...ref, path, ref: sha });
    if (Array.isArray(data) || data.type !== "file") throw new Error(`${path} is not a file`);
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (err) {
    if ((err as { status?: number }).status === 404) return undefined;
    throw err;
  }
}

/** Updates our previous report comment if there is one, otherwise creates it. */
export async function upsertComment(octokit: Octokit, ref: RepoRef, issueNumber: number, body: string): Promise<string> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...ref,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER) && c.user?.type === "Bot");
  if (existing) {
    const { data } = await octokit.rest.issues.updateComment({ ...ref, comment_id: existing.id, body });
    return data.html_url;
  }
  const { data } = await octokit.rest.issues.createComment({ ...ref, issue_number: issueNumber, body });
  return data.html_url;
}
