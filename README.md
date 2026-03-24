# @stylusnexus/skill-loop

Self-improving skills for AI coding tools.

Skills are static prompt files. Codebases are not. **skill-loop** closes the feedback loop so skills improve automatically when they degrade.

```
SKILL ──→ RUN ──→ OBSERVE ──→ INSPECT ──→ FIX
  ↑                                         │
  └─────────────────────────────────────────┘
```

## What it does

1. **Observe** -- Automatically logs every skill invocation: what ran, whether it succeeded, and how the user reacted
2. **Inspect** -- Detects failure patterns, staleness (dead file references), routing errors, and usage trends
3. **Amend** -- Proposes targeted SKILL.md patches grounded in evidence from past runs
4. **Evaluate** -- Tests amendments against recent failure cases on a git branch before any human sees a PR
5. **Update/Rollback** -- Merges improvements via PR; rolls back if post-merge monitoring shows regression

## Platform support

The core engine is platform-agnostic. Thin adapters handle integration with specific AI coding tools:

| Package | Status | Platform |
|---------|--------|----------|
| `@stylusnexus/skill-loop` | In progress | Core engine |
| `@stylusnexus/skill-loop-claude` | In progress | Claude Code |
| `@stylusnexus/skill-loop-cli` | In progress | Any (manual) |
| `@stylusnexus/skill-loop-codex` | Planned | OpenAI Codex |
| `@stylusnexus/skill-loop-copilot` | Planned | GitHub Copilot |

## Quick start

```bash
# Install
npm install @stylusnexus/skill-loop @stylusnexus/skill-loop-claude

# Initialize (scans for skills, creates .skill-telemetry/)
npx skill-loop init

# Check health
npx skill-loop status

# Run full inspection
npx skill-loop inspect

# Propose fixes for degraded skills
npx skill-loop amend

# Evaluate a proposed amendment
npx skill-loop evaluate <amendment-id>
```

## How observation works (Claude Code)

The Claude Code adapter installs as hooks in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Skill",
      "command": "npx skill-loop-claude pre-hook"
    }],
    "PostToolUse": [{
      "matcher": "Skill",
      "command": "npx skill-loop-claude post-hook"
    }]
  }
}
```

Every skill invocation is logged to `.skill-telemetry/runs.jsonl` (gitignored, local-only). No data leaves your machine unless you configure a sync plugin.

## Configuration

Create `skill-loop.config.json` in your project root:

```json
{
  "schemaVersion": 1,
  "skillPaths": [".claude/skills", ".claude/agents"],
  "telemetryDir": ".skill-telemetry",
  "thresholds": {
    "failureRateAlert": 0.2,
    "negativeFeedbackAlert": 0.3,
    "deadSkillDays": 30,
    "amendmentImprovementMin": 0.1,
    "rollbackWindowDays": 7
  },
  "retention": {
    "maxRunAgeDays": 90,
    "maxFileSizeMB": 10
  },
  "sync": {
    "plugins": []
  }
}
```

## CLI commands

| Command | Description |
|---------|-------------|
| `init` | Scan for skills, create `.skill-telemetry/`, update `.gitignore` |
| `status` | Quick health dashboard (file sizes, record counts, top issues) |
| `inspect` | Full analysis with pattern detection and staleness scoring |
| `amend` | Generate amendments for flagged skills |
| `evaluate` | Test a proposed amendment against recent failures |
| `rollback` | Revert a merged amendment via `git revert` |
| `log` | Manually log a skill run (for platforms without adapters) |
| `gc` | Prune runs older than `maxRunAgeDays` |
| `doctor` | Audit cross-file referential integrity |
| `sync` | Push buffered events to external services |

## Architecture

See [docs/design.md](docs/design.md) for the full design document.

## License

MIT
