import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const severity = z.enum(["error", "warning", "info"]);

const pathRule = z.object({
  pattern: z.string(),
  reason: z.string().optional(),
  severity: severity.default("warning"),
});

const contentRule = z
  .object({
    id: z.string(),
    /** JavaScript regular expression, matched against each added line. */
    pattern: z.string(),
    /**
     * RegExp flags, e.g. "i" for case-insensitive. "g" and "y" are dropped: each line is
     * tested separately, and with them a match would make the test of the next line skip ahead.
     */
    flags: z
      .string()
      .default("")
      .transform((f) => f.replace(/[gy]/g, "")),
    message: z.string(),
    severity: severity.default("warning"),
    /** Only scan files matching these globs. Empty means all files. */
    files: z.array(z.string()).default([]),
    /** Skip files matching these globs. */
    exclude: z.array(z.string()).default([]),
    /** The rule finds credentials: files it matches are never sent to the AI summary. */
    secret: z.boolean().default(false),
  })
  .superRefine((rule, ctx) => {
    try {
      new RegExp(rule.pattern, rule.flags);
    } catch (err) {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: `rule "${rule.id}": ${(err as Error).message}` });
    }
  });

export const DEFAULT_CONTENT_RULES: z.input<typeof contentRule>[] = [
  {
    id: "aws-access-key",
    pattern: "\\b(AKIA|ASIA)[0-9A-Z]{16}\\b",
    message: "Possible AWS access key committed.",
    severity: "error",
    secret: true,
  },
  {
    id: "private-key",
    pattern: "-----BEGIN (RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----",
    message: "Private key material committed.",
    severity: "error",
    secret: true,
  },
  {
    id: "provider-token",
    // GitHub, GitLab, Slack, Stripe live, Google, npm, Anthropic and OpenAI keys: formats with a
    // fixed prefix, so a match is almost never a false positive.
    pattern:
      "\\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(sk|rk)_live_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|sk-ant-(api|admin)\\d{2}-[A-Za-z0-9_-]{80,}|sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,})",
    message: "Access token or API key committed.",
    severity: "error",
    secret: true,
  },
  {
    id: "hardcoded-secret",
    pattern: "(api[_-]?key|secret|password|token)\\s*[:=]\\s*['\"][^'\"\\s]{8,}['\"]",
    flags: "i",
    message: "Possible hardcoded secret.",
    severity: "error",
    exclude: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**", "**/fixtures/**"],
    secret: true,
  },
  {
    id: "focused-test",
    pattern: "\\b(describe|it|test)\\.only\\(",
    message: "Focused test (`.only`) will skip the rest of the suite.",
    severity: "error",
  },
  {
    id: "debugger",
    pattern: "^\\s*debugger;?\\s*$",
    message: "`debugger` statement left in code.",
    severity: "warning",
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  },
  {
    id: "lint-disable",
    pattern: "eslint-disable|@ts-ignore|# noqa|# type: ignore",
    message: "Lint or type check suppressed.",
    severity: "info",
  },
];

const configSchema = z.object({
  size: z
    .object({
      maxFiles: z.number().int().positive().default(50),
      maxLines: z.number().int().positive().default(1000),
      severity: severity.default("warning"),
      /** Generated and vendored files don't count toward the size limits. */
      ignore: z
        .array(z.string())
        .default(["**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/dist/**", "**/*.snap"]),
    })
    .prefault({}),
  /** Paths that must not be changed by a PR. */
  blockedPaths: z.array(pathRule.extend({ severity: severity.default("error") })).default([]),
  /** Paths whose changes deserve a closer look. */
  sensitivePaths: z
    .array(pathRule)
    .prefault([
      { pattern: ".github/workflows/**", reason: "CI/CD workflow change" },
      { pattern: "**/migrations/**", reason: "Database migration" },
      { pattern: "**/{Dockerfile,docker-compose*.yml}", reason: "Container configuration" },
      { pattern: "**/*.{tf,tfvars}", reason: "Infrastructure change" },
      { pattern: "**/{package.json,requirements.txt,go.mod,Cargo.toml,pom.xml}", reason: "Dependency manifest" },
    ]),
  tests: z
    .object({
      enabled: z.boolean().default(true),
      severity: severity.default("warning"),
      sourcePatterns: z.array(z.string()).default(["src/**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,rb,cs}"]),
      testPatterns: z
        .array(z.string())
        .default([
          "**/*.{test,spec}.*",
          "**/*_test.{go,py}",
          "**/test_*.py",
          "**/__tests__/**",
          "test/**",
          "tests/**",
          "**/src/test/**",
        ]),
      ignore: z.array(z.string()).default(["**/*.d.ts", "**/index.{ts,js}", "**/types.ts"]),
      /** Flag deleted test files. */
      flagDeletedTests: z.boolean().default(true),
    })
    .prefault({}),
  content: z
    .object({
      useDefaults: z.boolean().default(true),
      rules: z.array(contentRule).default([]),
      /** Cap per rule so one noisy pattern can't flood the comment. */
      maxFindingsPerRule: z.number().int().positive().default(10),
    })
    .prefault({}),
  coverage: z
    .object({
      /** istanbul coverage-summary.json or lcov.info, produced by an earlier step. */
      file: z.string().optional(),
      minimum: z.number().min(0).max(100).default(80),
      severity: severity.default("error"),
    })
    .prefault({}),
  lint: z
    .object({
      /** ESLint JSON report (`eslint -f json -o eslint.json`), produced by an earlier step. */
      report: z.string().optional(),
      maxErrors: z.number().int().min(0).default(0),
      maxWarnings: z.number().int().min(0).optional(),
      /** Only count problems in files this PR touched. */
      onlyChangedFiles: z.boolean().default(true),
      severity: severity.default("error"),
    })
    .prefault({}),
  ai: z
    .object({
      enabled: z.boolean().default(false),
      model: z.string().default("claude-opus-5-5"),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
      /** Diff budget sent to the model; files beyond it are listed by name, not silently dropped. */
      maxDiffChars: z.number().int().positive().default(150_000),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type ContentRule = z.infer<typeof contentRule>;

export function parseConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(`Invalid PR Guardian config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Parses config YAML; no text (no file) means "use defaults". */
export function parseConfigText(text: string | undefined): Config {
  return parseConfig(text === undefined ? {} : parseYaml(text));
}

/** Loads config from a local YAML file; a missing file means "use defaults". */
export function loadConfig(path: string): Config {
  return parseConfigText(existsSync(path) ? readFileSync(path, "utf8") : undefined);
}

/** Default rules first, then user rules; a user rule with the same id replaces the default. */
export function effectiveContentRules(config: Config): ContentRule[] {
  const user = config.content.rules;
  if (!config.content.useDefaults) return user;
  const userIds = new Set(user.map((r) => r.id));
  const defaults = DEFAULT_CONTENT_RULES.filter((r) => !userIds.has(r.id)).map((r) => contentRule.parse(r));
  return [...defaults, ...user];
}
