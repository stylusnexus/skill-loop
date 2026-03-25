import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUnifiedDiff } from './diff.js';
import type {
  Amendment,
  AmendmentChangeType,
  SkillRecord,
  SkillRegistry,
  SkillRun,
  EvidenceSummary,
  SkillLoopConfig,
} from './types.js';
import type { FlaggedSkill } from './inspector.js';
import { readJson, appendJsonl, readJsonl } from './storage.js';
import {
  createBranch,
  checkoutBranch,
  commitFile,
  getCurrentBranch,
  deleteBranch,
  branchExists,
} from './git.js';

const AMENDMENTS_FILE = 'amendments.jsonl';

export interface AmendmentProposal {
  skillId: string;
  skillName: string;
  changeType: AmendmentChangeType;
  reason: string;
  originalContent: string;
  proposedContent: string;
  evidence: string[];
  evidenceSummary: EvidenceSummary;
}

export interface AmendResult {
  proposals: AmendmentProposal[];
  applied: Amendment[];
  skipped: string[];
}

export class Amender {
  private projectRoot: string;
  private telemetryDir: string;
  private config: SkillLoopConfig;

  constructor(projectRoot: string, telemetryDir: string, config: SkillLoopConfig) {
    this.projectRoot = projectRoot;
    this.telemetryDir = telemetryDir;
    this.config = config;
  }

  /**
   * Generate amendment proposals for flagged skills.
   * If dryRun is true, returns proposals without creating branches.
   */
  async amend(flagged: FlaggedSkill[], dryRun: boolean = false): Promise<AmendResult> {
    const registry = await readJson<SkillRegistry>(join(this.telemetryDir, 'registry.json'));
    if (!registry) return { proposals: [], applied: [], skipped: [] };

    const runs = await readJsonl<SkillRun>(join(this.telemetryDir, 'runs.jsonl'));
    const proposals: AmendmentProposal[] = [];
    const applied: Amendment[] = [];
    const skipped: string[] = [];

    for (const flag of flagged) {
      const skill = registry.skills.find(s => s.id === flag.skillId);
      if (!skill) {
        skipped.push(`${flag.skillName}: not found in registry`);
        continue;
      }

      const proposal = await this.generateProposal(skill, flag, runs);
      if (!proposal) {
        skipped.push(`${flag.skillName}: no actionable amendment found`);
        continue;
      }

      proposals.push(proposal);

      if (!dryRun) {
        const amendment = await this.applyProposal(proposal, skill);
        if (amendment) {
          applied.push(amendment);
        } else {
          skipped.push(`${flag.skillName}: failed to apply amendment`);
        }
      }
    }

    return { proposals, applied, skipped };
  }

  /**
   * Generate a proposal for a flagged skill based on its issues.
   */
  private async generateProposal(
    skill: SkillRecord,
    flag: FlaggedSkill,
    runs: SkillRun[]
  ): Promise<AmendmentProposal | null> {
    const skillPath = join(this.projectRoot, skill.filePath);
    let originalContent: string;
    try {
      originalContent = await readFile(skillPath, 'utf-8');
    } catch {
      return null;
    }

    const skillRuns = runs.filter(r => r.skillId === skill.id);
    const recentRuns = skillRuns.slice(-50); // Last 50 runs
    const failures = recentRuns.filter(r => r.outcome === 'failure');
    const evidenceIds = failures.slice(-10).map(r => r.id);
    const totalRuns = recentRuns.length;
    const failureRate = totalRuns > 0 ? failures.length / totalRuns : 0;

    const evidenceSummary: EvidenceSummary = {
      failureRate,
      sampleSize: totalRuns,
      timeWindowDays: 30,
    };

    // Determine change type and generate fix
    const hasBrokenRefs = flag.reasons.some(r => r.includes('broken references'));
    const hasHighFailure = flag.reasons.some(r => r.includes('Failure rate'));
    const hasBadRouting = flag.reasons.some(r => r.includes('Negative feedback'));
    const isDegrading = flag.reasons.some(r => r.includes('degrading'));

    let changeType: AmendmentChangeType;
    let proposedContent: string;
    let reason: string;

    if (hasBrokenRefs && skill.brokenReferences.length > 0) {
      // Auto-fixable: comment out broken references
      changeType = 'reference';
      reason = `${skill.brokenReferences.length} referenced file(s) no longer exist: ${skill.brokenReferences.join(', ')}`;
      proposedContent = this.fixBrokenReferences(originalContent, skill.brokenReferences);
    } else if (hasBadRouting) {
      // Tighten the trigger/description
      changeType = 'trigger';
      reason = `Skill is being selected for wrong tasks (high negative feedback rate)`;
      proposedContent = this.addRoutingGuard(originalContent, skill, recentRuns);
    } else if (hasHighFailure || isDegrading) {
      // Add error context to instructions
      changeType = 'instruction';
      const dominantError = this.getDominantError(failures);
      reason = `High failure rate (${(failureRate * 100).toFixed(0)}%)${dominantError ? ` — dominant error: ${dominantError}` : ''}`;
      proposedContent = this.addFailureContext(originalContent, failures);
    } else {
      return null;
    }

    // Only propose if content actually changed
    if (proposedContent === originalContent) return null;

    return {
      skillId: skill.id,
      skillName: skill.name,
      changeType,
      reason,
      originalContent,
      proposedContent,
      evidence: evidenceIds,
      evidenceSummary,
    };
  }

