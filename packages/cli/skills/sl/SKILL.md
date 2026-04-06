---
name: sl
description: Manage and maintain AI coding skills via the skill-loop MCP server. Scan, inspect, review, fix, and monitor skill health.
---

# sl (skill-loop)

Route the user's request to the `skill_loop` MCP tool. This skill is a convenience wrapper -- all actions are handled by the MCP server.

## Usage

`/sl <action>` where action is one of:

| Action | What it does |
|--------|-------------|
| `scan` | Scan for SKILL.md files and register them |
| `status` | Health dashboard: skill count, runs, failure rate |
| `review` | Analyze all skills for failure patterns and staleness |
| `fix` | Propose amendments for broken skills (creates a git branch) |
| `fix --dry-run` | Preview fixes without modifying anything |
| `list` | Show all registered skills with metadata |
| `runs` | Show recent skill run activity |
| `history` | List past amendments and their status |
| `detection` | Show detection stats and active sessions |
| `gc` | Prune old run data |

## How to handle

1. Parse the action from the user's input (everything after `/sl`)
2. Call the `skill_loop` MCP tool with `action` set to the parsed action
3. Present the results to the user

If no action is provided, default to `status`.

If the MCP server is not connected, tell the user to add this to their `.mcp.json`:

```json
{
  "mcpServers": {
    "skill-loop": {
      "command": "npx",
      "args": ["-y", "-p", "@stylusnexus/skill-loop-cli", "skill-loop-mcp"]
    }
  }
}
```
