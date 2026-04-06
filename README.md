# @stylusnexus/skill-loop

Self-improving skills for AI coding tools.

Skills are static prompt files. Codebases are not. **skill-loop** closes the feedback loop so skills improve automatically when they degrade.

```
SKILL --> RUN --> OBSERVE --> INSPECT --> FIX
  ^                                       |
  +---------------------------------------+
```

## What it does

1. **Observe** -- Automatically detects and logs skill usage via tiered confidence scoring -- no explicit logging required
2. **Inspect** -- Detects failure patterns, staleness (dead file references), content drift, routing errors, and usage trends
3. **Amend** -- Proposes targeted SKILL.md patches grounded in evidence from past runs
4. **Evaluate** -- Tests amendments against recent failure cases on a git branch before any human sees a PR
5. **Update/Rollback** -- Merges improvements via PR; rolls back if post-merge monitoring shows regression

## Packages

There are two packages. Most users only need the CLI.

| Package | What it is | When to use it |
|---------|-----------|----------------|
| [`@stylusnexus/skill-loop-cli`](https://www.npmjs.com/package/@stylusnexus/skill-loop-cli) | CLI + MCP server | **Most users.** Install this to use skill-loop from the command line or as an MCP server in any AI tool. |
| [`@stylusnexus/skill-loop`](https://www.npmjs.com/package/@stylusnexus/skill-loop) | Core library | Building a custom integration or plugin on top of skill-loop. Not needed if you're using the CLI. |

`skill-loop-cli` depends on `skill-loop` (core), so installing the CLI gives you everything.

## Quick start

```bash
npm install -g @stylusnexus/skill-loop-cli
```

Then **initialize** -- this is required before anything else works:

```bash
skill-loop init
```

This scans for skills, creates `.skill-telemetry/`, offers to configure Claude Code hooks, and installs the `/sl` slash command.

Once initialized:

```bash
/sl status          # Health dashboard (slash command)
/sl review          # Inspect for problems
/sl fix             # Auto-fix degraded skills
```

Or from the CLI:

```bash
skill-loop status   # Health dashboard
skill-loop inspect  # Find problems
skill-loop amend    # Auto-fix degraded skills
```

## Installation by tool

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

For automatic skill run tracking, run init and say yes when it offers to configure hooks:

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

The hooks auto-detect skill usage via confidence scoring -- no explicit `Skill` tool call required.

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

The MCP server works with any tool that supports the Model Context Protocol. The config is always the same:

```json
{
  "command": "npx",
  "args": ["-y", "-p", "@stylusnexus/skill-loop-cli", "skill-loop-mcp"]
}
```

### Codex / Copilot (programmatic)

For tools without MCP support, use the core library directly:

```bash
npm install @stylusnexus/skill-loop
```

```typescript
import { logSkillRun } from '@stylusnexus/skill-loop';

await logSkillRun({
  skillName: 'my-skill',
  platform: 'codex',  // or 'copilot'
  outcome: 'success',
  taskContext: 'refactor auth module',
});
```

## MCP server commands

Once configured, talk to skill-loop in natural language:

| You say | What happens |
|---------|-------------|
| `skill-loop scan` | Scans your project for SKILL.md files and registers them |
| `skill-loop status` | Shows health dashboard: skill count, runs, failure rate |
| `skill-loop review` | Analyzes all skills for failure patterns, staleness, and trends |
| `skill-loop fix` | Proposes amendments for broken skills (creates a git branch) |
| `skill-loop fix --dry-run` | Preview fixes without modifying anything |
| `skill-loop list` | Shows all registered skills with metadata |
| `skill-loop runs` | Shows recent skill run activity |
| `skill-loop history` | Lists past amendments and their status |
| `skill-loop detection` | Shows detection stats and active sessions |
| `skill-loop gc` | Prunes old run data |

Individual MCP tools are also available for programmatic use:

| Tool | Description |
|------|-------------|
| `skill_loop_init` | Initialize: scan skills, create registry |
| `skill_loop_status` | Health dashboard: skill count, run totals, failure rates |
| `skill_loop_list` | List all registered skills with metadata and broken references |
| `skill_loop_log` | Record a skill run outcome (success/failure/partial) |
| `skill_loop_runs` | Query run history, filter by skill name or outcome |
| `skill_loop_inspect` | Analyze run patterns, detect staleness, flag degrading skills |
| `skill_loop_amend` | Propose and apply SKILL.md fixes (creates git branch, never modifies working branch) |
| `skill_loop_evaluate` | Score an amendment against baseline and accept/reject |
| `skill_loop_amendments` | List amendment history with status filter |

## How it works

### 1. Scan your skills

skill-loop reads SKILL.md files from your configured paths (default: `.claude/skills/` and `.claude/agents/`). It extracts:

- **Name and description** from YAML frontmatter
- **Referenced files** (backtick-quoted paths in the skill body)
- **Referenced tools** (Claude Code tool names like Bash, Grep, Read)

Each skill gets a stable UUID that persists across rescans.

### 2. Detect and log runs automatically

skill-loop auto-detects skill usage via a tiered confidence scoring system. Every tool call is evaluated against multiple signals:

| Signal | Confidence | Description |
|--------|------------|-------------|
| `Skill` tool invoked explicitly | 1.0 | Direct invocation via the Skill tool |
| `Read` of a registered SKILL.md | 0.9 | Agent reads a skill file before executing |
| Tool call matches `triggerPatterns` + `referencedTools` | 0.6 | Tool usage fingerprint matches a registered skill |
| Files touched overlap `referencedFiles` | 0.5 | Reserved for future use |

Runs are only logged when composite confidence exceeds a configurable threshold (default: 0.6).

### 3. Detect problems

The inspector analyzes run history to find:
- Skills with high failure rates
- Skills that get selected for wrong tasks (negative feedback)
- Stale references to files/tools that no longer exist
- **Content drift** -- referenced directories have changed significantly since the skill was last modified, suggesting the skill's domain knowledge may be outdated
- Dead skills with zero recent invocations

### 4. Fix automatically

When a pattern is detected, the amender:
1. Drafts a targeted SKILL.md patch (fix broken references, tighten triggers, add failure context, or flag content drift)
2. Creates a git branch
3. Evaluates the amendment against recent failures
4. Opens a PR with evaluation results if it improves things
5. You review and merge (or it auto-rolls back if things get worse)

## Configuration

Create `skill-loop.config.json` in your project root (all fields optional):

```json
{
  "skillPaths": [".claude/skills", ".claude/agents"],
  "telemetryDir": ".skill-telemetry",
  "thresholds": {
    "failureRateAlert": 0.2,
    "deadSkillDays": 30
  },
  "retention": {
    "maxRunAgeDays": 90
  },
  "detection": {
    "enabled": true,
    "confidenceThreshold": 0.6,
    "sessionWindowMs": 300000,
    "enabledMethods": ["explicit", "read_skill_file", "tool_fingerprint"]
  }
}
```

### Detection tuning

| Option | Default | Description |
|--------|---------|-------------|
| `detection.enabled` | `true` | Master switch for auto-detection |
| `detection.confidenceThreshold` | `0.6` | Minimum composite score to log a run |
| `detection.sessionWindowMs` | `300000` | How long (ms) a detection session stays open |
| `detection.enabledMethods` | `["explicit", "read_skill_file", "tool_fingerprint"]` | Which detection methods are active |
| `detection.confidenceWeights` | `{ explicit: 1.0, read_skill_file: 0.9, tool_fingerprint: 0.6, file_overlap: 0.5 }` | Confidence per method |
| `detection.logBelowThreshold` | `false` | Log sub-threshold detections to `runs-debug.jsonl` for tuning |

## CLI reference

```bash
npx skill-loop --help
```

| Command | Description |
|---------|-------------|
| `init` | Scan for skills, create `.skill-telemetry/`, update `.gitignore` |
| `status` | Health dashboard (skill count, run totals, failure rate, storage) |
| `log <skill> <outcome>` | Manually log a skill run |
| `inspect` | Full analysis with pattern detection and staleness scoring |
| `amend` | Generate amendments for flagged skills |
| `evaluate <id>` | Test a proposed amendment against recent failures |
| `rollback <id>` | Revert a merged amendment via `git revert` |
| `gc` | Prune runs older than `maxRunAgeDays` |
| `sessions` | Show active detection sessions |
| `detect <tool> [k=v]` | Dry-run detection against a hypothetical tool call |
| `doctor` | Audit cross-file referential integrity |
| `sync` | Push buffered events to external services |
| `serve` | Start MCP server (stdio) |

## Data storage

All data lives in `.skill-telemetry/` (gitignored):

| File | Format | Purpose |
|------|--------|---------|
| `registry.json` | JSON | Skill definitions with stable UUIDs |
| `runs.jsonl` | JSONL (append-only) | Every skill run with outcome, context, and detection metadata |
| `runs-index.json` | JSON (derived) | Compact index for fast queries |
| `amendments.jsonl` | JSONL (append-only) | Proposed and applied skill changes |
| `.sessions/` | JSON (ephemeral) | Active detection sessions, auto-pruned on TTL expiry |

Safe to delete: cache files, sync queue. Loses history: runs, amendments.

## Architecture

```
@stylusnexus/skill-loop        (core engine + adapters - pure TS, zero runtime deps)
└── @stylusnexus/skill-loop-cli (CLI + MCP server - the "install and go" package)
```

## Security

### Everything is local

skill-loop runs entirely on your machine. There are no network calls, no telemetry, no analytics, and no cloud dependencies.

| What | Where | Who can access |
|------|-------|----------------|
| Skill registry | `.skill-telemetry/registry.json` (local, gitignored) | You |
| Run logs | `.skill-telemetry/runs.jsonl` (local, gitignored) | You |
| Amendments | `.skill-telemetry/amendments.jsonl` (local, gitignored) | You |
| Pattern cache | `.skill-telemetry/cache/` (local, gitignored) | You |

No data leaves your machine unless you explicitly configure a sync plugin.

### What skill-loop can read

- SKILL.md files in your configured `skillPaths` (default: `.claude/skills/`, `.claude/agents/`)
- File existence checks for referenced paths (to detect staleness)
- Your `skill-loop.config.json` (if it exists)
- Git branch and commit state (for amendments)

It does **not** read your source code, environment variables, secrets, or any files outside the skill paths and telemetry directory.

### What skill-loop can write

- Files in `.skill-telemetry/` (run logs, registry, cache, reports)
- SKILL.md files **only during amendments** (on a new git branch, never on your working branch)
- `.gitignore` (adds `.skill-telemetry/` entry during `init`)

### Git safety

- skill-loop **never pushes** to a remote. All git operations are local.
- skill-loop **never force-pushes** or runs `git reset --hard`.
- Rollback uses `git revert` (creates a new commit) instead of destructive operations.
- Amendment branches use a predictable naming convention (`skill-loop/amend-*`) so they're easy to identify and clean up.

## Troubleshooting

### "could not determine executable to run"

npx can't resolve binaries from scoped package names directly. Use the `-p` flag:

```bash
# Wrong
npx @stylusnexus/skill-loop-cli skill-loop init

# Right
npx -y -p @stylusnexus/skill-loop-cli skill-loop init
```

### MCP server not picking up new version

npx caches packages aggressively. Pin the version to force a re-fetch:

```bash
npx -y -p @stylusnexus/skill-loop-cli@0.2.3 skill-loop init
```

Or re-run `skill-loop init` after updating -- it detects version mismatches in `.mcp.json` and offers to update.

### "Invalid Settings" / hook format errors

Claude Code hooks require the `{ matcher, hooks: [{ type, command }] }` format. If you configured hooks manually with the old format, update to:

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

Or re-run `skill-loop init` to have it set up hooks correctly.

### Only finding some skills (not all)

skill-loop scans both project-local (`.claude/skills/`) and global (`~/.claude/skills/`, `~/.claude/agents/`) paths. If skills are missing:

- Re-run `skill-loop init` or `/sl scan` to rescan
- Check that the MCP server is running the latest version (see above)
- Skills need either a `dir/SKILL.md` structure or a standalone `.md` file with YAML frontmatter

### Hook errors on every tool call

`PreToolUse:* hook error` messages usually mean the hooks are running but `.skill-telemetry/` hasn't been initialized. Run `skill-loop init` first.

### `/skill-loop` triggers the wrong skill

If you have a skill named `loop`, Claude may match `skill-loop` as `Skill(loop)`. Use `/sl` instead -- it's the official slash command and avoids this collision.

## License

MIT
