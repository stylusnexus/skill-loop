# @stylusnexus/skill-loop

Core engine for self-improving AI coding tool skills.

Skills are static prompt files. Codebases are not. **skill-loop** closes the feedback loop so skills improve automatically when they degrade.

```
SKILL --> RUN --> OBSERVE --> INSPECT --> FIX
  ^                                       |
  +---------------------------------------+
```

## Which package do I need?

There are two skill-loop packages. You probably want the other one.

| Package | What it is | Who it's for |
|---------|-----------|-------------|
| [`@stylusnexus/skill-loop-cli`](https://www.npmjs.com/package/@stylusnexus/skill-loop-cli) | CLI + MCP server | **Most users.** Install this to use skill-loop from the terminal or connect it to Claude Code, Cursor, Windsurf, or any MCP-compatible tool. |
| **`@stylusnexus/skill-loop`** (this package) | Core library | Developers building custom integrations, plugins, or programmatic workflows on top of skill-loop. |

**If you're not sure, install [`@stylusnexus/skill-loop-cli`](https://www.npmjs.com/package/@stylusnexus/skill-loop-cli)** -- it includes this package as a dependency, so you get everything.

## Install

```bash
npm install @stylusnexus/skill-loop
```

## Usage

```typescript
import {
  RegistryManager,
  TelemetryWriter,
  Inspector,
  Amender,
  Evaluator,
  DetectionPipeline,
  loadConfig,
  logSkillRun,
} from '@stylusnexus/skill-loop';

// Log a skill run from any platform
await logSkillRun({
  skillName: 'my-skill',
  platform: 'codex',  // 'claude' | 'codex' | 'copilot' | 'cli'
  outcome: 'success',
  taskContext: 'refactor auth module',
});

// Or use the full pipeline programmatically
const config = await loadConfig(projectRoot);
const registry = new RegistryManager(projectRoot, telemetryDir, config);
await registry.scan();

const inspector = new Inspector(telemetryDir);
const result = await inspector.inspect();
// result.flagged contains skills with problems
```

## What it includes

- **Parser** -- Reads SKILL.md frontmatter, extracts referenced files and tools
- **Registry** -- Scans skill paths, assigns stable UUIDs, detects broken references
- **Detection** -- Auto-detects skill usage via tiered confidence scoring
- **Telemetry** -- Append-only run logging to local JSONL files
- **Inspector** -- Finds failure patterns, staleness, content drift, dead skills
- **Amender** -- Proposes targeted SKILL.md patches on isolated git branches
- **Evaluator** -- Tests amendments against baseline data before merging
- **Adapters** -- Pre/post hook handlers for Claude Code, plus `logSkillRun()` for any platform

## Platform adapters

### Claude Code hooks

```typescript
import { preHook, postHook } from '@stylusnexus/skill-loop';
```

These are used by the `skill-loop-claude` binary (included in this package) to feed Claude Code's PreToolUse/PostToolUse hook events into the detection pipeline.

### Any platform

```typescript
import { logSkillRun } from '@stylusnexus/skill-loop';

await logSkillRun({
  skillName: 'my-skill',
  platform: 'copilot',
  outcome: 'failure',
  errorDetail: 'Referenced file not found',
});
```

## Security

- All data is local-only in `.skill-telemetry/` (gitignored)
- Zero runtime dependencies
- No network calls, no telemetry, no analytics
- Git operations are always local -- never pushes, never force-pushes
- Amendments are created on isolated branches, never on your working branch

## Troubleshooting

### Import errors after updating

Clear your build cache and rebuild:

```bash
npm run clean && npm run build
```

### `logSkillRun` returns null

The skill name wasn't found in the registry. Run `skill-loop init` first to scan and register skills, then verify the name matches exactly.

### Registry not finding all skills

The registry scans both project-local and global paths. Pass `globalSkillPaths` to `scan()`:

```typescript
const config = await loadConfig(projectRoot);
const registry = new RegistryManager(projectRoot, telemetryDir);
await registry.scan(config.skillPaths, config.globalSkillPaths);
```

## Full documentation

See the [GitHub repository](https://github.com/stylusnexus/skill-loop) for complete documentation, configuration options, and CLI reference.

## License

MIT
