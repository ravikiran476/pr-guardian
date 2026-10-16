export interface AddedLine {
  /** Line number in the new version of the file. */
  line: number;
  text: string;
}

/** Extracts added lines (with new-file line numbers) from a unified diff patch. */
export function addedLines(patch: string | undefined): AddedLine[] {
  if (!patch) return [];
  const result: AddedLine[] = [];
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+")) {
      result.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith(" ")) {
      newLine++;
    }
    // "-" lines and "\ No newline at end of file" don't advance the new-file counter.
  }
  return result;
}
