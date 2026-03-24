/**
 * Claude Code PostToolUse hook handler.
 *
 * Reads hook output from stdin (JSON with tool_name, tool_result),
 * matches against a pending pre-hook context, determines outcome,
 * and appends a SkillRun entry to runs.jsonl.
 */
export async function postHook(): Promise<void> {
  // TODO: Phase 1 implementation
  // 1. Read stdin JSON from Claude Code hook system
  // 2. Find matching pending context from .skill-telemetry/.pending/
  // 3. Determine outcome (success/failure) from tool_result
  // 4. Calculate durationMs
  // 5. Append SkillRun to runs.jsonl via TelemetryWriter
  // 6. Clean up pending context file
}
