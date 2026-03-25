import { readFile } from 'node:fs/promises';

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

export function extractReferencedFiles(body: string): string[] {
  const backtickRe = /`([^`]+)`/g;
  const pathRe = /^[\w@.-][\w/.@-]*\.\w{1,10}$/;
  const refs = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(body)) !== null) {
    const candidate = match[1];
    if (pathRe.test(candidate) && candidate.includes('/')) {
      refs.add(candidate);
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
