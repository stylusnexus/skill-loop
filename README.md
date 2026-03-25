# @stylusnexus/skill-loop

Self-improving skills for AI coding tools.

Skills are static prompt files. Codebases are not. **skill-loop** closes the feedback loop so skills improve automatically when they degrade.

```
SKILL --> RUN --> OBSERVE --> INSPECT --> FIX
  ^                                       |
  +---------------------------------------+
```

## What it does

1. **Observe** -- Automatically detects and logs skill usage via tiered confidence scoring — no explicit logging required
2. **Inspect** -- Detects failure patterns, staleness (dead file references), routing errors, and usage trends
3. **Amend** -- Proposes targeted SKILL.md patches grounded in evidence from past runs
4. **Evaluate** -- Tests amendments against recent failure cases on a git branch before any human sees a PR
5. **Update/Rollback** -- Merges improvements via PR; rolls back if post-merge monitoring shows regression

## Packages

| Package | Description |
|---------|-------------|
| `@stylusnexus/skill-loop` | Core engine (parser, registry, telemetry, inspector, amender) |
| `@stylusnexus/skill-loop-cli` | CLI (`npx skill-loop <command>`) + MCP server (`serve`) |
| `@stylusnexus/skill-loop-mcp` | MCP server (works with any MCP-compatible AI tool) |
| `@stylusnexus/skill-loop-claude` | Claude Code adapter (PreToolUse/PostToolUse hooks) |
| `@stylusnexus/skill-loop-codex` | OpenAI Codex adapter |
| `@stylusnexus/skill-loop-copilot` | GitHub Copilot adapter |

## Install

### Option 1: MCP Server (recommended — set it and forget it)

Add one block to your MCP config. That's the only setup.

**Claude Code** (`.mcp.json` in your project root):

```json
{
  "mcpServers": {
    "skill-loop": {
      "command": "npx",
      "args": ["@stylusnexus/skill-loop-cli", "serve"]
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "skill-loop": {
      "command": "npx",
      "args": ["@stylusnexus/skill-loop-cli", "serve"]
    }
  }
}
```

Then ask your AI tool: **"Initialize skill-loop"**

That's it. From that point forward:

- The MCP server starts automatically when your AI tool launches
- The agent can self-diagnose skill health, log runs, and propose fixes without you doing anything
- No CLI commands to remember, no cron jobs to set up
- Works with Claude Code, Cursor, Windsurf, and any MCP-compatible tool

**Just talk to it.** The unified `skill_loop` tool understands natural language:

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
| `skill-loop update` | Re-scans the skill registry after changes |
| `skill-loop detection` | Shows detection stats and active sessions |
| `skill-loop gc` | Prunes old run data |

You can also use the individual MCP tools programmatically:

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

### Option 2: CLI

```bash
npm install @stylusnexus/skill-loop @stylusnexus/skill-loop-cli
```

```bash
# Initialize (scans for skills, creates .skill-telemetry/)
npx skill-loop init

# Check health
npx skill-loop status

# Manually log a run
npx skill-loop log my-skill success

# Run full inspection
npx skill-loop inspect

# Propose fixes for degraded skills
npx skill-loop amend
```

### Option 3: Claude Code Hooks (automatic observation)

For automatic skill run tracking in Claude Code, install the adapter:

```bash
npm install @stylusnexus/skill-loop @stylusnexus/skill-loop-claude
```

Then run init — it will offer to configure hooks for you:

```bash
npx skill-loop init
# ...
# Auto-detection hooks are not configured.
# These hooks observe tool calls and automatically log skill usage.
# Add auto-detection hooks to .claude/settings.json? [Y/n]
```

Say yes and it adds the hooks to `.claude/settings.json` automatically. If you prefer to set them up manually:

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

The hooks observe all tool calls and auto-detect skill usage via tiered confidence scoring — no explicit `Skill` tool invocation required. Runs are logged to `.skill-telemetry/runs.jsonl` (gitignored, local-only). No data leaves your machine unless you configure a sync plugin.

