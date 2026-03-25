import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SkillRegistry, SkillRecord } from './types.js';
import { readJson, writeJsonAtomic } from './storage.js';
import { parseSkillFile, extractReferencedFiles, extractReferencedTools } from './parser.js';

const REGISTRY_FILE = 'registry.json';
const CURRENT_SCHEMA_VERSION = 1;

export class RegistryManager {
  private registry: SkillRegistry = { schemaVersion: CURRENT_SCHEMA_VERSION, skills: [] };
  private projectRoot: string;
  private telemetryDir: string;

  constructor(projectRoot: string, telemetryDir: string) {
    this.projectRoot = projectRoot;
    this.telemetryDir = telemetryDir;
  }

  async scan(skillPaths: string[]): Promise<SkillRegistry> {
    const existing = await readJson<SkillRegistry>(join(this.telemetryDir, REGISTRY_FILE));
    const existingMap = new Map<string, SkillRecord>();
    if (existing?.skills) {
      for (const skill of existing.skills) {
        existingMap.set(skill.name, skill);
      }
    }

    const skills: SkillRecord[] = [];

    for (const skillPath of skillPaths) {
      const absPath = join(this.projectRoot, skillPath);
      const isAgent = skillPath.includes('agents');
      const entries = await safeReaddir(absPath);

      for (const entry of entries) {
        const entryPath = join(absPath, entry);
        const entryStat = await safeStat(entryPath);
        if (!entryStat?.isDirectory()) continue;

        const skillFile = join(entryPath, 'SKILL.md');
        const skillStat = await safeStat(skillFile);
        if (!skillStat) continue;

        const parsed = await parseSkillFile(skillFile);
        if (!parsed.name) continue;

        const prev = existingMap.get(parsed.name);
        const referencedFiles = extractReferencedFiles(parsed.body);
        const referencedTools = extractReferencedTools(parsed.body);

        skills.push({
          id: prev?.id || randomUUID(),
          name: parsed.name,
          description: parsed.description,
          filePath: relative(this.projectRoot, skillFile),
          type: isAgent ? 'agent' : 'skill',
          version: prev?.version || 1,
          tags: prev?.tags || [],
          referencedFiles,
          referencedTools,
          triggerPatterns: [],
          brokenReferences: prev?.brokenReferences || [],
          lastModified: skillStat.mtime.toISOString(),
          lastVerifiedAt: prev?.lastVerifiedAt || new Date().toISOString(),
        });
      }
    }

    this.registry = { schemaVersion: CURRENT_SCHEMA_VERSION, skills };
    await writeJsonAtomic(join(this.telemetryDir, REGISTRY_FILE), this.registry);
    return this.registry;
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
