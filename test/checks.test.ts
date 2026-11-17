import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfigChange } from "../src/checks/config.js";
import { checkContent } from "../src/checks/content.js";
import { checkCoverage, parseCoverage } from "../src/checks/coverage.js";
import { checkLint } from "../src/checks/lint.js";
import { checkPaths } from "../src/checks/paths.js";
import { checkSize } from "../src/checks/size.js";
import { checkTests, stem } from "../src/checks/tests.js";
import { parseConfig, parseConfigText } from "../src/config.js";
import { addedLines } from "../src/diff.js";
import { readFileAtRef } from "../src/github.js";
import type { ChangedFile } from "../src/types.js";

const file = (filename: string, overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  filename,
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: "@@ -1,1 +1,2 @@\n context\n+added",
  ...overrides,
});

const tmp = () => mkdtempSync(join(tmpdir(), "pr-guardian-"));

describe("addedLines", () => {
  it("tracks new-file line numbers across hunks", () => {
    const patch = ["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c", "@@ -10,2 +10,3 @@", " x", "+y", "+z"].join("\n");
    expect(addedLines(patch)).toEqual([
      { line: 2, text: "B" },
      { line: 11, text: "y" },
      { line: 12, text: "z" },
    ]);
  });

  it("returns nothing for a missing patch", () => {
    expect(addedLines(undefined)).toEqual([]);
  });
});

describe("checkSize", () => {
  it("flags PRs over the line limit and ignores lockfiles", () => {
    const config = parseConfig({ size: { maxLines: 100 } });
    const files = [file("src/a.ts", { additions: 80 }), file("package-lock.json", { additions: 5000 })];
    expect(checkSize(files, config).findings).toEqual([]);
    files.push(file("src/b.ts", { additions: 30 }));
    expect(checkSize(files, config).findings).toHaveLength(1);
  });
});

describe("checkPaths", () => {
  it("blocks configured paths, including the old name of a rename", () => {
    const config = parseConfig({ blockedPaths: [{ pattern: "secrets/**" }], sensitivePaths: [] });
    const result = checkPaths([file("public/key.txt", { status: "renamed", previousFilename: "secrets/key.txt" })], config);
    expect(result.findings).toMatchObject([{ check: "blocked-path", severity: "error" }]);
  });

  it("flags workflow changes as sensitive by default", () => {
    const result = checkPaths([file(".github/workflows/deploy.yml")], parseConfig({}));
    expect(result.findings).toMatchObject([{ check: "sensitive-path", severity: "warning" }]);
  });
});

describe("checkConfigChange", () => {
  it("warns when a PR edits, adds or renames away PR Guardian's own config", () => {
    const path = ".github/pr-guardian.yml";
    expect(checkConfigChange([file("src/a.ts")], path)).toBeUndefined();
    expect(checkConfigChange([file(path)], path)?.findings).toMatchObject([{ check: "config-changed", severity: "warning", file: path }]);
    expect(checkConfigChange([file("old.yml", { status: "renamed", previousFilename: path })], path)).toBeDefined();
  });
});

describe("checkTests", () => {
  it("normalizes test file names to their source stem", () => {
    expect(stem("src/user-service.ts")).toBe("user-service");
    expect(stem("test/user-service.test.ts")).toBe("user-service");
    expect(stem("pkg/handler_test.go")).toBe("handler");
    expect(stem("tests/test_models.py")).toBe("models");
  });

  it("flags source changes without a matching test change", () => {
    const files = [file("src/auth.ts"), file("src/billing.ts"), file("test/auth.test.ts")];
    const result = checkTests(files, parseConfig({}));
    expect(result.findings.map((f) => f.file)).toEqual(["src/billing.ts"]);
  });

  it("flags deleted tests and ignores deleted sources", () => {
    const files = [file("src/old.ts", { status: "removed" }), file("test/old.test.ts", { status: "removed" })];
    expect(checkTests(files, parseConfig({})).findings).toMatchObject([{ check: "deleted-test" }]);
  });
});

