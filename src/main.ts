import * as core from "@actions/core";
import * as github from "@actions/github";
import Anthropic from "@anthropic-ai/sdk";
import { generateSummary } from "./ai.js";
import { runChecks } from "./checks/index.js";
import { loadConfig } from "./config.js";
import { listChangedFiles, upsertComment } from "./github.js";
import { fitForComment, renderReport, shouldFail, type FailOn } from "./report.js";
import type { PullRequestInfo } from "./types.js";

const FAIL_ON: readonly FailOn[] = ["error", "warning", "info", "never"];

async function run(): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.warning("PR Guardian only runs on pull_request events; nothing to check.");
    return;
  }

  const failOn = core.getInput("fail-on") as FailOn;
  if (!FAIL_ON.includes(failOn)) throw new Error(`fail-on must be one of ${FAIL_ON.join(", ")}; got "${failOn}"`);

  const config = loadConfig(core.getInput("config-path"));
  // Action inputs override the config file so a workflow can set them without a YAML file.
  const coverageFile = core.getInput("coverage-file");
  if (coverageFile) config.coverage.file = coverageFile;
  const lintReport = core.getInput("lint-report");
  if (lintReport) config.lint.report = lintReport;
  const apiKey = core.getInput("anthropic-api-key");
  if (core.getBooleanInput("ai-summary")) config.ai.enabled = true;

  const octokit = github.getOctokit(core.getInput("github-token", { required: true }));
  const { repo } = github.context;
  const info: PullRequestInfo = {
    number: pr.number,
    title: pr.title ?? "",
    body: pr.body ?? "",
    author: pr.user?.login ?? "",
    baseRef: pr.base?.ref ?? "",
    headRef: pr.head?.ref ?? "",
  };

  const files = await listChangedFiles(octokit, repo, info.number);
  core.info(`Checking ${files.length} changed files in #${info.number}`);
  const results = runChecks(files, config, process.env.GITHUB_WORKSPACE);

  let aiSummary: string | undefined;
  let aiNote: string | undefined;
  if (config.ai.enabled) {
    if (!apiKey) {
      aiNote = "no `anthropic-api-key` provided (secrets aren't available to PRs from forks).";
    } else {
      try {
        aiSummary = await generateSummary(new Anthropic({ apiKey }), config.ai, info, files, results);
        if (!aiSummary) aiNote = "the model declined to review this change.";
      } catch (err) {
        // The summary is advisory; an API outage shouldn't block the merge.
        const detail = err instanceof Anthropic.APIError ? `API error ${err.status ?? ""}` : (err as Error).message;
        core.warning(`AI summary failed: ${detail}`);
        aiNote = `request failed (${detail}).`;
      }
    }
  }

  const failed = shouldFail(results, failOn);
  const { serverUrl, runId } = github.context;
  const runUrl = `${serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${runId}`;
  const report = renderReport(results, { failed, aiSummary, aiNote, runUrl });

  await core.summary.addRaw(report).write();
  if (core.getBooleanInput("comment")) {
    const url = await upsertComment(octokit, repo, info.number, fitForComment(report));
    core.info(`Report posted: ${url}`);
  }

  const counts = results.flatMap((r) => r.findings);
  core.setOutput("errors", counts.filter((f) => f.severity === "error").length);
  core.setOutput("warnings", counts.filter((f) => f.severity === "warning").length);
  core.setOutput("passed", !failed);

  if (failed) core.setFailed(`PR Guardian found issues at or above "${failOn}" severity.`);
}

run().catch((err: unknown) => core.setFailed(err instanceof Error ? err.message : String(err)));
