# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the foundation layer of skill-loop — storage, parsing, registry, telemetry, CLI commands (init/log/status), and Claude Code adapter hooks — so skills can be scanned, runs can be recorded, and health can be checked.

**Architecture:** Core package exposes a storage layer (atomic JSON writes, JSONL append), a SKILL.md parser (YAML frontmatter + markdown body extraction), a registry manager (scan directories, register/update skills), and a telemetry writer (append SkillRun to JSONL + update index). CLI wraps these into `init`, `log`, and `status` commands. Claude adapter reads hook stdin JSON and delegates to core.

**Tech Stack:** TypeScript 5.8+, Node.js 18+, Vitest for tests, `node:fs` and `node:crypto` only (zero external runtime deps in core).

---

## File Structure

### Core package (`packages/core/src/`)

| File | Responsibility |
|------|---------------|
| `types.ts` | All interfaces (already exists) |
| `config.ts` | Load/merge `skill-loop.config.json` with defaults |
| `storage.ts` | Atomic JSON write (temp+rename), JSONL append |
| `parser.ts` | Parse SKILL.md frontmatter + extract references from body |
| `registry.ts` | Scan skill directories, register/update SkillRecords, read/write registry.json |
| `telemetry.ts` | Append SkillRun to runs.jsonl, maintain runs-index.json |
| `index.ts` | Public API re-exports (already exists, needs updating) |

### Core tests (`packages/core/src/__tests__/`)

| File | Tests |
|------|-------|
| `storage.test.ts` | Atomic write, JSONL append, crash safety |
| `parser.test.ts` | Frontmatter parsing, reference extraction, edge cases |
| `registry.test.ts` | Scan, register, update, handle missing dirs |
| `telemetry.test.ts` | Run logging, index maintenance |
| `config.test.ts` | Default merging, missing config file, invalid config |

### CLI package (`packages/cli/src/`)

| File | Responsibility |
|------|---------------|
| `index.ts` | Entry point, command routing (already exists, needs real implementations) |
| `commands/init.ts` | Scan skills, create .skill-telemetry/, update .gitignore |
| `commands/log.ts` | Manual run logging |
| `commands/status.ts` | Health dashboard output |

### Claude adapter (`packages/adapter-claude/src/`)

| File | Responsibility |
|------|---------------|
| `pre-hook.ts` | Read Claude Code hook stdin, write pending context |
| `post-hook.ts` | Match pending, determine outcome, append run |
| `cli.ts` | CLI entry point for `skill-loop-claude pre-hook` / `post-hook` |
| `index.ts` | Re-exports (already exists) |

---

## Task 1: Storage Layer

**Files:**
- Create: `packages/core/src/storage.ts`
- Create: `packages/core/src/__tests__/storage.test.ts`

- [ ] **Step 1: Write failing tests for atomic JSON write and JSONL operations**

Tests cover: writeJsonAtomic round-trip, overwrite, no temp file left behind, readJson returns null for missing, appendJsonl single/multiple/creates-file, readJsonl skips blank lines and returns empty for missing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Applications/Development/Projects/skill-loop && npx vitest run packages/core/src/__tests__/storage.test.ts`

- [ ] **Step 3: Implement storage layer**

`writeJsonAtomic`: write to `.tmp` then `rename()` (atomic on POSIX). `readJson`: parse or return null on ENOENT. `appendJsonl`: `appendFile` with newline. `readJsonl`: split, filter blanks, parse.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```
feat(core): add storage layer with atomic JSON writes and JSONL append
```

---

## Task 2: Config Loader

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `packages/core/src/__tests__/config.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: returns defaults when no config, deep-merges user overrides, handles invalid JSON gracefully.

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement config loader**

`loadConfig(projectRoot)`: read `skill-loop.config.json`, deep-merge over `DEFAULT_CONFIG`. `deepMerge` recurses into objects, replaces arrays and scalars.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```
feat(core): add config loader with defaults and deep merge
```

---

## Task 3: SKILL.md Parser

