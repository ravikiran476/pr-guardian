# PR Guardian

A GitHub Action that checks every pull request against configurable quality rules and posts one report comment, which it updates on each push.

| Check | What it does |
|---|---|
| **PR size** | Flags PRs over a file or line limit. Lockfiles, `dist/` and snapshots don't count. |
| **Protected paths** | Blocks changes to paths you list and flags sensitive ones (workflows, migrations, Dockerfiles, Terraform, dependency manifests). Renames are checked under both names. |
| **Tests** | Flags each changed source file that has no matching test change (`auth.ts` ↔ `auth.test.ts`, `handler_test.go`, `test_models.py`), and flags deleted tests. |
| **Risky content** | Scans *added* lines for hardcoded secrets, AWS keys, private keys, `.only` tests, `debugger`, and lint suppressions, plus your own regex rules. |
| **Coverage** | Enforces a minimum line coverage from an istanbul `coverage-summary.json` or `lcov.info`. |
| **Lint** | Enforces error and warning limits from an ESLint JSON report, counting only files the PR touched. |
| **AI summary** *(optional)* | A short Claude-written review: what changed, risks, and suggestions. It's advisory and never fails the run. |

Every finding has a severity (`error`, `warning` or `info`). The run fails when any finding is at or above `fail-on`.

## Usage

```yaml
# .github/workflows/pr-guardian.yml
name: PR Guardian
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  guardian:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci

      # Optional: produce the reports PR Guardian reads.
      - run: npx vitest run --coverage --coverage.reporter=json-summary
        continue-on-error: true
      - run: npx eslint . -f json -o eslint.json
        continue-on-error: true

      - uses: ravikiran476/pr-guardian@v1
        with:
          coverage-file: coverage/coverage-summary.json
          lint-report: eslint.json
          ai-summary: true
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

PR Guardian doesn't run your tests or linter itself. Any earlier step that writes a supported report works, whatever the language. `continue-on-error` lets those steps fail without stopping the job, so the report still covers them.

### Inputs

| Input | Default | Description |
|---|---|---|
| `github-token` | `github.token` | Needs `pull-requests: write` to comment. |
| `config-path` | `.github/pr-guardian.yml` | YAML config. Defaults apply when the file is missing. |
| `fail-on` | `error` | `error`, `warning`, `info`, or `never`. |
| `comment` | `true` | Post or update the PR comment. The job summary is always written. |
| `coverage-file` | | Overrides `coverage.file`. |
| `lint-report` | | Overrides `lint.report`. |
| `ai-summary` | `false` | Turns on the AI summary (same as `ai.enabled: true` in the config). |
| `anthropic-api-key` | | Required for the AI summary. |

Outputs: `errors`, `warnings`, `passed`.

## Configuration

Every key is optional. See [`.github/pr-guardian.yml`](.github/pr-guardian.yml) for an annotated example and [`src/config.ts`](src/config.ts) for every option and its default.

```yaml
size: { maxFiles: 50, maxLines: 1000, severity: warning }

blockedPaths:
  - pattern: "config/production/**"
    reason: "managed by ops"

tests:
  sourcePatterns: ["src/**/*.ts"]
  testPatterns: ["**/*.test.ts"]
  severity: error            # make missing tests block the merge

content:
  rules:
    - id: no-console
      pattern: "console\\.log\\("
      message: "Remove console.log"
      files: ["src/**"]

coverage: { minimum: 85 }
lint: { maxErrors: 0, maxWarnings: 10 }

ai:
  enabled: true
  model: claude-opus-5-5
  effort: medium             # low | medium | high | xhigh | max
  maxDiffChars: 150000
```

A custom content rule with the same `id` as a built-in rule replaces it. Set `content.useDefaults: false` to drop all the built-in rules.

## AI summary

The summary uses the Anthropic API (`@anthropic-ai/sdk`) with `claude-opus-5-5` by default. It sends the PR title, description, check results and diff. When the diff is over `maxDiffChars`, whole files are left out, smallest-first packing fits in as many as possible, and the files left out are listed by name to the model so it doesn't guess about them. If the model declines, or the API call fails, the report says so and the run continues.

Security notes:

- The PR description and diff are written by the PR author. The prompt marks them as untrusted data, and the summary has no effect on pass/fail, so prompt injection can't change the outcome of a run.
- Use the `pull_request` trigger, not `pull_request_target`. With `pull_request`, PRs from forks don't get your secrets. The AI summary is skipped for them, with a note, and every other check still runs.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build        # bundles to dist/index.js, which the action runs
```

`dist/` is committed because GitHub runs the action straight from the repo. CI fails if `dist/` is out of date with `src/`.

```
src/
  main.ts         entrypoint: reads inputs, runs checks, posts the report
  config.ts       config schema (zod) and defaults
  checks/         one module per check, all pure functions over the changed files
  ai.ts           Claude summary and diff budgeting
  report.ts       Markdown rendering and the pass/fail decision
  github.ts       listing PR files and creating or updating the comment
```
