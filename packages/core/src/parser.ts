import { readFile } from 'node:fs/promises';
import type { ParserConfig } from './types.js';

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const YAML_STRING_RE = /^["'](.*)["']$/;

const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Grep', 'Glob', 'LS',
  'Agent', 'Skill', 'WebFetch', 'WebSearch', 'NotebookEdit',
  'TodoWrite', 'TaskCreate', 'TaskUpdate',
];

// ─── Built-in exclusion patterns ──────────────────────────────────

/**
 * Default exclusion patterns shipped with the package.
 * Consumers can extend (additive) or override (excludePatternsOverride: true).
 */
export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  // URLs and protocols
  '://',
  '^https?://',
  '^ftp://',
  '^git://',
  '^ssh://',
  // Shell flags and variables
  '^--?\\w',
  '\\$\\{',
  '\\$\\(',
  '^\\$\\w',
  // Glob metacharacters
  '\\*',
  '\\?',
  '\\[.*\\]',
  '\\{.*\\}',
  // Semver and version strings
  '^\\^?~?\\d+\\.\\d+',
  // Package scopes without path (e.g., @org/package but not @org/package/path)
  '^@[\\w-]+/[\\w-]+$',
  // Environment variable style (ALL_CAPS)
  '^[A-Z][A-Z0-9_]{2,}$',
  // Absolute system paths
  '^/usr/',
  '^/etc/',
  '^/var/',
  '^/tmp/',
  '^/home/',
  '^/System/',
  '^/Applications/',
  '^~/',
  // Shell commands (common)
  '^npm\\s',
  '^npx\\s',
  '^node\\s',
  '^git\\s',
  '^curl\\s',
  '^kill\\s',
  '^ls\\s',
  '^rm\\s',
  '^stat\\s',
  '^cat\\s',
  '^grep\\s',
  // Pipe/redirect operators
  '\\|',
  '^>',
  '^<',
  // Markdown anchors
  '^#[\\w-]',
  // localhost
  '^localhost',
];

// ─── Structural heuristic ─────────────────────────────────────────

/** Must look like a file path: has a slash, ends with an extension */
const PATH_HEURISTIC_RE = /^[\w@.-][\w/.@-]*\.\w{1,10}$/;

function looksLikePath(candidate: string): boolean {
  return PATH_HEURISTIC_RE.test(candidate) && candidate.includes('/');
}

// ─── Compiled config for performance ──────────────────────────────

interface CompiledParserConfig {
  excludeRules: RegExp[];
  includeRules: RegExp[];
  sources: ParserConfig['sources'];
}

function compileConfig(config?: ParserConfig): CompiledParserConfig {
  const defaults = DEFAULT_EXCLUDE_PATTERNS;

  const excludeStrings = config?.excludePatternsOverride
    ? (config.excludePatterns ?? [])
    : [...defaults, ...(config?.excludePatterns ?? [])];

  const excludeRules = excludeStrings.map((p) => new RegExp(p));
  const includeRules = (config?.includePatterns ?? []).map((p) => new RegExp(p));

  const sources = config?.sources ?? {
    backtick: true,
    codeBlock: true,
    table: true,
    plainText: false,
  };

  return { excludeRules, includeRules, sources };
}

// ─── Candidate evaluation pipeline ───────────────────────────────

function evaluateCandidate(
  candidate: string,
  compiled: CompiledParserConfig
): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length < 3) return false;

  // Step 1: includePatterns override everything
  for (const rule of compiled.includeRules) {
    if (rule.test(trimmed)) return true;
  }

  // Step 2: structural heuristic
  if (!looksLikePath(trimmed)) return false;

  // Step 3: exclusion rules
  for (const rule of compiled.excludeRules) {
    if (rule.test(trimmed)) return false;
  }

  // Step 4: accept
  return true;
}

// ─── Extraction sources ───────────────────────────────────────────

