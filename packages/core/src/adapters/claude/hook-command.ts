export type ClaudeHookEvent = 'pre-hook' | 'post-hook';

// Hooks fire on every tool call, and npx spends ~0.35s resolving the package
// each time. A globally installed binary starts in ~0.05s, so prefer it and
// keep npx only for machines without one. if/else rather than `a || b`: a
// pre-hook that blocks a tool exits non-zero, and `||` would rerun it via npx.
export function claudeHookCommand(event: ClaudeHookEvent): string {
  return `if command -v skill-loop-claude >/dev/null 2>&1; then skill-loop-claude ${event}; else npx --package=@stylusnexus/skill-loop skill-loop-claude ${event}; fi`;
}
