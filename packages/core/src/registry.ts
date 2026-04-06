import { readdir, stat, lstat, readFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SkillRegistry, SkillRecord, SkillSource, SkillScope } from './types.js';
import { readJson, writeJsonAtomic } from './storage.js';
import { parseSkillFile, extractReferencedFiles, extractReferencedTools } from './parser.js';

const REGISTRY_FILE = 'registry.json';
const CURRENT_SCHEMA_VERSION = 2;

export class RegistryManager {
  private registry: SkillRegistry = { schemaVersion: CURRENT_SCHEMA_VERSION, skills: [] };
  private projectRoot: string;
  private telemetryDir: string;

  constructor(projectRoot: string, telemetryDir: string) {
    this.projectRoot = projectRoot;
    this.telemetryDir = telemetryDir;
  }

  /**
   * Scan both project-local and global skill paths.
   * Supports two file layouts:
   *   - dir/SKILL.md  (standard skill directory)
   *   - standalone .md files with YAML frontmatter (e.g., agents/*.md)
   */
  async scan(skillPaths: string[], globalSkillPaths: string[] = []): Promise<SkillRegistry> {
    const existing = await readJson<SkillRegistry>(join(this.telemetryDir, REGISTRY_FILE));
    const existingMap = new Map<string, SkillRecord>();
    if (existing?.skills) {
      for (const skill of existing.skills) {
        existingMap.set(skill.name, skill);
      }
    }

    const skills: SkillRecord[] = [];
    const seenNames = new Set<string>();

    // Scan project-local paths (relative to projectRoot)
    for (const skillPath of skillPaths) {
      const absPath = join(this.projectRoot, skillPath);
      await this.scanDirectory(absPath, 'project', existingMap, skills, seenNames);
    }

    // Scan global paths (absolute, e.g., ~/.claude/skills/)
    for (const globalPath of globalSkillPaths) {
      const absPath = isAbsolute(globalPath) ? globalPath : resolve(globalPath);
      // Skip if it's the same directory as a project path (avoid duplicates)
      const projectAbsPaths = skillPaths.map(p => resolve(join(this.projectRoot, p)));
      if (projectAbsPaths.includes(absPath)) continue;
      await this.scanDirectory(absPath, 'global', existingMap, skills, seenNames);
    }

    this.registry = { schemaVersion: CURRENT_SCHEMA_VERSION, skills };
    await writeJsonAtomic(join(this.telemetryDir, REGISTRY_FILE), this.registry);
    return this.registry;
  }

  private async scanDirectory(
    absPath: string,
    scope: SkillScope,
    existingMap: Map<string, SkillRecord>,
    skills: SkillRecord[],
    seenNames: Set<string>,
  ): Promise<void> {
    const entries = await safeReaddir(absPath);

    for (const entry of entries) {
      const entryPath = join(absPath, entry);
      const entryStat = await safeStat(entryPath);
      if (!entryStat) continue;

      if (entryStat.isDirectory()) {
        // Standard layout: dir/SKILL.md
        const skillFile = join(entryPath, 'SKILL.md');
        const skillStat = await safeStat(skillFile);
        if (!skillStat) continue;

        const parsed = await parseSkillFile(skillFile);
        if (!parsed.name || seenNames.has(parsed.name)) continue;

        const source = await detectSource(entryPath);
        const prev = existingMap.get(parsed.name);
        const isAgent = absPath.includes('agents');

        seenNames.add(parsed.name);
        skills.push(buildRecord(parsed, skillFile, skillStat, isAgent, source, scope, prev, this.projectRoot));
      } else if (entry.endsWith('.md') && !entry.startsWith('.')) {
        // Standalone .md file (e.g., agents/ai-engineer.md)
        const parsed = await parseSkillFile(entryPath);
        if (!parsed.name || seenNames.has(parsed.name)) continue;

        const source = await detectSource(entryPath);
        const prev = existingMap.get(parsed.name);
        const isAgent = absPath.includes('agents');

        seenNames.add(parsed.name);
        skills.push(buildRecord(parsed, entryPath, entryStat, isAgent, source, scope, prev, this.projectRoot));
      }
    }
  }

  findByName(name: string): SkillRecord | undefined {
    return this.registry.skills.find((s) => s.name === name);
  }

  findById(id: string): SkillRecord | undefined {
    return this.registry.skills.find((s) => s.id === id);
  }

  getRegistry(): SkillRegistry {
    return this.registry;
  }
}

function buildRecord(
  parsed: { name: string; description: string; body: string },
  filePath: string,
  fileStat: Awaited<ReturnType<typeof stat>>,
  isAgent: boolean,
  source: SkillSource,
  scope: SkillScope,
  prev: SkillRecord | undefined,
  projectRoot: string,
): SkillRecord {
  const referencedFiles = extractReferencedFiles(parsed.body);
  const referencedTools = extractReferencedTools(parsed.body);

  return {
    id: prev?.id || randomUUID(),
    name: parsed.name,
    description: parsed.description,
    filePath: relative(projectRoot, filePath) || filePath,
    type: isAgent ? 'agent' : 'skill',
    version: prev?.version || 1,
    tags: prev?.tags || [],
    referencedFiles,
    referencedTools,
    triggerPatterns: [],
    brokenReferences: prev?.brokenReferences || [],
    lastModified: fileStat.mtime.toISOString(),
    lastVerifiedAt: prev?.lastVerifiedAt || new Date().toISOString(),
    source,
    scope,
  };
}

/**
 * Detect whether a skill is locally authored or installed from a registry.
 * Heuristics:
 *   1. Symlink → installed (agents framework symlinks to ~/.agents/skills/)
 *   2. .clawnet/ directory → installed (skills-installer metadata)
 *   3. Otherwise → local
 */
async function detectSource(entryPath: string): Promise<SkillSource> {
  try {
    const lstats = await lstat(entryPath);
    if (lstats.isSymbolicLink()) return 'installed';
  } catch { /* ignore */ }

  const clawnet = await safeStat(join(entryPath, '.clawnet'));
  if (clawnet) return 'installed';

  return 'local';
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