/** Extract candidates from inline backticks (existing behavior) */
function extractFromBackticks(body: string): string[] {
  const re = /`([^`]+)`/g;
  const candidates: string[] = [];
  let match;
  while ((match = re.exec(body)) !== null) {
    candidates.push(match[1]);
  }
  return candidates;
}

/** Extract candidates from fenced code blocks (line by line) */
function extractFromCodeBlocks(body: string): string[] {
  const blockRe = /```[\w]*\n([\s\S]*?)```/g;
  const candidates: string[] = [];
  let match;
  while ((match = blockRe.exec(body)) !== null) {
    const blockContent = match[1];
    for (const line of blockContent.split('\n')) {
      // Tokenize each line on whitespace and extract path-like tokens
      for (const token of line.trim().split(/\s+/)) {
        candidates.push(token);
      }
    }
  }
  return candidates;
}

/** Extract candidates from markdown table cells */
function extractFromTables(body: string): string[] {
  const candidates: string[] = [];
  for (const line of body.split('\n')) {
    if (!line.includes('|')) continue;
    // Skip separator lines (|---|---|)
    if (/^\s*\|[\s-:|]+\|\s*$/.test(line)) continue;

    const cells = line.split('|').slice(1, -1); // Remove first/last empty splits
    for (const cell of cells) {
      // Tokenize cell content on whitespace
      for (const token of cell.trim().split(/\s+/)) {
        candidates.push(token);
      }
    }
  }
  return candidates;
}

/** Extract candidates from plain text (whitespace-bounded tokens) */
function extractFromPlainText(body: string): string[] {
  const candidates: string[] = [];
  // Strip code blocks and tables first to avoid double-extraction
  const stripped = body
    .replace(/```[\w]*\n[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');

  for (const line of stripped.split('\n')) {
    if (line.includes('|')) continue; // Skip table lines
    for (const token of line.trim().split(/\s+/)) {
      candidates.push(token);
    }
  }
  return candidates;
}

// ─── Public API ───────────────────────────────────────────────────

export async function parseSkillFile(filePath: string): Promise<ParsedSkill> {
  const content = await readFile(filePath, 'utf-8');
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    return { name: '', description: '', body: content.trim() };
  }

  const [, frontmatter, body] = match;
  const fields = parseFrontmatter(frontmatter);

  return {
    name: fields.name || '',
    description: fields.description || '',
    body: body.trim(),
  };
}

function parseFrontmatter(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    const strMatch = value.match(YAML_STRING_RE);
    if (strMatch) value = strMatch[1];
    fields[key] = value;
  }
  return fields;
}

/**
 * Extract file paths referenced in a skill body.
 * Scans backticks, code blocks, tables, and plain text (configurable).
 * Applies configurable exclusion/inclusion pipeline.
 */
export function extractReferencedFiles(body: string, config?: ParserConfig): string[] {
  const compiled = compileConfig(config);
  const refs = new Set<string>();

  // Gather candidates from each enabled source
  const candidates: string[] = [];

  if (compiled.sources.backtick) {
    candidates.push(...extractFromBackticks(body));
  }
  if (compiled.sources.codeBlock) {
    candidates.push(...extractFromCodeBlocks(body));
  }
  if (compiled.sources.table) {
    candidates.push(...extractFromTables(body));
  }
  if (compiled.sources.plainText) {
    candidates.push(...extractFromPlainText(body));
  }

  // Run each candidate through the evaluation pipeline
  for (const candidate of candidates) {
    // Clean trailing punctuation that markdown/prose adds
    const cleaned = candidate.replace(/[,;:)}\]]+$/, '').replace(/^[({[]+/, '');
    if (evaluateCandidate(cleaned, compiled)) {
      refs.add(cleaned);
    }
  }

  return [...refs];
}

export function extractReferencedTools(body: string): string[] {
  const found = new Set<string>();
  for (const tool of KNOWN_TOOLS) {
    const re = new RegExp(`\\b${tool}\\b`, 'g');
    if (re.test(body)) {
      found.add(tool);
    }
  }
  return [...found];
}