  /**
   * Apply a proposal: create branch, write changes, commit, record amendment.
   */
  private async applyProposal(proposal: AmendmentProposal, skill: SkillRecord): Promise<Amendment | null> {
    const originalBranch = await getCurrentBranch(this.projectRoot);
    const shortHash = randomUUID().slice(0, 8);
    const branchName = `skill-loop/amend-${proposal.skillName}-${shortHash}`;

    // Check if branch already exists
    if (await branchExists(this.projectRoot, branchName)) {
      return null;
    }

    const branchResult = await createBranch(this.projectRoot, branchName);
    if (!branchResult.success) {
      return null;
    }

    try {
      // Write amended content
      const skillPath = join(this.projectRoot, skill.filePath);
      await writeFile(skillPath, proposal.proposedContent, 'utf-8');

      // Commit
      const commitMsg = `skill-loop: amend ${proposal.skillName} (${proposal.changeType})`;
      const commitResult = await commitFile(this.projectRoot, skill.filePath, commitMsg);
      if (!commitResult.success) {
        await checkoutBranch(this.projectRoot, originalBranch);
        await deleteBranch(this.projectRoot, branchName);
        return null;
      }

      // Record amendment
      const diff = createUnifiedDiff(
        proposal.originalContent,
        proposal.proposedContent,
        skill.filePath
      );

      const amendment: Amendment = {
        id: randomUUID(),
        skillId: proposal.skillId,
        skillVersion: skill.version,
        proposedAt: new Date().toISOString(),
        reason: proposal.reason,
        changeType: proposal.changeType,
        diff,
        evidence: proposal.evidence,
        evidenceSummary: proposal.evidenceSummary,
        status: 'proposed',
        branchName,
      };

      // Go back to original branch before writing amendment log
      await checkoutBranch(this.projectRoot, originalBranch);

      await appendJsonl(join(this.telemetryDir, AMENDMENTS_FILE), amendment);
      return amendment;
    } catch {
      // Cleanup on failure
      await checkoutBranch(this.projectRoot, originalBranch);
      try { await deleteBranch(this.projectRoot, branchName); } catch { /* ignore */ }
      return null;
    }
  }

  /**
   * Fix broken file references by commenting them out with a note.
   */
  private fixBrokenReferences(content: string, brokenRefs: string[]): string {
    let result = content;
    for (const ref of brokenRefs) {
      // Replace backtick-quoted references with a note
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('`' + escaped + '`', 'g');
      result = result.replace(re, `\`${ref}\` *(file not found — may have moved)*`);
    }
    return result;
  }

  /**
   * Add a routing guard to the skill description to reduce misrouting.
   */
  private addRoutingGuard(content: string, _skill: SkillRecord, runs: SkillRun[]): string {
    // Find runs with negative feedback to understand what tasks trigger misrouting
    const negativeRuns = runs.filter(r => r.userFeedback === 'negative' || r.userFeedback === 'correction');
    if (negativeRuns.length === 0) return content;

    // Add a "Do NOT use for" section after the frontmatter
    const frontmatterEnd = content.indexOf('---', content.indexOf('---') + 3);
    if (frontmatterEnd === -1) return content;

    const insertPoint = content.indexOf('\n', frontmatterEnd) + 1;
    const guard = '\n> **Routing note:** This skill has been misrouted frequently. Only use when the task specifically matches the description above.\n';

    return content.slice(0, insertPoint) + guard + content.slice(insertPoint);
  }

  /**
   * Add failure context to help prevent repeated errors.
   */
  private addFailureContext(content: string, failures: SkillRun[]): string {
    const errorDetails = failures
      .filter(r => r.errorDetail)
      .map(r => r.errorDetail!)
      .slice(-5);

    if (errorDetails.length === 0) return content;

    // Deduplicate similar errors
    const unique = [...new Set(errorDetails.map(e => e.slice(0, 100)))];

    const section = [
      '',
      '## Known Issues (auto-detected by skill-loop)',
      '',
      'The following errors have been observed during recent runs:',
      '',
      ...unique.map(e => `- ${e}`),
      '',
      'Consider these failure modes when executing this skill.',
      '',
    ].join('\n');

    return content.trimEnd() + '\n' + section;
  }

  /**
   * Get the most common error type from failed runs.
   */
  private getDominantError(failures: SkillRun[]): string | undefined {
    const counts = new Map<string, number>();
    for (const run of failures) {
      if (run.errorType) {
        counts.set(run.errorType, (counts.get(run.errorType) || 0) + 1);
      }
    }
    let max = 0;
    let dominant: string | undefined;
    for (const [type, count] of counts) {
      if (count > max) { max = count; dominant = type; }
    }
    return dominant;
  }
}