describe("checkContent", () => {
  const withLine = (filename: string, line: string) => file(filename, { patch: `@@ -0,0 +1,1 @@\n+${line}` });

  it("catches secrets and focused tests in added lines", () => {
    const files = [
      withLine("src/config.ts", `const apiKey = "sk_live_abcdef123456";`),
      withLine("src/aws.ts", "const id = 'AKIAABCDEFGHIJKLMNOP';"),
      withLine("test/a.test.ts", "it.only('runs alone', () => {});"),
    ];
    const ids = checkContent(files, parseConfig({})).findings.map((f) => f.check);
    expect(ids).toEqual(expect.arrayContaining(["hardcoded-secret", "aws-access-key", "focused-test"]));
  });

  it("does not flag removed lines", () => {
    const f = file("src/a.ts", { patch: "@@ -1,1 +0,0 @@\n-debugger;" });
    expect(checkContent([f], parseConfig({})).findings).toEqual([]);
  });

  it("reports every matching line whatever flags a rule has", () => {
    const patch = ["@@ -0,0 +1,6 @@", ...Array.from({ length: 6 }, (_, i) => `+console.log(${i})`)].join("\n");
    for (const flags of ["", "i", "g", "gi", "gy"]) {
      const config = parseConfig({ content: { useDefaults: false, rules: [{ id: "no-console", pattern: "console\\.log\\(", flags, message: "x" }] } });
      expect(checkContent([file("src/a.ts", { patch })], config).findings.map((f) => f.line), `flags "${flags}"`).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it("finds common provider tokens", () => {
    const tokens = ["ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", "xoxb-" + "1234567890-abcdefghij", "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"];
    const files = tokens.map((t, i) => withLine(`src/t${i}.ts`, `const t = ${t};`));
    expect(checkContent(files, parseConfig({})).findings.filter((f) => f.check === "provider-token")).toHaveLength(3);
  });

  it("lets a user rule replace a default with the same id, and caps findings per rule", () => {
    const config = parseConfig({
      content: { maxFindingsPerRule: 2, rules: [{ id: "debugger", pattern: "TODO", message: "todo" }] },
    });
    const patch = "@@ -0,0 +1,4 @@\n+TODO 1\n+TODO 2\n+TODO 3\n+debugger;";
    const findings = checkContent([file("src/a.ts", { patch })], config).findings.filter((f) => f.check === "debugger");
    expect(findings).toHaveLength(3);
    expect(findings[2]!.message).toContain("1 more");
  });
});

describe("coverage", () => {
  it("parses istanbul json-summary and lcov", () => {
    expect(parseCoverage(JSON.stringify({ total: { lines: { pct: 87.5 } } }))).toBe(87.5);
    expect(parseCoverage("SF:a.ts\nLF:10\nLH:5\nend_of_record\nSF:b.ts\nLF:10\nLH:10\nend_of_record\n")).toBe(75);
  });

  it("fails below the threshold and warns when the report is missing", () => {
    const dir = tmp();
    const path = join(dir, "summary.json");
    writeFileSync(path, JSON.stringify({ total: { lines: { pct: 70 } } }));
    expect(checkCoverage(parseConfig({ coverage: { file: path, minimum: 80 } })).findings).toMatchObject([
      { severity: "error" },
    ]);
    expect(checkCoverage(parseConfig({ coverage: { file: join(dir, "nope.json") } })).findings).toMatchObject([
      { severity: "warning" },
    ]);
    expect(checkCoverage(parseConfig({})).skipped).toBe(true);
  });
});

describe("checkLint", () => {
  it("counts only problems in changed files by default", () => {
    const dir = tmp();
    const report = join(dir, "eslint.json");
    writeFileSync(
      report,
      JSON.stringify([
        { filePath: join(dir, "src/a.ts"), messages: [{ ruleId: "no-unused-vars", severity: 2, message: "x unused", line: 3 }] },
        { filePath: join(dir, "src/untouched.ts"), messages: [{ ruleId: "eqeqeq", severity: 2, message: "use ===" }] },
      ]),
    );
    const result = checkLint([file("src/a.ts")], parseConfig({ lint: { report } }), dir);
    expect(result.detail).toBe("1 errors, 0 warnings in changed files");
    expect(result.findings[0]).toMatchObject({ severity: "error", message: "1 lint errors (max 0)." });
    expect(result.findings[1]).toMatchObject({ file: "src/a.ts", line: 3 });
  });
});

describe("parseConfig", () => {
  it("rejects invalid config with a readable error", () => {
    expect(() => parseConfig({ coverage: { minimum: 150 } })).toThrow(/coverage\.minimum/);
  });

  it("rejects a content rule whose pattern is not a valid regular expression", () => {
    expect(() => parseConfig({ content: { rules: [{ id: "bad", pattern: "([a-z", message: "x" }] } })).toThrow(
      /Invalid PR Guardian config[\s\S]*rule "bad": Invalid regular expression[\s\S]*at content\.rules\[0\]\.pattern/,
    );
  });

  it("reads YAML text, and treats a missing file as defaults", () => {
    expect(parseConfigText(undefined).size.maxFiles).toBe(50);
    expect(parseConfigText("size: { maxFiles: 3 }\n").size.maxFiles).toBe(3);
  });
});

describe("readFileAtRef", () => {
  const octokit = (impl: (args: { path: string; ref: string }) => unknown) =>
    ({ rest: { repos: { getContent: async (args: { path: string; ref: string }) => ({ data: impl(args) }) } } }) as never;

  it("reads the config as it is on the base commit", async () => {
    const calls: string[] = [];
    const text = await readFileAtRef(
      octokit(({ path, ref }) => {
        calls.push(`${path}@${ref}`);
        return { type: "file", content: Buffer.from("tests: { enabled: false }\n").toString("base64") };
      }),
      { owner: "o", repo: "r" },
      ".github/pr-guardian.yml",
      "base123",
    );
    expect(calls).toEqual([".github/pr-guardian.yml@base123"]);
    expect(parseConfigText(text).tests.enabled).toBe(false);
  });

  it("returns undefined when the file does not exist on the base branch", async () => {
    const missing = octokit(() => {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    });
    expect(await readFileAtRef(missing, { owner: "o", repo: "r" }, "x.yml", "s")).toBeUndefined();
    const denied = octokit(() => {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    });
    await expect(readFileAtRef(denied, { owner: "o", repo: "r" }, "x.yml", "s")).rejects.toThrow("Forbidden");
  });
});
