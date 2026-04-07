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

Then **initialize** -- this is required before anything else works:

```bash
skill-loop init
```

This scans for skills, creates `.skill-telemetry/`, offers to configure Claude Code hooks, and installs the `/sl` slash command.

## Quick start

Once initialized, use the `/sl` slash command or CLI directly:

```bash
/sl status          # Health dashboard (slash command)
/sl review          # Inspect for problems
/sl fix             # Auto-fix degraded skills
```

```bash
skill-loop status   # Same thing from the CLI
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

Then ask Claude: **"Initialize skill-loop"** and you'll see:

```
❯ Run skill-loop init

⏺ skill-loop - skill_loop_init (MCP)

⏺ Skill-loop initialized successfully. 27 skills registered in
  .skill-telemetry/ with file and tool references indexed.

  The output suggests adding pre/post hooks to .claude/settings.json
  for auto-detection. Want me to set those up, or are you just
  initializing the registry for now?
```

Say **"Yes, set those up"** and Claude configures the hooks automatically:

```
❯ Yes, set those up

⏺ Update(.claude/settings.json)
  Added skill-loop hooks:
  - PreToolUse (.*): npx skill-loop-claude pre-hook
  - PostToolUse (.*): npx skill-loop-claude post-hook

⏺ Done. These will run on every tool invocation, enabling
  skill-loop's auto-detection and telemetry collection.
```

From there, Claude can run `skill-loop status`, `skill-loop review`, or `skill-loop fix` conversationally.

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
      "hooks": [{ "type": "command", "command": "npx skill-loop-claude pre-hook" }]
    }],
    "PostToolUse": [{
      "matcher": ".*",
      "hooks": [{ "type": "command", "command": "npx skill-loop-claude post-hook" }]
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

## Commands

Use `/sl` (slash command) or talk to skill-loop naturally:

| Command | What happens |
|---------|-------------|
| `/sl scan` | Scans for SKILL.md files and registers them |
| `/sl status` | Health dashboard: skill count, runs, failure rate |
| `/sl review` | Analyzes skills for failure patterns and staleness |
| `/sl fix` | Proposes fixes -- you pick which to apply |
| `/sl rollback <name>` | Undo a fix by restoring from backup |
| `/sl list` | Shows all registered skills (local vs installed) |
| `/sl runs` | Shows recent skill run activity |
| `/sl history` | Lists past amendments and their status |
| `/sl detection` | Shows detection stats and active sessions |
| `/sl gc` | Prune old run data |

### Fix workflow

`/sl fix` uses a two-phase conversational flow:

1. **Diagnose** -- shows flagged skills with severity and proposed changes (no files modified)
2. **Apply** -- you pick which fixes to apply ("all", specific names, or "none")
3. Fixes are written directly to SKILL.md files with automatic backups
4. **Rollback** -- undo any fix with `/sl rollback <name>`

No git branches, no commands to memorize. Works in Claude Code, Claude.ai, Cursor, Codex, Copilot.

## CLI reference

```bash
npx skill-loop --help
```

| Command | Description |
|---------|-------------|
| `init` | Scan for skills, configure MCP + hooks + `/sl` skill |
| `status` | Health dashboard (skill count, run totals, failure rate) |
| `log <skill> <outcome>` | Manually log a skill run |
| `inspect` | Full analysis with pattern detection and staleness scoring |
| `amend` | Generate amendments for flagged skills (branch mode) |
| `evaluate <id>` | Test a proposed amendment against recent failures |
| `rollback <id>` | Revert a merged amendment |
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

## Troubleshooting

### "could not determine executable to run"

Use the `-p` flag with npx for scoped packages:

```bash
npx -y -p @stylusnexus/skill-loop-cli skill-loop init
```

### MCP server not picking up new version

npx caches packages. Re-run init to update the version-pinned `.mcp.json`:

```bash
npx -y -p @stylusnexus/skill-loop-cli@latest skill-loop init
```

Then `/mcp` reconnect in Claude Code.

### "Invalid Settings" / hook format errors

Re-run `skill-loop init` to write hooks in the correct format. Or manually use:

```json
{
  "matcher": ".*",
  "hooks": [{ "type": "command", "command": "npx skill-loop-claude pre-hook" }]
}
```

### Only finding some skills

Re-run `/sl scan` after updating. skill-loop scans both `~/.claude/skills/` and `~/.claude/agents/` (global) plus project-local `.claude/skills/`.

### Hook errors on every tool call

Run `skill-loop init` first to create `.skill-telemetry/`. Hooks fail silently if the telemetry directory doesn't exist.

### `/skill-loop` triggers the wrong skill

Use `/sl` instead. The `skill-loop` name collides with an existing `loop` skill in some setups.

## Full documentation

See the [GitHub repository](https://github.com/stylusnexus/skill-loop) for complete documentation and configuration options.

## License

MIT
