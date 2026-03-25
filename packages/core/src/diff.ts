/**
 * Create a simple unified diff representation between two strings.
 * Not a full unified diff — just enough to be human-readable in amendment records.
 */
export function createUnifiedDiff(original: string, modified: string, filePath: string): string {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  // Simple line-by-line diff
  const maxLen = Math.max(origLines.length, modLines.length);
  let inHunk = false;
  let hunkStart = -1;

  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const mod = modLines[i];

    if (orig !== mod) {
      if (!inHunk) {
        // Start a new hunk with some context
        const contextStart = Math.max(0, i - 2);
        lines.push(`@@ -${contextStart + 1} +${contextStart + 1} @@`);
        for (let j = contextStart; j < i; j++) {
          if (origLines[j] !== undefined) lines.push(` ${origLines[j]}`);
        }
        inHunk = true;
        hunkStart = i;
      }
      if (orig !== undefined) lines.push(`-${orig}`);
      if (mod !== undefined) lines.push(`+${mod}`);
    } else if (inHunk) {
      lines.push(` ${orig ?? ''}`);
      // End hunk after 10 lines of context
      if (i - hunkStart > 10) {
        inHunk = false;
      }
    }
  }

  return lines.join('\n');
}
