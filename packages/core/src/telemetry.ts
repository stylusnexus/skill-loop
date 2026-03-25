import { join } from 'node:path';
import type { SkillRun, RunsIndex, RunIndexEntry } from './types.js';
import { appendJsonl, readJson, writeJsonAtomic, readJsonl } from './storage.js';

const RUNS_FILE = 'runs.jsonl';
const INDEX_FILE = 'runs-index.json';

export class TelemetryWriter {
  private telemetryDir: string;

  constructor(telemetryDir: string) {
    this.telemetryDir = telemetryDir;
  }

  async logRun(run: SkillRun): Promise<void> {
    await appendJsonl(join(this.telemetryDir, RUNS_FILE), run);
    await this.updateIndex(run);
  }

  async getRunCount(): Promise<number> {
    const index = await readJson<RunsIndex>(join(this.telemetryDir, INDEX_FILE));
    return index?.entries.length ?? 0;
  }

  async getAllRuns(): Promise<SkillRun[]> {
    return readJsonl<SkillRun>(join(this.telemetryDir, RUNS_FILE));
  }

  async getIndex(): Promise<RunsIndex | null> {
    return readJson<RunsIndex>(join(this.telemetryDir, INDEX_FILE));
  }

  private async updateIndex(run: SkillRun): Promise<void> {
    const indexPath = join(this.telemetryDir, INDEX_FILE);
    const existing = await readJson<RunsIndex>(indexPath) ?? {
      builtAt: new Date().toISOString(),
      entries: [],
    };

    const entry: RunIndexEntry = {
      id: run.id,
      skillId: run.skillId,
      skillVersion: run.skillVersion,
      timestamp: run.timestamp,
      outcome: run.outcome,
      platform: run.platform,
    };

    existing.entries.push(entry);
    existing.builtAt = new Date().toISOString();
    await writeJsonAtomic(indexPath, existing);
  }
}
