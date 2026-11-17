# Changelog

`@v1` always points at the latest 1.x release. Pin a full version (`@v1.1.0`) to opt out of updates.

## 1.1.0

### Security

- The config is read from the pull request's base branch instead of the PR's checkout, so a PR can no longer switch off the checks that judge it. A PR that changes the config gets a "Guardian config" warning; the change applies after merge.
- Files in which a secret rule matched are never sent to the AI summary. Rules can be marked `secret: true`.
- Author-written text (title, description, diff) can no longer close the prompt's `<pull_request>` block.
- New built-in `provider-token` rule: GitHub, GitLab, Slack, Stripe live, Google, npm, Anthropic and OpenAI keys. The AWS and private key rules cover more formats.

### Fixes

- On PRs from forks the token is read-only, and the failed comment used to fail the whole run before the outputs were set. The comment is now skipped with a warning; outputs are set first and the job summary has the report.
- Content rules with the `g` or `y` flag skipped every other matching line. Those flags are ignored now.
- A content rule with an invalid regular expression fails config validation with the rule's name, instead of crashing with a bare `SyntaxError`.
- The AI note tells a refusal, an output-token-limit stop and an empty reply apart, and a summary cut short by the limit is shown with a caveat.

### Dependencies

- minimatch 11 (fixes a moderate denial-of-service advisory).

## 1.0.0

First release.