If you previously had hooks with `"matcher": "Skill"`, running `npx skill-loop init` again will detect the old config and offer to upgrade to `".*"` for full auto-detection.

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

Runs are only logged when composite confidence exceeds a configurable threshold (default: 0.6). Each run record includes detection metadata:

```json
{
  "id": "a1b2c3d4-...",
  "skillId": "e5f6g7h8-...",
  "skillVersion": 1,
  "timestamp": "2026-03-24T12:00:00Z",
  "platform": "claude",
  "outcome": "success",
  "durationMs": 1234,
  "taskContext": "refactor auth module",
  "detectionMethod": "read_skill_file",
  "detectionConfidence": 0.9
}
```

A compact index (`runs-index.json`) is maintained alongside for fast queries.

### 3. Detect problems

The inspector analyzes run history to find:
- Skills with high failure rates
- Skills that get selected for wrong tasks (negative feedback)
- Stale references to files/tools that no longer exist
- Dead skills with zero recent invocations

### 4. Fix automatically

When a pattern is detected, the amender:
1. Drafts a targeted SKILL.md patch
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

## CLI Reference

```bash
npx skill-loop --help    # Show available commands
npx skill-loop <command> # Run a command
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
@stylusnexus/skill-loop              (core engine - pure TS, zero runtime deps)
+-- @stylusnexus/skill-loop-mcp      (MCP server - any MCP client)
+-- @stylusnexus/skill-loop-claude    (Claude Code hooks)
+-- @stylusnexus/skill-loop-cli       (CLI commands)
+-- @stylusnexus/skill-loop-codex     (OpenAI Codex)
+-- @stylusnexus/skill-loop-copilot   (GitHub Copilot)
```

See [docs/design.md](docs/design.md) for the full design document.

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

### Permissions and the amend tool

The `skill_loop_amend` MCP tool and `npx skill-loop amend` CLI command **modify SKILL.md files** by:

1. Creating a new git branch (`skill-loop/amend-<name>-<hash>`)
2. Writing the amended SKILL.md on that branch
3. Committing the change
4. Switching back to your original branch

**Your working branch is never modified.** Amendments live on isolated branches until you review and merge them.

When using the MCP server, your AI tool's permission system governs whether `skill_loop_amend` can execute:
- **Claude Code**: Prompts you for approval in `default` permission mode
- **Cursor/Windsurf**: Uses their built-in tool approval flow
- **`--dry-run`**: Always available to preview proposals without any file changes

### Sync plugins and data privacy

Future sync plugins may send run data to external services (PostHog, etc.). The core enforces privacy at the code level — this is not left to plugin authors:

**Sensitive fields are redacted by the core before plugins ever see them:**

| Field | Contains | Default | How to allow |
|-------|----------|---------|--------------|
| `taskContext` | What the user was doing | `[redacted]` | `sync.allowSensitiveFields: true` |
| `errorDetail` | Error messages from skill failures | `[redacted]` | `sync.allowSensitiveFields: true` |

The core's `sanitizeRunForSync()` function strips these fields before passing data to any plugin. Plugins receive a `SanitizedSkillRun` type — they physically cannot access the raw data unless you opt in.

To explicitly allow sensitive fields (e.g., for a private PostHog instance):

```json
{
  "sync": {
    "plugins": ["posthog"],
    "allowSensitiveFields": true
  }
}
```

**Additional safeguards:**

- Sync is **opt-in** — disabled by default, no plugins configured
- The core engine never touches the network — only plugins do
- Sync is fire-and-forget and never blocks the local feedback loop
- Non-sensitive fields (skill ID, outcome, duration, platform, tags) are always available to plugins — these are sufficient for most analytics

### Git safety

- skill-loop **never pushes** to a remote. All git operations are local.
- skill-loop **never force-pushes** or runs `git reset --hard`.
- Rollback uses `git revert` (creates a new commit) instead of destructive operations.
- Amendment branches use a predictable naming convention (`skill-loop/amend-*`) so they're easy to identify and clean up.

## License

MIT
