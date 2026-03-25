import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillLoopConfig } from './types.js';

export const DEFAULT_CONFIG: SkillLoopConfig = {
  schemaVersion: 1,
  skillPaths: ['.claude/skills', '.claude/agents'],
  telemetryDir: '.skill-telemetry',
  thresholds: {
    failureRateAlert: 0.2,
    negativeFeedbackAlert: 0.3,
    deadSkillDays: 30,
    amendmentImprovementMin: 0.1,
    rollbackWindowDays: 7,
  },
  retention: {
    maxRunAgeDays: 90,
    maxFileSizeMB: 10,
  },
  sync: {
    plugins: [],
    allowSensitiveFields: false,
  },
};

export async function loadConfig(projectRoot: string): Promise<SkillLoopConfig> {
  const configPath = join(projectRoot, 'skill-loop.config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG, userConfig);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function deepMerge<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = (base as any)[key];
    const overVal = override[key];
    if (baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal) && typeof overVal === 'object' && !Array.isArray(overVal)) {
      (result as any)[key] = deepMerge(baseVal, overVal);
    } else {
      (result as any)[key] = overVal;
    }
  }
  return result;
}
