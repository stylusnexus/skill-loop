import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type {
  Amendment,
  SkillRun,
  SkillLoopConfig,
} from './types.js';
import { readJsonl } from './storage.js';
import { getCurrentBranch, deleteBranch } from './git.js';

export interface EvaluationResult {
  amendmentId: string;
  passed: boolean;
  evaluationScore: number;
  baselineScore: number;
  evaluationRunCount: number;
  reason: string;
}

export class Evaluator {
  private projectRoot: string;
  private telemetryDir: string;
  private config: SkillLoopConfig;

  constructor(projectRoot: string, telemetryDir: string, config: SkillLoopConfig) {
    this.projectRoot = projectRoot;
    this.telemetryDir = telemetryDir;
    this.config = config;
  }

  /**
   * Evaluate a proposed amendment.
   * Uses heuristic scoring since we can't re-run skills directly.
   */
  async evaluate(amendmentId: string): Promise<EvaluationResult> {
    // Find the amendment
    const amendments = await readJsonl<Amendment>(join(this.telemetryDir, 'amendments.jsonl'));
    const amendment = amendments.find(a => a.id === amendmentId);

    if (!amendment) {
      return {
        amendmentId,
        passed: false,
        evaluationScore: 0,
        baselineScore: 0,
        evaluationRunCount: 0,
        reason: 'Amendment not found',
      };
    }

    if (amendment.status !== 'proposed') {
      return {
        amendmentId,
        passed: false,
        evaluationScore: 0,
        baselineScore: 0,
        evaluationRunCount: 0,
        reason: `Amendment is already ${amendment.status}`,
      };
    }

    // Get the evidence runs
    const allRuns = await readJsonl<SkillRun>(join(this.telemetryDir, 'runs.jsonl'));
    const evidenceRuns = allRuns.filter(r => amendment.evidence.includes(r.id));
    const skillRuns = allRuns.filter(r => r.skillId === amendment.skillId);

    // Baseline: success rate of the skill before amendment
    const baselineRuns = skillRuns.slice(-50);
    const baselineSuccesses = baselineRuns.filter(r => r.outcome === 'success').length;
    const baselineScore = baselineRuns.length > 0 ? baselineSuccesses / baselineRuns.length : 0;

    // Evaluation score: heuristic based on amendment quality
    const score = this.scoreAmendment(amendment, evidenceRuns, baselineRuns);

    const improvementMin = this.config.thresholds.amendmentImprovementMin;
    const passed = score > baselineScore + improvementMin;

    // Update amendment status
    await this.updateAmendmentStatus(
      amendments,
      amendmentId,
      passed ? 'accepted' : 'rejected',
      score,
      baselineScore,
      evidenceRuns.length
    );

    // If rejected, clean up branch
    if (!passed && amendment.branchName) {
      const currentBranch = await getCurrentBranch(this.projectRoot);
      if (currentBranch !== amendment.branchName) {
        try { await deleteBranch(this.projectRoot, amendment.branchName); } catch { /* branch may not exist */ }
      }
    }

    return {
      amendmentId,
      passed,
      evaluationScore: score,
      baselineScore,
      evaluationRunCount: evidenceRuns.length,
      reason: passed
        ? `Amendment improves score from ${(baselineScore * 100).toFixed(0)}% to estimated ${(score * 100).toFixed(0)}%`
        : `Amendment does not improve enough: baseline ${(baselineScore * 100).toFixed(0)}%, estimated ${(score * 100).toFixed(0)}% (need +${(improvementMin * 100).toFixed(0)}%)`,
    };
  }

  /**
   * Score an amendment heuristically based on how well it addresses the failure patterns.
   */
  private scoreAmendment(amendment: Amendment, evidenceRuns: SkillRun[], baselineRuns: SkillRun[]): number {
    let score = 0;
    const baselineSuccessRate = baselineRuns.length > 0
      ? baselineRuns.filter(r => r.outcome === 'success').length / baselineRuns.length
      : 0;

    // Start from baseline
    score = baselineSuccessRate;

    // Bonus for addressing specific issues
    switch (amendment.changeType) {
      case 'reference':
        // Fixing broken references is reliable — high confidence
        score += 0.3;
        break;
      case 'trigger':
        // Tightening routing is moderate confidence
        score += 0.2;
        break;
      case 'instruction':
        // Adding failure context is lower confidence (may or may not help)
        score += 0.15;
        break;
      case 'output_format':
        score += 0.2;
        break;
      case 'guard':
        score += 0.25;
        break;
    }

    // Penalty if evidence is too thin
    if (evidenceRuns.length < 3) {
      score *= 0.8;
    }

    // Cap at 1.0
    return Math.min(1.0, score);
  }

  /**
   * Rewrite amendments.jsonl with updated status for a specific amendment.
   */
  private async updateAmendmentStatus(
    amendments: Amendment[],
    amendmentId: string,
    status: Amendment['status'],
    evaluationScore: number,
    baselineScore: number,
    evaluationRunCount: number
  ): Promise<void> {
    const updated = amendments.map(a => {
      if (a.id === amendmentId) {
        return {
          ...a,
          status,
          evaluationScore,
          baselineScore,
          evaluationRunCount,
          ...(status === 'accepted' ? { appliedAt: new Date().toISOString() } : {}),
        };
      }
      return a;
    });

    // Rewrite the file (amendments are few enough for this to be safe)
    const path = join(this.telemetryDir, 'amendments.jsonl');
    const content = updated.map(a => JSON.stringify(a)).join('\n') + '\n';
    await writeFile(path, content, 'utf-8');
  }
}
