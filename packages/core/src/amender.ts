import { readFile, writeFile, mkdir, copyFile, stat, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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
import { readJson, appendJsonl, readJsonl, writeJsonAtomic } from './storage.js';
import {
  createBranch,
  checkoutBranch,
  commitFile,
  getCurrentBranch,
  deleteBranch,
  branchExists,
} from './git.js';

const AMENDMENTS_FILE = 'amendments.jsonl';
const PROPOSALS_DIR = '.proposals';
const BACKUPS_DIR = 'backups';
const PROPOSAL_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AmendmentProposal {
  id: string;
  skillId: string;
  skillName: string;
  skillPath: string;
  changeType: AmendmentChangeType;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  originalContent: string;
  proposedContent: string;
  diff: string;
  diffSummary: string;
  evidence: string[];
  evidenceSummary: EvidenceSummary;
  createdAt: string;
}

export interface DiagnoseResult {
  summary: {
    totalFlagged: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  };
  proposals: AmendmentProposal[];
  skipped: string[];
}

export interface ApplyResult {
  applied: Array<{
    skillName: string;
    skillPath: string;
    changeType: AmendmentChangeType;
    backupPath: string;
    status: 'applied';
  }>;
  failed: Array<{
    skillName: string;
    reason: string;
  }>;
  rollbackHint: string;
}

// Keep legacy interface for backward compat with CLI amend command
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

  // ─── Phase 1: Diagnose (read-only) ──────────────────────────────

  /**
   * Generate proposals for flagged skills without modifying anything.
   * Proposals are persisted to .proposals/ for later apply.
   */
  async diagnose(flagged: FlaggedSkill[]): Promise<DiagnoseResult> {
    const registry = await readJson<SkillRegistry>(join(this.telemetryDir, 'registry.json'));
    if (!registry) return { summary: { totalFlagged: 0, bySeverity: {}, byType: {} }, proposals: [], skipped: [] };

    const runs = await readJsonl<SkillRun>(join(this.telemetryDir, 'runs.jsonl'));
    const proposals: AmendmentProposal[] = [];
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
    }

    // Persist proposals for Phase 2
    await this.saveProposals(proposals);

    // Build summary
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const p of proposals) {
      bySeverity[p.severity] = (bySeverity[p.severity] || 0) + 1;
      byType[p.changeType] = (byType[p.changeType] || 0) + 1;
    }

    return {
      summary: { totalFlagged: proposals.length, bySeverity, byType },
      proposals,
      skipped,
    };
  }

  // ─── Phase 2: Apply (writes files) ──────────────────────────────

  /**
   * Apply selected proposals in-place with backups.
   * Accepts proposal IDs or a filter.
   */
  async applyFixes(options: {
    proposalIds?: string[];
    filter?: { severity?: string; changeType?: string };
  }): Promise<ApplyResult> {
    const proposals = await this.loadProposals();
    let selected: AmendmentProposal[];

    if (options.proposalIds) {
      selected = proposals.filter(p => options.proposalIds!.includes(p.id));
    } else if (options.filter) {
      selected = proposals.filter(p => {
        if (options.filter!.severity && p.severity !== options.filter!.severity) return false;
        if (options.filter!.changeType && p.changeType !== options.filter!.changeType) return false;
        return true;
      });
    } else {
      selected = proposals;
    }

    const applied: ApplyResult['applied'] = [];
    const failed: ApplyResult['failed'] = [];

    for (const proposal of selected) {
      try {
        const backupPath = await this.applyInPlace(proposal);
        applied.push({
          skillName: proposal.skillName,
          skillPath: proposal.skillPath,
          changeType: proposal.changeType,
          backupPath,
          status: 'applied',
        });
      } catch (err) {
        failed.push({
          skillName: proposal.skillName,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Clean up applied proposals
    for (const a of applied) {
      const proposalId = selected.find(p => p.skillName === a.skillName)?.id;
      if (proposalId) await this.deleteProposal(proposalId);
    }

    return {
      applied,
      failed,
      rollbackHint: applied.length > 0
        ? 'To undo any fix, use: /sl rollback <skill-name>'
        : '',
    };
  }

  /**
   * Apply a single proposal in-place: backup original, write new content, record amendment.
   */
  private async applyInPlace(proposal: AmendmentProposal): Promise<string> {
    const skillPath = join(this.projectRoot, proposal.skillPath);

    // Verify file hasn't changed since proposal was generated
    const currentContent = await readFile(skillPath, 'utf-8');
    if (currentContent !== proposal.originalContent) {
      throw new Error('File has changed since proposal was generated — re-run diagnose');
    }

    // Create backup
    const backupsDir = join(this.telemetryDir, BACKUPS_DIR);
    await mkdir(backupsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${proposal.skillName}-${timestamp}.md`;
    const backupPath = join(backupsDir, backupName);
    await copyFile(skillPath, backupPath);

    // Write amended content
    await writeFile(skillPath, proposal.proposedContent, 'utf-8');

    // Record amendment
    const amendment: Amendment = {
      id: randomUUID(),
      skillId: proposal.skillId,
      skillVersion: 1,
      proposedAt: proposal.createdAt,
      reason: proposal.reason,
      changeType: proposal.changeType,
      diff: proposal.diff,
      evidence: proposal.evidence,
      evidenceSummary: proposal.evidenceSummary,
      status: 'accepted',
      backupPath: backupName,
      applyMode: 'in-place',
      appliedAt: new Date().toISOString(),
    };

    await appendJsonl(join(this.telemetryDir, AMENDMENTS_FILE), amendment);
    return backupPath;
  }

  // ─── Rollback ───────────────────────────────────────────────────

  /**
   * Rollback an in-place amendment by restoring from backup.
   */
  async rollback(skillName: string): Promise<{ success: boolean; message: string }> {
    const amendments = await readJsonl<Amendment>(join(this.telemetryDir, AMENDMENTS_FILE));
    const registry = await readJson<SkillRegistry>(join(this.telemetryDir, 'registry.json'));

    // Find the most recent in-place amendment for this skill
    const skill = registry?.skills.find(s => s.name === skillName);
    if (!skill) return { success: false, message: `Skill "${skillName}" not found in registry` };

    const amendment = amendments
      .filter(a => a.skillId === skill.id && a.applyMode === 'in-place' && a.status === 'accepted' && a.backupPath)
      .pop();

    if (!amendment) return { success: false, message: `No in-place amendment found for "${skillName}"` };

    const backupPath = join(this.telemetryDir, BACKUPS_DIR, amendment.backupPath!);
    const skillPath = join(this.projectRoot, skill.filePath);

    try {
      await stat(backupPath);
    } catch {
      return { success: false, message: `Backup file not found: ${amendment.backupPath}` };
    }

    await copyFile(backupPath, skillPath);

    // Record rollback
    const rollbackRecord: Amendment = {
      ...amendment,
      id: randomUUID(),
      status: 'rolled_back',
      rollbackOf: amendment.id,
      rollbackAt: new Date().toISOString(),
    };
    await appendJsonl(join(this.telemetryDir, AMENDMENTS_FILE), rollbackRecord);

    return { success: true, message: `Restored "${skillName}" from backup` };
  }

  // ─── Legacy branch-based flow (for CLI amend command) ───────────

  /**
   * Legacy: generate and apply amendments on git branches.
   * Kept for CLI backward compatibility.
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
        const amendment = await this.applyOnBranch(proposal, skill);
        if (amendment) {
          applied.push(amendment);
        } else {
          skipped.push(`${flag.skillName}: failed to apply amendment`);
        }
      }
    }

    return { proposals, applied, skipped };
  }

  // ─── Proposal persistence ───────────────────────────────────────

  private async saveProposals(proposals: AmendmentProposal[]): Promise<void> {
    const dir = join(this.telemetryDir, PROPOSALS_DIR);
    await mkdir(dir, { recursive: true });

    // Clean expired proposals first
    await this.cleanExpiredProposals();

    for (const p of proposals) {
      await writeJsonAtomic(join(dir, `${p.id}.json`), p);
    }
  }

  private async loadProposals(): Promise<AmendmentProposal[]> {
    const dir = join(this.telemetryDir, PROPOSALS_DIR);
    const entries = await safeReaddir(dir);
    const proposals: AmendmentProposal[] = [];
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const p = await readJson<AmendmentProposal>(join(dir, entry));
      if (!p) continue;
      if (now - new Date(p.createdAt).getTime() > PROPOSAL_TTL_MS) {
        await safeUnlink(join(dir, entry));
        continue;
      }
      proposals.push(p);
    }

    return proposals;
  }

  private async deleteProposal(id: string): Promise<void> {
    await safeUnlink(join(this.telemetryDir, PROPOSALS_DIR, `${id}.json`));
  }

  private async cleanExpiredProposals(): Promise<void> {
    const dir = join(this.telemetryDir, PROPOSALS_DIR);
    const entries = await safeReaddir(dir);
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const p = await readJson<AmendmentProposal>(join(dir, entry));
      if (p && now - new Date(p.createdAt).getTime() > PROPOSAL_TTL_MS) {
        await safeUnlink(join(dir, entry));
      }
    }
  }

  // ─── Proposal generation (shared) ──────────────────────────────

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
    const recentRuns = skillRuns.slice(-50);
    const failures = recentRuns.filter(r => r.outcome === 'failure');
    const evidenceIds = failures.slice(-10).map(r => r.id);
    const totalRuns = recentRuns.length;
    const failureRate = totalRuns > 0 ? failures.length / totalRuns : 0;

    const evidenceSummary: EvidenceSummary = {
      failureRate,
      sampleSize: totalRuns,
      timeWindowDays: 30,
    };

    const hasBrokenRefs = flag.reasons.some(r => r.includes('broken references'));
    const hasHighFailure = flag.reasons.some(r => r.includes('Failure rate'));
    const hasBadRouting = flag.reasons.some(r => r.includes('Negative feedback'));
    const isDegrading = flag.reasons.some(r => r.includes('degrading'));
    const hasDrift = flag.reasons.some(r => r.includes('Content drift'));

    let changeType: AmendmentChangeType;
    let proposedContent: string;
    let reason: string;
    let diffSummary: string;

    if (hasBrokenRefs && skill.brokenReferences.length > 0) {
      changeType = 'reference';
      reason = `${skill.brokenReferences.length} referenced file(s) no longer exist: ${skill.brokenReferences.join(', ')}`;
      diffSummary = `Annotate ${skill.brokenReferences.length} broken file references as missing`;
      proposedContent = this.fixBrokenReferences(originalContent, skill.brokenReferences);
    } else if (hasDrift) {
      changeType = 'content_drift';
      const driftReason = flag.reasons.find(r => r.includes('Content drift')) ?? 'Content drift detected';
      reason = driftReason;
      diffSummary = 'Add content drift warning banner';
      proposedContent = this.addDriftWarning(originalContent, driftReason);
    } else if (hasBadRouting) {
      changeType = 'trigger';
      reason = 'Skill is being selected for wrong tasks (high negative feedback rate)';
      diffSummary = 'Add routing guard note to reduce misrouting';
      proposedContent = this.addRoutingGuard(originalContent, skill, recentRuns);
    } else if (hasHighFailure || isDegrading) {
      changeType = 'instruction';
      const dominantError = this.getDominantError(failures);
      reason = `High failure rate (${(failureRate * 100).toFixed(0)}%)${dominantError ? ` — dominant error: ${dominantError}` : ''}`;
      diffSummary = 'Add Known Issues section with recent error patterns';
      proposedContent = this.addFailureContext(originalContent, failures);
    } else {
      return null;
    }

    if (proposedContent === originalContent) return null;

    const diff = createUnifiedDiff(originalContent, proposedContent, skill.filePath);

    return {
      id: `prop-${randomUUID().slice(0, 8)}`,
      skillId: skill.id,
      skillName: skill.name,
      skillPath: skill.filePath,
      changeType,
      reason,
      severity: flag.severity,
      originalContent,
      proposedContent,
      diff,
      diffSummary,
      evidence: evidenceIds,
      evidenceSummary,
      createdAt: new Date().toISOString(),
    };
  }

  // ─── Branch-based apply (legacy) ────────────────────────────────

  private async applyOnBranch(proposal: AmendmentProposal, skill: SkillRecord): Promise<Amendment | null> {
    const originalBranch = await getCurrentBranch(this.projectRoot);
    const shortHash = randomUUID().slice(0, 8);
    const branchName = `skill-loop/amend-${proposal.skillName}-${shortHash}`;

    if (await branchExists(this.projectRoot, branchName)) return null;

    const branchResult = await createBranch(this.projectRoot, branchName);
    if (!branchResult.success) return null;

    try {
      const skillPath = join(this.projectRoot, skill.filePath);
      await writeFile(skillPath, proposal.proposedContent, 'utf-8');

      const commitMsg = `skill-loop: amend ${proposal.skillName} (${proposal.changeType})`;
      const commitResult = await commitFile(this.projectRoot, skill.filePath, commitMsg);
      if (!commitResult.success) {
        await checkoutBranch(this.projectRoot, originalBranch);
        await deleteBranch(this.projectRoot, branchName);
        return null;
      }

      const amendment: Amendment = {
        id: randomUUID(),
        skillId: proposal.skillId,
        skillVersion: skill.version,
        proposedAt: new Date().toISOString(),
        reason: proposal.reason,
        changeType: proposal.changeType,
        diff: proposal.diff,
        evidence: proposal.evidence,
        evidenceSummary: proposal.evidenceSummary,
        status: 'proposed',
        branchName,
        applyMode: 'branch',
      };

      await checkoutBranch(this.projectRoot, originalBranch);
      await appendJsonl(join(this.telemetryDir, AMENDMENTS_FILE), amendment);
      return amendment;
    } catch {
      await checkoutBranch(this.projectRoot, originalBranch);
      try { await deleteBranch(this.projectRoot, branchName); } catch { /* ignore */ }
      return null;
    }
  }

  // ─── Fix strategies ─────────────────────────────────────────────

  private fixBrokenReferences(content: string, brokenRefs: string[]): string {
    let result = content;
    const annotation = '*(file not found — may have moved)*';
    for (const ref of brokenRefs) {
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('`' + escaped + '`(?!\\s*\\*\\(file not found)', 'g');
      result = result.replace(re, `\`${ref}\` ${annotation}`);
    }
    return result;
  }

  private addRoutingGuard(content: string, _skill: SkillRecord, runs: SkillRun[]): string {
    const negativeRuns = runs.filter(r => r.userFeedback === 'negative' || r.userFeedback === 'correction');
    if (negativeRuns.length === 0) return content;

    const frontmatterEnd = content.indexOf('---', content.indexOf('---') + 3);
    if (frontmatterEnd === -1) return content;
    if (content.includes('**Routing note:**')) return content;

    const insertPoint = content.indexOf('\n', frontmatterEnd) + 1;
    const guard = '\n> **Routing note:** This skill has been misrouted frequently. Only use when the task specifically matches the description above.\n';

    return content.slice(0, insertPoint) + guard + content.slice(insertPoint);
  }

  private addFailureContext(content: string, failures: SkillRun[]): string {
    const errorDetails = failures
      .filter(r => r.errorDetail)
      .map(r => r.errorDetail!)
      .slice(-5);

    if (errorDetails.length === 0) return content;

    if (content.includes('## Known Issues (auto-detected by skill-loop)')) {
      content = content.replace(/\n## Known Issues \(auto-detected by skill-loop\)[\s\S]*?Consider these failure modes when executing this skill\.\n?/, '');
    }

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

  private addDriftWarning(content: string, driftReason: string): string {
    const driftMarker = '> **Content drift warning';
    if (content.includes(driftMarker)) {
      content = content.replace(/\n> \*\*Content drift warning[^\n]*\n/g, '');
    }

    const frontmatterEnd = content.indexOf('---', content.indexOf('---') + 3);
    if (frontmatterEnd === -1) return content;

    const insertPoint = content.indexOf('\n', frontmatterEnd) + 1;
    const warning = `\n> **Content drift warning (auto-detected by skill-loop):** ${driftReason}. Review and update this skill's domain knowledge, then re-save to reset the drift clock.\n`;

    return content.slice(0, insertPoint) + warning + content.slice(insertPoint);
  }

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

async function safeReaddir(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
}

async function safeUnlink(path: string): Promise<void> {
  try { await unlink(path); } catch { /* ignore */ }
}
