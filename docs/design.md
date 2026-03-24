# @stylusnexus/skill-loop — Design Document

**Date**: 2026-03-24
**Status**: Draft
**Inspired by**: [cognee-skills](https://github.com/topoteretes/cognee) self-improving skills concept

## Problem

AI coding tool skills (SKILL.md files) are static prompt files, but the environment around them constantly changes. Skills silently degrade when:

- Referenced files/functions are renamed or deleted
- The codebase evolves and instructions become stale
- A skill gets selected for tasks it wasn't designed for
- Tool APIs change and tool calls break
- Model behavior shifts between versions

Today, nobody knows a skill is broken until a human notices the output is worse — or the skill fails completely. There is no telemetry, no failure detection, and no structured way to improve skills over time.

## Solution

`@stylusnexus/skill-loop` is a platform-agnostic TypeScript package that closes the feedback loop on AI coding tool skills through five stages:

**SKILL → RUN → OBSERVE → INSPECT → FIX**

With a disciplined amendment cycle: **observe → inspect → amend → evaluate → update/rollback**

## Architecture

### Three-layer design

```
@stylusnexus/skill-loop              (core engine - pure TS, zero runtime deps)
├── @stylusnexus/skill-loop-claude   (Claude Code adapter - hooks)
├── @stylusnexus/skill-loop-codex    (OpenAI Codex adapter - future)
└── @stylusnexus/skill-loop-copilot  (GitHub Copilot adapter - future)
```

**Core** handles: skill parsing, run telemetry storage, pattern detection, amendment generation, evaluation scoring, and git-based rollback. Reads/writes to `.skill-telemetry/` (gitignored). Optionally syncs to external services via plugin interface.

**Adapters** are thin (~50-100 lines) integration layers that intercept skill invocations in their platform's hook system, capture before/after state, and forward events to the core's telemetry writer.

**CLI** (`npx skill-loop <command>`) provides a manual interface for any platform.

### Monorepo structure

```
stylusnexus/skill-loop/
├── packages/
│   ├── core/              # Engine: parse, observe, inspect, amend, evaluate
│   │   ├── src/
│   │   │   ├── parser.ts          # SKILL.md frontmatter + body parser
│   │   │   ├── registry.ts        # Skill registry management
│   │   │   ├── telemetry.ts       # Run log writer (JSONL append)
│   │   │   ├── inspector.ts       # Pattern detection + staleness scoring
│   │   │   ├── amender.ts         # Amendment generation (prompt templates)
│   │   │   ├── evaluator.ts       # Branch-based evaluation runner
│   │   │   ├── git.ts             # Git operations (branch, commit, revert)
│   │   │   ├── storage.ts         # File I/O with atomic writes + locking
│   │   │   ├── sync.ts            # External sync plugin runner
│   │   │   └── types.ts           # All interfaces
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter-claude/    # Claude Code PreToolUse/PostToolUse hooks
│   │   ├── src/
│   │   │   ├── pre-hook.ts        # Captures skill invocation start
│   │   │   ├── post-hook.ts       # Captures result + outcome
│   │   │   └── feedback.ts        # User correction detection heuristic
│   │   └── package.json
│   ├── adapter-codex/     # Future: Codex agent hooks
│   ├── adapter-copilot/   # Future: Copilot instructions integration
│   └── cli/               # npx skill-loop <command>
│       ├── src/
│       │   ├── commands/
│       │   │   ├── init.ts
│       │   │   ├── inspect.ts
│       │   │   ├── amend.ts
│       │   │   ├── evaluate.ts
│       │   │   ├── rollback.ts
│       │   │   ├── status.ts
│       │   │   ├── doctor.ts
│       │   │   ├── gc.ts
│       │   │   └── sync.ts
│       │   └── index.ts
│       └── package.json
├── turbo.json
├── package.json
└── README.md
```

## Data Model

All data lives in `.skill-telemetry/` (gitignored). Incorporates backend architect review feedback.

### Skill Registry (`registry.json`)

Wrapped in a versioned envelope for future migrations. Uses stable UUIDs (not path hashes) to survive renames.

```typescript
interface SkillRegistry {
  schemaVersion: number;
  skills: SkillRecord[];
}

interface SkillRecord {
  id: string;                    // UUID, generated on first registration, permanent
  name: string;                  // from SKILL.md frontmatter
  description: string;           // from frontmatter
  filePath: string;              // relative to project root (mutable metadata)
  type: 'skill' | 'agent';      // .claude/skills/ vs .claude/agents/
  version: number;               // increments on each accepted amendment
  tags: string[];                // domain tags: "testing", "git", "architecture"
  referencedFiles: string[];     // file paths mentioned in the skill body
  referencedTools: string[];     // tool names mentioned (Bash, Grep, etc.)
  triggerPatterns: string[];     // extracted from description/trigger conditions
  brokenReferences: string[];    // files/tools that no longer exist (set by inspect)
  lastModified: string;          // ISO timestamp
  lastVerifiedAt: string;        // ISO timestamp of last staleness check
}
```

### Run Log (`runs.jsonl` — append-only)

Each skill invocation gets one entry. `skillVersion` links to the exact version that ran (critical for amendment evaluation).

```typescript
interface SkillRun {
  id: string;                    // UUID
  skillId: string;               // links to SkillRecord.id
  skillVersion: number;          // version of the skill at invocation time
  timestamp: string;             // ISO
  platform: 'claude' | 'codex' | 'copilot' | 'cli';
  taskContext: string;           // user's intent (truncated to 200 chars)
  taskTags: string[];            // normalized labels: ["refactor", "typescript", "test"]
  outcome: 'success' | 'failure' | 'partial' | 'unknown';
  errorType?: string;            // 'tool_not_found' | 'stale_reference' | 'wrong_routing' | 'runtime_error'
  errorDetail?: string;          // truncated error message
  userFeedback?: 'positive' | 'negative' | 'correction';
  durationMs: number;            // required (-1 if unmeasurable), regression signal
  amendmentId?: string;          // set if running under an evaluation
}
```

### Runs Index (`runs-index.json` — derived, rebuildable)

Compact index for fast cohort queries without scanning full JSONL.

```typescript
interface RunsIndex {
  builtAt: string;               // ISO timestamp
  entries: RunIndexEntry[];
}

interface RunIndexEntry {
  id: string;
  skillId: string;
  skillVersion: number;
  timestamp: string;
  outcome: SkillRun['outcome'];
  platform: SkillRun['platform'];
}
```

### Amendment Record (`amendments.jsonl` — append-only)

Includes evidence summary and baseline comparison for meaningful evaluation.

```typescript
interface Amendment {
  id: string;                    // UUID
  skillId: string;
  skillVersion: number;          // version being amended
  proposedAt: string;            // ISO
  reason: string;                // human-readable explanation
  changeType: 'trigger' | 'instruction' | 'reference' | 'output_format' | 'guard';
  diff: string;                  // unified diff of the SKILL.md change
  evidence: string[];            // run IDs that triggered this proposal
  evidenceSummary: {
    failureRate: number;         // 0-1
    sampleSize: number;
    timeWindowDays: number;
  };
  status: 'proposed' | 'evaluating' | 'accepted' | 'rejected' | 'rolled_back';
  evaluationScore?: number;      // 0-1, success rate on amended version
  baselineScore?: number;        // 0-1, success rate on original version
  evaluationRunCount?: number;   // how many runs in the evaluation
  branchName?: string;           // git branch for the PR
  appliedAt?: string;            // ISO timestamp when accepted/merged
  appliedByVersion?: string;     // skill-loop engine version that applied it
  rollbackOf?: string;           // amendment ID if this is a rollback
  rollbackAt?: string;           // ISO timestamp of rollback
}
```

### Pattern Cache (`.skill-telemetry/cache/patterns.json` — derived, rebuildable)

Computed by inspector, invalidated when `runs.jsonl` mtime changes.

```typescript
interface PatternCache {
  builtAt: string;
  runsJsonlMtime: string;
  patterns: SkillPattern[];
}

interface SkillPattern {
  skillId: string;
  failureRate: number;           // over configured time window
  totalRuns: number;
  negativeFeedbackRate: number;
  dominantErrorType?: string;
  stalenessScore: number;        // 0-1, based on broken references
  lastRunAt: string;
  trend: 'improving' | 'stable' | 'degrading' | 'insufficient_data';
}
```

### Storage Safety

- **JSONL files**: Append-only, one syscall per write. File lock for concurrent access.
- **JSON files** (registry, index, cache): Write-to-temp-then-atomic-rename pattern. File-based lock (`.skill-telemetry/<file>.lock` with PID + timestamp, stale lock detection).
- **Referential integrity**: Validated on read, warnings surfaced (not hard failures). `skill-loop doctor` audits cross-file consistency.

## Pipeline Stages

### Stage 1: Observe

**Automatic via platform adapter.** The adapter intercepts skill invocations through the platform's hook system and writes to `runs.jsonl`.

**Claude Code adapter** uses `PreToolUse` and `PostToolUse` hooks in `.claude/settings.json`:

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

**PreToolUse** captures: skill name, timestamp, task context (from stdin JSON).

**PostToolUse** captures: outcome (success/failure from tool result), duration, error details.

**User feedback detection**: Heuristic — when a user corrects the agent immediately after a skill runs ("no, that's wrong", "don't use that skill"), the adapter writes `userFeedback: 'negative'`. Noisy but valuable signal.

**Manual logging**: `npx skill-loop log <skill> <outcome>` for platforms without adapters.

### Stage 2: Inspect

**Triggered by**: `npx skill-loop inspect` or scheduled agent (weekly cron).

Reads `runs.jsonl` (via index for performance) and computes:

- **Failure rate per skill** — Skills above threshold (default >20% in last 30 days) get flagged
- **Routing accuracy** — Skills invoked but producing negative feedback (wrong skill selected)
- **Staleness score** — Cross-references `referencedFiles` and `referencedTools` against actual codebase
- **Usage distribution** — Dead skills (zero invocations in 30+ days), over-triggered skills
- **Trend detection** — Comparing recent window vs. prior window to catch degradation

Output: `.skill-telemetry/reports/inspect-<date>.json` + pattern cache update.

### Stage 3: Amend

**Triggered by**: `npx skill-loop amend` or automatically after `inspect` finds actionable patterns.

Uses the project's own AI tool to draft amendments. The core provides prompt templates; the adapter handles the AI call.

**Amendment types:**

| Type | Trigger | Example Fix |
|------|---------|-------------|
| `trigger` | >30% negative feedback (wrong skill selected) | Tighten `description` field |
| `reference` | `referencedFiles` point to moved/deleted files | Update file paths in skill body |
| `instruction` | Repeated failures with same `errorType` | Add missing step, reorder instructions |
| `output_format` | Tool calls failing downstream | Fix output format expectations |
| `guard` | Skill runs in contexts where it shouldn't | Add exclusion conditions |

**Git workflow:**

1. Create branch: `skill-loop/amend-<skill-name>-<short-hash>`
2. Apply proposed diff to the SKILL.md file
3. Commit: `skill-loop: amend <skill-name> (<changeType>)`
4. Record Amendment with status: `proposed`

No PR yet — evaluation happens first.

### Stage 4: Evaluate

**Safety gate.** Replays recent failure cases against the amended skill on the branch.

1. Checkout the amendment branch
2. Gather evidence runs (the failures that triggered the amendment)
3. Re-run the skill against those same task contexts
4. Score: success rate on amended version vs. baseline
5. Record: `evaluationScore`, `baselineScore`, `evaluationRunCount`

**Passing threshold**: Amendment must improve on baseline by configurable margin (default >10% improvement, no new failure types introduced).

**If passes**: Status → `accepted`, open PR with evaluation results in description, human reviews and merges.

**If fails**: Status → `rejected`, branch deleted, reason logged.

### Stage 5: Update / Rollback

**Update**: Human merges the PR. Core detects merge (via git hook or `skill-loop sync`) and:
- Increments `SkillRecord.version`
- Updates `lastModified`
- Re-scans `referencedFiles` and `referencedTools`

**Rollback**: Triggered if post-merge monitoring shows regression (failure rate increased over 7-day window):
- `npx skill-loop rollback <amendment-id>`
- Reverts SKILL.md via `git revert` (new commit, not force-push)
- Amendment status → `rolled_back` with `rollbackAt` and `rollbackOf`

## CLI Interface

```bash
# Setup
npx skill-loop init                    # Scan skills, create .skill-telemetry/, update .gitignore

# Observe (usually automatic via adapter)
npx skill-loop log <skill> <outcome>   # Manual run logging

# Inspect
npx skill-loop inspect                 # Full analysis, output report
npx skill-loop inspect --skill <name>  # Single skill
npx skill-loop status                  # Quick dashboard (file sizes, counts, top issues)

# Amend
npx skill-loop amend                   # Generate amendments for all flagged skills
npx skill-loop amend --skill <name>    # Single skill
npx skill-loop amend --dry-run         # Preview without creating branches

# Evaluate
npx skill-loop evaluate <amendment-id> # Run evaluation for proposed amendment

# Maintain
npx skill-loop rollback <amendment-id> # Revert a merged amendment
npx skill-loop gc                      # Prune runs older than maxRunAgeDays
npx skill-loop doctor                  # Audit cross-file referential integrity
npx skill-loop sync                    # Push buffered events to external services
```

## Configuration (`skill-loop.config.json`)

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

## External Sync Plugin Interface

Designed for privacy-first, non-blocking sync to external services.

```typescript
interface SyncPlugin {
  name: string;
  version: string;
  filter(run: SkillRun): boolean;          // plugin declares what it wants
  sanitize(run: SkillRun): SyncPayload;    // plugin owns PII scrubbing
  emit(event: SyncEvent): Promise<void>;   // fire-and-forget, must not throw
}

// Stable public contract, decoupled from internal types
type SyncEvent =
  | { type: 'run_completed'; payload: SyncPayload }
  | { type: 'amendment_proposed'; payload: AmendmentSummary }
  | { type: 'amendment_evaluated'; payload: AmendmentSummary }
  | { type: 'registry_updated'; payload: RegistrySummary };
```

- `emit` fires asynchronously after local write completes — never blocks the local loop
- Undelivered events buffered in `.skill-telemetry/sync-queue.jsonl` with TTL
- Each plugin owns its own `filter` and `sanitize` — the core cannot know what each target considers sensitive

## Implementation Phases

### Phase 1: Foundation (MVP)
- Core: parser, registry, telemetry writer, storage layer with atomic writes
- CLI: `init`, `log`, `status`
- Claude adapter: PreToolUse/PostToolUse hooks
- Test suite for core

### Phase 2: Intelligence
- Core: inspector, pattern cache
- CLI: `inspect`, `doctor`
- Staleness detection (cross-reference files/tools against codebase)

### Phase 3: Self-Improvement
- Core: amender, evaluator, git operations
- CLI: `amend`, `evaluate`, `rollback`
- Amendment prompt templates
- PR generation with evaluation results

### Phase 4: Ecosystem
- External sync plugin interface
- PostHog sync plugin
- Codex adapter
- `gc` command
- Documentation and npm publish

## Open Questions

1. **Evaluation replay fidelity**: Re-running a skill against saved `taskContext` may not perfectly reproduce the original failure if the codebase has changed since. How much does this matter in practice?
2. **AI call for amendments**: Should the amender use a specific model (e.g., always Claude Sonnet for cost efficiency) or defer to whatever the project's default AI tool is?
3. **Cross-project learning**: Could anonymized pattern data from multiple StylusNexus projects improve amendment quality? (Future consideration, privacy implications.)
