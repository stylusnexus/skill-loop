import { stat, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SkillRegistry,
  SkillRecord,
  SkillRun,
  SkillPattern,
  PatternCache,
  ErrorType,
  SkillLoopConfig,
} from './types.js';
import { readJson, writeJsonAtomic, readJsonl } from './storage.js';

export interface InspectResult {
  timestamp: string;
  skillCount: number;
  totalRuns: number;
  patterns: SkillPattern[];
  flagged: FlaggedSkill[];
}

export interface FlaggedSkill {
  skillId: string;
  skillName: string;
  reasons: string[];
  severity: 'low' | 'medium' | 'high';
}

export class Inspector {
  private projectRoot: string;
  private telemetryDir: string;
  private config: SkillLoopConfig;

  constructor(projectRoot: string, telemetryDir: string, config: SkillLoopConfig) {
    this.projectRoot = projectRoot;
    this.telemetryDir = telemetryDir;
    this.config = config;
  }

  /**
   * Run full inspection: compute patterns, detect staleness, flag issues.
   * Optionally filter to a single skill by name.
   */
  async inspect(skillName?: string): Promise<InspectResult> {
    const registry = await readJson<SkillRegistry>(join(this.telemetryDir, 'registry.json'));
    if (!registry || registry.skills.length === 0) {
      return { timestamp: new Date().toISOString(), skillCount: 0, totalRuns: 0, patterns: [], flagged: [] };
    }

    const runs = await readJsonl<SkillRun>(join(this.telemetryDir, 'runs.jsonl'));
    const now = new Date();
    // Use a 30-day window for pattern analysis
    const analysisWindowMs = 30 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - analysisWindowMs);

    const recentRuns = runs.filter(r => new Date(r.timestamp) >= cutoff);

    let skills = registry.skills;
    if (skillName) {
      skills = skills.filter(s => s.name === skillName);
    }

    const patterns: SkillPattern[] = [];
    const flagged: FlaggedSkill[] = [];

    for (const skill of skills) {
      const skillRuns = recentRuns.filter(r => r.skillId === skill.id);
      const totalRuns = skillRuns.length;

      // Failure rate
      const failures = skillRuns.filter(r => r.outcome === 'failure').length;
      const failureRate = totalRuns > 0 ? failures / totalRuns : 0;

      // Negative feedback rate
      const negFeedback = skillRuns.filter(r => r.userFeedback === 'negative' || r.userFeedback === 'correction').length;
      const negativeFeedbackRate = totalRuns > 0 ? negFeedback / totalRuns : 0;

      // Dominant error type
      const errorCounts = new Map<ErrorType, number>();
      for (const run of skillRuns) {
        if (run.errorType) {
          errorCounts.set(run.errorType, (errorCounts.get(run.errorType) || 0) + 1);
        }
      }
      let dominantErrorType: ErrorType | undefined;
      let maxErrorCount = 0;
      for (const [errType, count] of errorCounts) {
        if (count > maxErrorCount) {
          maxErrorCount = count;
          dominantErrorType = errType;
        }
      }

      // Staleness score
      const stalenessScore = await this.computeStaleness(skill);

      // Last run
      const lastRun = skillRuns.length > 0
        ? skillRuns.reduce((a, b) => new Date(a.timestamp) > new Date(b.timestamp) ? a : b)
        : null;

      // Trend: compare first half vs second half of window
      const trend = this.computeTrend(skillRuns);

      const pattern: SkillPattern = {
        skillId: skill.id,
        failureRate,
        totalRuns,
        negativeFeedbackRate,
        dominantErrorType,
        stalenessScore,
        lastRunAt: lastRun?.timestamp ?? '',
        trend,
      };
      patterns.push(pattern);

      // Flag issues
      const reasons: string[] = [];
      if (failureRate >= this.config.thresholds.failureRateAlert && totalRuns >= 3) {
        reasons.push(`Failure rate ${(failureRate * 100).toFixed(0)}% exceeds threshold ${(this.config.thresholds.failureRateAlert * 100).toFixed(0)}%`);
      }
      if (negativeFeedbackRate >= this.config.thresholds.negativeFeedbackAlert && totalRuns >= 3) {
        reasons.push(`Negative feedback rate ${(negativeFeedbackRate * 100).toFixed(0)}% exceeds threshold`);
      }
      if (stalenessScore > 0.5) {
        reasons.push(`Staleness score ${stalenessScore.toFixed(2)} — ${skill.brokenReferences.length} broken references`);
      }
      if (totalRuns === 0) {
        const lastModified = new Date(skill.lastModified);
        const daysSinceModified = (now.getTime() - lastModified.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceModified > this.config.thresholds.deadSkillDays) {
          reasons.push(`No runs in ${this.config.thresholds.deadSkillDays}+ days — possibly dead skill`);
        }
      }
      if (trend === 'degrading') {
        reasons.push('Performance trend is degrading (failure rate increasing)');
      }

      if (reasons.length > 0) {
        const severity: 'low' | 'medium' | 'high' =
          failureRate >= 0.5 || stalenessScore >= 0.8 ? 'high' :
          failureRate >= this.config.thresholds.failureRateAlert || stalenessScore > 0.5 ? 'medium' :
          'low';
        flagged.push({ skillId: skill.id, skillName: skill.name, reasons, severity });
      }
    }

