# Contributing to skill-loop

Thanks for your interest in contributing to skill-loop! This guide will help you get started.

## Setting Up the Dev Environment

```bash
git clone https://github.com/stylusnexus/skill-loop.git
cd skill-loop
npm install
npm test
```

Requires Node.js >= 18.

## Monorepo Structure

skill-loop is a Turborepo monorepo with two packages:

| Package        | Description                                                                                                              |
|----------------|------------------------------------------------------------------------------------------------------------------------------|
| `packages/core` | Core engine — parser, registry, detection, telemetry, inspector, amender, evaluator, adapters. Zero runtime dependencies. |
| `packages/cli`  | CLI commands + MCP server. Imports core. This is the package most users install.                                           |

## Running Tests

Tests live in `packages/core` and use Vitest:

```bash
cd packages/core
npx vitest run
```

To run tests in watch mode during development:

```bash
cd packages/core
npx vitest
```

## Building

Each package compiles independently with TypeScript:

```bash
# Build all packages
npm run build

# Build a single package
cd packages/core
npx tsc
```

## Making Changes

1. **Fork the repo** and create a feature branch from `main`.
2. **Make your changes** in the appropriate package.
3. **Run tests** to make sure nothing is broken.
4. **Open a pull request** against `main`.

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Format:

```text
type(scope): description
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`

Examples:

- `feat(core): add skill versioning support`
- `fix(mcp): handle missing skill gracefully`
- `docs: update CONTRIBUTING.md`

### PR Checklist

Before submitting a pull request:

- [ ] Tests pass (`cd packages/core && npx vitest run`)
- [ ] Code builds without errors (`npm run build`)
- [ ] Commit messages follow conventional commit format
- [ ] New features include tests
- [ ] Breaking changes are documented

## Reporting Security Issues

If you discover a security vulnerability, please **do not** open a public issue. Instead, email **<security@stylusnexus.com>** with details. We will respond within 48 hours.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to uphold this standard. Please report unacceptable behavior to the maintainers.

## Questions?

Open a [discussion](https://github.com/stylusnexus/skill-loop/discussions) or file an issue. We are happy to help!