**Files:**
- Create: `packages/core/src/parser.ts`
- Create: `packages/core/src/__tests__/parser.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: parse frontmatter (name, description), handle missing description, handle no frontmatter, extract backtick-quoted file paths, ignore non-path content, extract tool names.

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement parser**

`parseSkillFile`: regex for `---\n...\n---` frontmatter block, simple YAML key:value parsing (no nested YAML needed). `extractReferencedFiles`: backtick regex filtered to path-like strings with `/` and extension. `extractReferencedTools`: match known Claude Code tool names.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```
feat(core): add SKILL.md parser with frontmatter and reference extraction
```

---

## Task 4: Registry Manager

**Files:**
- Create: `packages/core/src/registry.ts`
- Create: `packages/core/src/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: scan builds registry, stable UUIDs persist across rescans, empty dirs, missing dirs, findByName lookup, unknown name returns undefined.

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement registry manager**

`RegistryManager` class. `scan()`: iterate skillPaths, read each SKILL.md dir, parse, match against existing registry for UUID stability, write `registry.json` via `writeJsonAtomic`. `findByName`/`findById` for lookups.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```
feat(core): add registry manager with skill scanning and stable UUIDs
```

---

## Task 5: Telemetry Writer

**Files:**
- Create: `packages/core/src/telemetry.ts`
- Create: `packages/core/src/__tests__/telemetry.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: append run to JSONL, multiple runs in order, index updated with each run, getRunCount.

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement telemetry writer**

`TelemetryWriter` class. `logRun()`: appendJsonl + updateIndex. `getRunCount`/`getIndex`/`getAllRuns` for queries. Index is read-modify-write via `writeJsonAtomic`.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```
feat(core): add telemetry writer with JSONL logging and index maintenance
```

---

## Task 6: Update Core Index Exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update exports to expose all implemented modules**

- [ ] **Step 2: Verify TypeScript compiles**: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```
feat(core): export all Phase 1 modules from package index
```

---

## Task 7: CLI — init Command

**Files:**
- Create: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement init command**

Creates `.skill-telemetry/`, adds to `.gitignore`, scans and registers skills, prints summary.

- [ ] **Step 2: Wire into CLI entry point**

- [ ] **Step 3: Commit**

```
feat(cli): implement init command with skill scanning and gitignore setup
```

---

## Task 8: CLI — log Command

**Files:**
- Create: `packages/cli/src/commands/log.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement log command**

Validates args (skill name + outcome), looks up skill in registry, creates SkillRun, appends via TelemetryWriter.

- [ ] **Step 2: Wire into CLI and commit**

```
feat(cli): implement log command for manual run logging
```

---

## Task 9: CLI — status Command

**Files:**
- Create: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement status command**

Reads registry + index, computes outcome breakdown, shows file sizes, prints dashboard.

- [ ] **Step 2: Wire into CLI and commit**

```
feat(cli): implement status command with health dashboard
```

---

## Task 10: Claude Code Adapter

**Files:**
- Modify: `packages/adapter-claude/src/pre-hook.ts`
- Modify: `packages/adapter-claude/src/post-hook.ts`
- Create: `packages/adapter-claude/src/cli.ts`

- [ ] **Step 1: Implement pre-hook**

Reads stdin JSON, extracts skill name, writes pending context to `.skill-telemetry/.pending/<uuid>.json`.

- [ ] **Step 2: Implement post-hook**

Reads stdin JSON, finds latest pending context, determines success/failure from tool_result/tool_error, calculates duration, appends SkillRun via TelemetryWriter.

- [ ] **Step 3: Create CLI entry point** (`cli.ts`) — routes `pre-hook`/`post-hook` subcommands, swallows all errors (hooks must never crash the host tool).

- [ ] **Step 4: Commit**

```
feat(adapter-claude): implement PreToolUse/PostToolUse hooks with pending context
```

---

## Task 11: Install Dependencies and Verify Build

- [ ] **Step 1: Install all dependencies**: `npm install`
- [ ] **Step 2: Build all packages**: `npx turbo run build`
- [ ] **Step 3: Run all tests**: `npx turbo run test`
- [ ] **Step 4: Commit lockfile**

```
chore: add package-lock.json after dependency install
```

---

## Task 12: Push and Verify

- [ ] **Step 1: Run full test suite**
- [ ] **Step 2: Push to remote**: `git push origin main`
- [ ] **Step 3: Verify on GitHub**: files present, README renders
