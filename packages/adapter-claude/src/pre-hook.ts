/**
 * Claude Code PreToolUse hook handler.
 *
 * Reads hook input from stdin (JSON with tool_name, tool_input),
 * starts a run timer, and writes the pre-invocation context
 * to a temp file for the post-hook to pick up.
 */
export async function preHook(): Promise<void> {
  // TODO: Phase 1 implementation
  // 1. Read stdin JSON from Claude Code hook system
  // 2. Extract skill name from tool_input
  // 3. Look up skill in registry to get skillId + version
  // 4. Write pre-run context to .skill-telemetry/.pending/<uuid>.json
}
