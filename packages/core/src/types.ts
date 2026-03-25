// ─── Skill Registry ───────────────────────────────────────────────

export interface SkillRegistry {
  schemaVersion: number;
  skills: SkillRecord[];
}

export interface SkillRecord {
  /** UUID, generated on first registration, permanent */
  id: string;
  /** From SKILL.md frontmatter */
  name: string;
  /** From frontmatter */
  description: string;
  /** Relative to project root (mutable metadata) */
  filePath: string;
  /** .claude/skills/ vs .claude/agents/ */
  type: 'skill' | 'agent';
  /** Increments on each accepted amendment */
  version: number;
  /** Domain tags for filtering and cohort analysis */
  tags: string[];
  /** File paths mentioned in the skill body */
  referencedFiles: string[];
  /** Tool names mentioned (Bash, Grep, etc.) */
  referencedTools: string[];
  /** Extracted from description/trigger conditions */
  triggerPatterns: string[];
  /** Files/tools that no longer exist (set by inspector) */
  brokenReferences: string[];
  /** ISO timestamp */
  lastModified: string;
  /** ISO timestamp of last staleness check */
  lastVerifiedAt: string;
}

// ─── Run Log ──────────────────────────────────────────────────────

export interface SkillRun {
  /** UUID */
  id: string;
  /** Links to SkillRecord.id */
  skillId: string;
  /** Version of the skill at invocation time */
  skillVersion: number;
  /** ISO timestamp */
  timestamp: string;
  platform: Platform;
  /** User's intent, truncated to 200 chars */
  taskContext: string;
  /** Normalized labels for cohort analysis */
  taskTags: string[];
  outcome: RunOutcome;
  errorType?: ErrorType;
  /** Truncated error message */
  errorDetail?: string;
  userFeedback?: UserFeedback;
  /** Required. -1 if unmeasurable */
  durationMs: number;
  /** Set if running under an evaluation */
  amendmentId?: string;
}

export type Platform = 'claude' | 'codex' | 'copilot' | 'cli';
export type RunOutcome = 'success' | 'failure' | 'partial' | 'unknown';
export type ErrorType = 'tool_not_found' | 'stale_reference' | 'wrong_routing' | 'runtime_error';
export type UserFeedback = 'positive' | 'negative' | 'correction';

// ─── Runs Index (derived, rebuildable) ────────────────────────────

export interface RunsIndex {
  builtAt: string;
  entries: RunIndexEntry[];
}

export interface RunIndexEntry {
  id: string;
  skillId: string;
  skillVersion: number;
  timestamp: string;
  outcome: RunOutcome;
  platform: Platform;
}

// ─── Amendments ───────────────────────────────────────────────────

export interface Amendment {
  id: string;
  skillId: string;
  /** Version being amended */
  skillVersion: number;
  /** ISO timestamp */
  proposedAt: string;
  /** Human-readable explanation */
  reason: string;
  changeType: AmendmentChangeType;
  /** Unified diff of the SKILL.md change */
  diff: string;
  /** Run IDs that triggered this proposal */
  evidence: string[];
  evidenceSummary: EvidenceSummary;
  status: AmendmentStatus;
  /** 0-1, success rate on amended version */
  evaluationScore?: number;
  /** 0-1, success rate on original version */
  baselineScore?: number;
  /** How many runs in the evaluation */
  evaluationRunCount?: number;
  /** Git branch for the PR */
  branchName?: string;
  /** ISO timestamp when accepted/merged */
  appliedAt?: string;
  /** skill-loop engine version that applied it */
  appliedByVersion?: string;
  /** Amendment ID if this is a rollback record */
  rollbackOf?: string;
  /** ISO timestamp of rollback */
  rollbackAt?: string;
}

export type AmendmentChangeType = 'trigger' | 'instruction' | 'reference' | 'output_format' | 'guard';
export type AmendmentStatus = 'proposed' | 'evaluating' | 'accepted' | 'rejected' | 'rolled_back';

export interface EvidenceSummary {
  failureRate: number;
  sampleSize: number;
  timeWindowDays: number;
}

// ─── Pattern Cache (derived, rebuildable) ─────────────────────────

export interface PatternCache {
  builtAt: string;
  runsJsonlMtime: string;
  patterns: SkillPattern[];
}

export interface SkillPattern {
  skillId: string;
  failureRate: number;
  totalRuns: number;
  negativeFeedbackRate: number;
  dominantErrorType?: ErrorType;
  stalenessScore: number;
  lastRunAt: string;
  trend: 'improving' | 'stable' | 'degrading' | 'insufficient_data';
}

// ─── External Sync ────────────────────────────────────────────────

/**
 * Sync plugins receive data AFTER core-level sanitization.
 * Sensitive fields (taskContext, errorDetail) are redacted by the core
 * before reaching the plugin. Plugins cannot access raw sensitive data
 * unless the user explicitly opts in via sync.allowSensitiveFields config.
 */
export interface SyncPlugin {
  name: string;
  version: string;
  /** Declare which events this plugin wants. Called before emit. */
  filter(run: SanitizedSkillRun): boolean;
  /** Emit a sync event. Must not throw — errors are swallowed and logged locally. */
  emit(event: SyncEvent): Promise<void>;
}

/**
 * A SkillRun with sensitive fields stripped by the core.
 * This is what plugins receive — never the raw SkillRun.
 */
export interface SanitizedSkillRun {
  id: string;
  skillId: string;
  skillVersion: number;
  timestamp: string;
  platform: Platform;
  /** Redacted to "[redacted]" unless sync.allowSensitiveFields is true */
  taskContext: string;
  taskTags: string[];
  outcome: RunOutcome;
  errorType?: ErrorType;
  /** Redacted to "[redacted]" unless sync.allowSensitiveFields is true */
  errorDetail?: string;
  durationMs: number;
  amendmentId?: string;
}

export type SyncPayload = Record<string, unknown>;

export type SyncEvent =
  | { type: 'run_completed'; payload: SanitizedSkillRun }
  | { type: 'amendment_proposed'; payload: SyncPayload }
  | { type: 'amendment_evaluated'; payload: SyncPayload }
  | { type: 'registry_updated'; payload: SyncPayload };

// ─── Configuration ────────────────────────────────────────────────

export interface SkillLoopConfig {
  schemaVersion: number;
  skillPaths: string[];
  telemetryDir: string;
  thresholds: {
    failureRateAlert: number;
    negativeFeedbackAlert: number;
    deadSkillDays: number;
    amendmentImprovementMin: number;
    rollbackWindowDays: number;
  };
  retention: {
    maxRunAgeDays: number;
    maxFileSizeMB: number;
  };
  sync: {
    plugins: string[];
    /** If true, taskContext and errorDetail are sent to sync plugins. Default: false (redacted). */
    allowSensitiveFields: boolean;
  };
  parser: ParserConfig;
}

export interface ParserConfig {
  /** Additional regex patterns to exclude (merged with built-in defaults). */
  excludePatterns: string[];
  /** If true, replaces built-in defaults instead of merging. */
  excludePatternsOverride: boolean;
  /** Regex patterns that force-include a candidate (overrides exclusions). */
  includePatterns: string[];
  /** Which extraction sources are enabled. */
  sources: {
    backtick: boolean;
    codeBlock: boolean;
    table: boolean;
    plainText: boolean;
  };
}