    // Write pattern cache
    const runsJsonlPath = join(this.telemetryDir, 'runs.jsonl');
    let mtime = '';
    try {
      const s = await stat(runsJsonlPath);
      mtime = s.mtime.toISOString();
    } catch { /* no runs file */ }

    const cache: PatternCache = {
      builtAt: new Date().toISOString(),
      runsJsonlMtime: mtime,
      patterns,
    };
    const cacheDir = join(this.telemetryDir, 'cache');
    await mkdir(cacheDir, { recursive: true });
    await writeJsonAtomic(join(cacheDir, 'patterns.json'), cache);

    // Write report
    const reportsDir = join(this.telemetryDir, 'reports');
    await mkdir(reportsDir, { recursive: true });
    const result: InspectResult = {
      timestamp: new Date().toISOString(),
      skillCount: skills.length,
      totalRuns: recentRuns.length,
      patterns,
      flagged,
    };
    const dateStr = new Date().toISOString().split('T')[0];
    await writeJsonAtomic(join(reportsDir, `inspect-${dateStr}.json`), result);

    // Update broken references in registry
    await this.updateBrokenReferences(registry);

    return result;
  }

  /**
   * Compute staleness score (0-1) based on broken file references.
   */
  private async computeStaleness(skill: SkillRecord): Promise<number> {
    if (skill.referencedFiles.length === 0) {
      return 0;
    }

    let broken = 0;
    const total = skill.referencedFiles.length;

    for (const filePath of skill.referencedFiles) {
      const absPath = join(this.projectRoot, filePath);
      try {
        await access(absPath);
      } catch {
        broken++;
      }
    }

    return total > 0 ? broken / total : 0;
  }

  /**
   * Compute trend by comparing failure rates in first vs second half of runs.
   */
  private computeTrend(runs: SkillRun[]): SkillPattern['trend'] {
    if (runs.length < 6) return 'insufficient_data';

    const sorted = [...runs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);

    const firstFailRate = firstHalf.filter(r => r.outcome === 'failure').length / firstHalf.length;
    const secondFailRate = secondHalf.filter(r => r.outcome === 'failure').length / secondHalf.length;

    const diff = secondFailRate - firstFailRate;
    if (diff > 0.1) return 'degrading';
    if (diff < -0.1) return 'improving';
    return 'stable';
  }

  /**
   * Update the registry with broken references found during inspection.
   */
  private async updateBrokenReferences(registry: SkillRegistry): Promise<void> {
    let changed = false;
    for (const skill of registry.skills) {
      const broken: string[] = [];
      for (const filePath of skill.referencedFiles) {
        const absPath = join(this.projectRoot, filePath);
        try {
          await access(absPath);
        } catch {
          broken.push(filePath);
        }
      }
      if (JSON.stringify(broken) !== JSON.stringify(skill.brokenReferences)) {
        skill.brokenReferences = broken;
        skill.lastVerifiedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      await writeJsonAtomic(join(this.telemetryDir, 'registry.json'), registry);
    }
  }
}
