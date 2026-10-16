import type { Config } from "../config.js";
import type { ChangedFile, CheckResult } from "../types.js";
import { checkContent } from "./content.js";
import { checkCoverage } from "./coverage.js";
import { checkLint } from "./lint.js";
import { checkPaths } from "./paths.js";
import { checkSize } from "./size.js";
import { checkTests } from "./tests.js";

export function runChecks(files: ChangedFile[], config: Config, workspace?: string): CheckResult[] {
  return [
    checkSize(files, config),
    checkPaths(files, config),
    checkTests(files, config),
    checkContent(files, config),
    checkCoverage(config),
    checkLint(files, config, workspace),
  ];
}
