# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.3] - 2026-04-09

### Fixed
- `npx skill-loop-claude` E404 error for installed users — hook commands now use `--package=@stylusnexus/skill-loop` so npx resolves the scoped binary correctly

## [0.3.2] - 2026-04-06

### Added
- Discrete `apply_fixes` and `rollback` MCP tools for cross-client compatibility (#8)

## [0.3.0] - 2026-04-06

### Added
- Two-phase fix flow with in-place edits and rollback (#7)
  - `/sl fix` now shows a diagnosis first, then lets you pick which fixes to apply
  - Fixes are written directly to SKILL.md files with automatic backups
  - `/sl rollback <name>` undoes any applied fix

### Changed
- Updated all READMEs for two-phase fix flow and `/sl` commands

## [0.2.4] - 2026-04-06

### Fixed
- Claude Code hook format now uses correct `{ matcher, hooks: [{ type, command }] }` structure
- `init` auto-configures `.mcp.json` with version-pinned config

### Added
- Troubleshooting sections to all READMEs

## [0.2.1] - 2026-04-06

### Added
- `/sl` slash command with auto-install on `init` (#6)

## [0.2.0] - 2026-04-06

### Added
- Source (`local` / `installed`) and scope (`global` / `project`) fields on skill records (#5)
- Global skill scanning from `~/.claude/skills/` and `~/.claude/agents/`
- Deduplication of skills across project and global paths

## [0.1.6] - 2026-04-06

### Added
- Claude init example and hook setup examples to READMEs

## [0.1.5] - 2026-04-06

### Fixed
- MCP server auto-start detection for npx binary symlinks

## [0.1.3] - 2026-04-06

### Fixed
- MCP server args in READMEs corrected

## [0.1.2] - 2026-04-06

### Changed
- Improved package READMEs for npm clarity

## [0.1.1] - 2026-04-06

### Changed
- Consolidated from 6 packages down to 2 publishable packages (`core` + `cli`) (#4)
  - Adapters (Claude, Codex, Copilot) folded into core
  - MCP server moved into CLI package
- Added per-package READMEs for npm

## [0.1.0] - 2026-03-25

### Added
- Automatic skill usage detection via tiered confidence scoring (#3)
  - Explicit invocation (1.0), SKILL.md read (0.9), tool fingerprint (0.6)
  - Configurable confidence threshold and session window
- Content drift detection in the inspector
- `--help` and `-h` flags, bare `help` command (#1, #2)

## [0.0.1] - 2026-03-24

### Added
- Initial release
- Core engine: parser, registry, storage, telemetry
- Inspector with failure pattern detection and staleness scoring
- Amender with idempotent fix strategies on isolated git branches
- Evaluator for testing amendments against baseline
- GC for pruning old run data
- Sync runner with plugin loader
- Unified `skill_loop` MCP router tool for natural language actions
- CLI commands: init, status, log, inspect, amend, evaluate, rollback, gc, serve
- Claude Code adapter (PreToolUse/PostToolUse hooks)
