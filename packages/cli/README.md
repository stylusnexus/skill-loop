# @stylusnexus/skill-loop-cli

CLI and MCP server for self-improving AI coding tool skills.

Skills are static prompt files. Codebases are not. **skill-loop** closes the feedback loop so skills improve automatically when they degrade.

```
SKILL --> RUN --> OBSERVE --> INSPECT --> FIX
  ^                                       |
  +---------------------------------------+
```

## Which package do I need?

This is the one. **Most users only need `@stylusnexus/skill-loop-cli`.**

| Package | What it is | Who it's for |
|---------|-----------|-------------|
| **`@stylusnexus/skill-loop-cli`** (this package) | CLI + MCP server | **Most users.** Use skill-loop from the terminal or connect it to Claude Code, Cursor, Windsurf, or any MCP-compatible tool. |
| [`@stylusnexus/skill-loop`](https://www.npmjs.com/package/@stylusnexus/skill-loop) | Core library | Developers building custom integrations or plugins on top of skill-loop. |

This package includes the core library as a dependency, so you get everything in one install.

## Install

```bash
npm install -g @stylusnexus/skill-loop-cli
```

## Quick start

```bash
skill-loop init     # Scan for skills, create .skill-telemetry/
skill-loop status   # Health dashboard
skill-loop inspect  # Find problems
skill-loop amend    # Auto-fix degraded skills
```

## Setup by tool

### Claude Code

**Option A: MCP server (recommended)**

Add to `.mcp.json` in your project root:

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

Then ask Claude: **"Initialize skill-loop"** -- the MCP server handles everything from there.

**Option B: Hooks (automatic observation)**

```bash
npx skill-loop init
# Auto-detection hooks are not configured.
# Add auto-detection hooks to .claude/settings.json? [Y/n]
```

Or configure manually in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": ".*",
      "command": "npx skill-loop-claude pre-hook"
    }],
    "PostToolUse": [{
      "matcher": ".*",
      "command": "npx skill-loop-claude post-hook"
    }]
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

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

### Windsurf

Add to your Windsurf MCP config:

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

### Any MCP-compatible tool

```json
{
  "command": "npx",
  "args": ["-y", "-p", "@stylusnexus/skill-loop-cli", "skill-loop-mcp"]
}
```

## MCP server commands

Once configured, talk to skill-loop in natural language:

| You say | What happens |
|---------|-------------|
| `skill-loop scan` | Scans for SKILL.md files and registers them |
| `skill-loop status` | Health dashboard: skill count, runs, failure rate |
| `skill-loop review` | Analyzes skills for failure patterns and staleness |
| `skill-loop fix` | Proposes amendments for broken skills |
| `skill-loop fix --dry-run` | Preview fixes without modifying anything |
| `skill-loop list` | Shows all registered skills |
| `skill-loop runs` | Shows recent skill run activity |
| `skill-loop detection` | Shows detection stats and active sessions |

## CLI reference

```bash
npx skill-loop --help
```

| Command | Description |
|---------|-------------|
| `init` | Scan for skills, create `.skill-telemetry/`, update `.gitignore` |
| `status` | Health dashboard (skill count, run totals, failure rate) |
| `log <skill> <outcome>` | Manually log a skill run |
| `inspect` | Full analysis with pattern detection and staleness scoring |
| `amend` | Generate amendments for flagged skills |
| `evaluate <id>` | Test a proposed amendment against recent failures |
| `rollback <id>` | Revert a merged amendment via `git revert` |
| `gc` | Prune runs older than configured retention |
| `sessions` | Show active detection sessions |
| `detect <tool> [k=v]` | Dry-run detection against a hypothetical tool call |
| `doctor` | Audit cross-file referential integrity |
| `serve` | Start MCP server (stdio) |

## How it works

1. **Observe** -- Auto-detects skill usage via tiered confidence scoring
2. **Inspect** -- Finds failure patterns, stale references, content drift
3. **Amend** -- Proposes targeted SKILL.md patches on isolated git branches
4. **Evaluate** -- Tests amendments against recent failures before merging

## Security

- All data is local-only in `.skill-telemetry/` (gitignored)
- No network calls, no telemetry, no analytics
- Git operations are always local -- never pushes
- Amendments live on isolated branches until you merge them

## Packages

| Package | Description |
|---------|-------------|
| [`@stylusnexus/skill-loop-cli`](https://www.npmjs.com/package/@stylusnexus/skill-loop-cli) | This package -- CLI + MCP server |
| [`@stylusnexus/skill-loop`](https://www.npmjs.com/package/@stylusnexus/skill-loop) | Core library for custom integrations |

## Full documentation

See the [GitHub repository](https://github.com/stylusnexus/skill-loop) for complete documentation and configuration options.

## License

MIT
