import { minimatch } from "minimatch";

export function matchesAny(file: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => minimatch(file, p, { dot: true }));
}
