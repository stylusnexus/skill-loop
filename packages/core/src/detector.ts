import { stat, readdir, readFile, rm, mkdir } from 'node:fs/promises';
import { join, relative, sep, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SkillRegistry,
  SkillRecord,
  SkillRun,
  DetectionMethod,
  DetectionSignal,
  DetectedSkillRun,
  DetectionSession,
  DetectionConfig,
  RunOutcome,
} from './types.js';
import { readJson, writeJsonAtomic } from './storage.js';
import { TelemetryWriter } from './telemetry.js';

// ─── Credential Scrubbing ─────────────────────────────────────────

const CREDENTIAL_PATTERN = /\b(TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH)=[^\s]*/gi;

function scrubCredentials(cmd: string): string {
  return cmd.replace(CREDENTIAL_PATTERN, '$1=[REDACTED]');
}

// ─── Registry Cache ───────────────────────────────────────────────

let cachedRegistry: SkillRegistry | null = null;
let cachedRegistryMtime = 0;
let cachedRegistryPath = '';
let filePathIndex = new Map<string, SkillRecord>();
let toolIndex = new Map<string, SkillRecord[]>();

function normalizePath(p: string): string {
  return p.split(sep).join(posix.sep);
}

async function getRegistry(registryPath: string): Promise<SkillRegistry | null> {
  try {
    const s = await stat(registryPath);
    const mtime = s.mtimeMs;

    if (cachedRegistry && cachedRegistryPath === registryPath && mtime === cachedRegistryMtime) {
      return cachedRegistry;
    }

    const raw = await readFile(registryPath, 'utf-8');
    const registry = JSON.parse(raw) as SkillRegistry;

    filePathIndex = new Map();
    toolIndex = new Map();
    for (const skill of registry.skills) {
      filePathIndex.set(normalizePath(skill.filePath), skill);
      for (const tool of skill.referencedTools) {
        const existing = toolIndex.get(tool) ?? [];
        existing.push(skill);
        toolIndex.set(tool, existing);
      }
    }

    cachedRegistry = registry;
    cachedRegistryMtime = mtime;
    cachedRegistryPath = registryPath;
    return registry;
  } catch {
    return null;
  }
}

/** Exported for testing. */
export function _resetCache(): void {
  cachedRegistry = null;
  cachedRegistryMtime = 0;
  cachedRegistryPath = '';
  filePathIndex = new Map();
  toolIndex = new Map();
}

// ─── Detectors ────────────────────────────────────────────────────

function detectExplicit(
  toolName: string,
  toolInput: Record<string, unknown>,
  registry: SkillRegistry,
): DetectionSignal[] {
  if (toolName !== 'Skill') return [];
  const skillName = toolInput?.skill as string | undefined;
  if (!skillName) return [];
  const skill = registry.skills.find(s => s.name === skillName);
  if (!skill) return [];
  return [{
    method: 'explicit',
    confidence: 1.0,
    skillId: skill.id,
    evidence: `Skill tool invoked with skill="${skillName}"`,
  }];
}

function detectSkillFileRead(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectRoot: string,
): DetectionSignal[] {
  if (toolName !== 'Read') return [];
  const filePath = toolInput?.file_path as string | undefined;
  if (!filePath) return [];

  const rel = normalizePath(relative(projectRoot, filePath));
  const skill = filePathIndex.get(rel);
  if (!skill) return [];

  return [{
    method: 'read_skill_file',
    confidence: 0.9,
    skillId: skill.id,
    evidence: `Read ${rel}`,
  }];
}

function detectToolFingerprint(
  toolName: string,
  toolInput: Record<string, unknown>,
  weights: DetectionConfig['confidenceWeights'],
): DetectionSignal[] {
  const signals: DetectionSignal[] = [];
  const toolMatches = toolIndex.get(toolName) ?? [];

  for (const skill of toolMatches) {
    const hasPatterns = skill.triggerPatterns.length > 0;
    if (!hasPatterns) {
      signals.push({
        method: 'tool_fingerprint',
        confidence: weights.tool_fingerprint * 0.5,
        skillId: skill.id,
        evidence: `Tool "${toolName}" is referenced by skill (no trigger patterns)`,
      });
      continue;
    }

    // Limit input string length to mitigate ReDoS from user-supplied patterns
    const inputStr = JSON.stringify(toolInput ?? '').toLowerCase().slice(0, 1000);
    const matched = skill.triggerPatterns.some(p => {
      // Fall back to literal match if regex is invalid
      try { return new RegExp(p, 'i').test(inputStr); }
      catch { return inputStr.includes(p.toLowerCase()); }
    });

    if (matched) {
      signals.push({
        method: 'tool_fingerprint',
        confidence: weights.tool_fingerprint,
        skillId: skill.id,
        evidence: `Tool "${toolName}" + trigger pattern match`,
      });
    }
  }
  return signals;
}

// ─── Scoring ──────────────────────────────────────────────────────

const METHOD_PRIORITY: DetectionMethod[] = [
  'explicit', 'read_skill_file', 'tool_fingerprint', 'file_overlap',
];

export function scoreDetection(signals: DetectionSignal[]): DetectedSkillRun | null {
  if (signals.length === 0) return null;

  const bySkill = new Map<string, DetectionSignal[]>();
  for (const s of signals) {
    const existing = bySkill.get(s.skillId) ?? [];
    existing.push(s);
    bySkill.set(s.skillId, existing);
  }

  let best: DetectedSkillRun | null = null;

  for (const [, skillSignals] of bySkill) {
    const methodBest = new Map<DetectionMethod, number>();
    for (const sig of skillSignals) {
      const current = methodBest.get(sig.method) ?? 0;
      if (sig.confidence > current) methodBest.set(sig.method, sig.confidence);
    }
    const composite = Math.min(
      [...methodBest.values()].reduce((sum, c) => sum + c, 0),
      1.0,
    );

    const primary = [...skillSignals].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return METHOD_PRIORITY.indexOf(a.method) - METHOD_PRIORITY.indexOf(b.method);
    })[0];

    if (!best || composite > best.compositeConfidence) {
      best = { signals: skillSignals, primarySignal: primary, compositeConfidence: composite };
    }
  }
  return best;
}

// ─── Session Store ────────────────────────────────────────────────

const SESSIONS_DIR = '.sessions';

async function sessionsDir(telemetryDir: string): Promise<string> {
  const dir = join(telemetryDir, SESSIONS_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeSession(telemetryDir: string, session: DetectionSession): Promise<void> {
  const dir = await sessionsDir(telemetryDir);
  await writeJsonAtomic(join(dir, `${session.sessionId}.json`), session);
}

async function findActiveSession(
  telemetryDir: string,
  skillId: string,
): Promise<DetectionSession | null> {
  const dir = join(telemetryDir, SESSIONS_DIR);
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const session = await readJson<DetectionSession>(join(dir, f));
      if (session?.skillId === skillId) return session;
    }
  } catch { /* no sessions dir */ }
  return null;
}

async function findMostRecentSession(
  telemetryDir: string,
): Promise<DetectionSession | null> {
  const dir = join(telemetryDir, SESSIONS_DIR);
  try {
    const files = await readdir(dir);
    let best: DetectionSession | null = null;
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const session = await readJson<DetectionSession>(join(dir, f));
      if (!session) continue;
      if (!best || session.lastActivityAt > best.lastActivityAt) {
        best = session;
      }
    }
    return best;
  } catch { /* no sessions dir */ }
  return null;
}

async function deleteSession(telemetryDir: string, sessionId: string): Promise<void> {
  const dir = join(telemetryDir, SESSIONS_DIR);
  await rm(join(dir, `${sessionId}.json`), { force: true });
}

async function pruneExpiredSessions(
  telemetryDir: string,
  windowMs: number,
): Promise<void> {
  const dir = join(telemetryDir, SESSIONS_DIR);
  const now = Date.now();
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const filePath = join(dir, f);
      const session = await readJson<DetectionSession>(filePath);
      if (!session) { await rm(filePath, { force: true }); continue; }
      const age = now - new Date(session.lastActivityAt).getTime();
      if (age > windowMs) {
        await commitSession(telemetryDir, session, 'unknown', undefined);
        await rm(filePath, { force: true });
      }
    }
  } catch { /* no sessions dir */ }
}

async function commitSession(
  telemetryDir: string,
  session: DetectionSession,
  outcome: RunOutcome,
  errorDetail: string | undefined,
): Promise<void> {
  const run: SkillRun = {
    id: session.runId,
    skillId: session.skillId,
    skillVersion: session.skillVersion,
    timestamp: session.startedAt,
    platform: 'claude',
    taskContext: session.taskContext,
    taskTags: [],
    outcome,
    errorType: errorDetail ? 'runtime_error' : undefined,
    errorDetail: errorDetail?.slice(0, 500),
    durationMs: Date.now() - new Date(session.startedAt).getTime(),
    detectionMethod: session.primaryMethod,
    detectionConfidence: session.compositeConfidence,
    detectionSignals: session.signals,
  };

  const writer = new TelemetryWriter(telemetryDir);
  await writer.logRun(run);
}

function mergeSignals(
  existing: DetectionSignal[],
  incoming: DetectionSignal[],
): DetectionSignal[] {
  const merged = [...existing];
  for (const sig of incoming) {
    const dup = merged.find(
      s => s.method === sig.method && s.skillId === sig.skillId,
    );
    if (!dup) merged.push(sig);
    else if (sig.confidence > dup.confidence) {
      dup.confidence = sig.confidence;
      dup.evidence = sig.evidence;
    }
  }
  return merged;
}

// ─── Pipeline ─────────────────────────────────────────────────────

export interface PreEvent {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
}

export interface PostEvent {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  tool_error?: string;
  session_id?: string;
}

// ─── Session Listing (for CLI/MCP) ────────────────────────────────

export async function listSessions(telemetryDir: string): Promise<DetectionSession[]> {
  const dir = join(telemetryDir, SESSIONS_DIR);
  const sessions: DetectionSession[] = [];
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const session = await readJson<DetectionSession>(join(dir, f));
      if (session) sessions.push(session);
    }
  } catch { /* no sessions dir */ }
  return sessions;
}

// ─── Detection Stats (for status command) ─────────────────────────

export interface DetectionStats {
  explicit: number;
  read_skill_file: number;
  tool_fingerprint: number;
  file_overlap: number;
  untracked: number;
}

export function computeDetectionStats(runs: { detectionMethod?: DetectionMethod }[]): DetectionStats {
  const stats: DetectionStats = { explicit: 0, read_skill_file: 0, tool_fingerprint: 0, file_overlap: 0, untracked: 0 };
  for (const run of runs) {
    const method = run.detectionMethod;
    if (method && method in stats) {
      stats[method as keyof Omit<DetectionStats, 'untracked'>]++;
    } else {
      stats.untracked++;
    }
  }
  return stats;
}

// ─── Dry-Run Detector (for testing detection against hypothetical events) ──

export async function dryRunDetect(
  projectRoot: string,
  telemetryDir: string,
  config: DetectionConfig,
  event: PreEvent,
): Promise<DetectedSkillRun | null> {
  const registryPath = join(telemetryDir, 'registry.json');
  const registry = await getRegistry(registryPath);
  if (!registry) return null;

  const enabled = config.enabledMethods;
  const signals: DetectionSignal[] = [];

  if (enabled.includes('explicit')) {
    signals.push(...detectExplicit(event.tool_name, event.tool_input, registry));
  }
  if (enabled.includes('read_skill_file')) {
    signals.push(...detectSkillFileRead(event.tool_name, event.tool_input, projectRoot));
  }
  if (enabled.includes('tool_fingerprint')) {
    signals.push(...detectToolFingerprint(event.tool_name, event.tool_input, config.confidenceWeights));
  }

  return scoreDetection(signals);
}

// ─── Pipeline ─────────────────────────────────────────────────────

export class DetectionPipeline {
  private projectRoot: string;
  private telemetryDir: string;
  private config: DetectionConfig;

  constructor(projectRoot: string, telemetryDir: string, config: DetectionConfig) {
    this.projectRoot = projectRoot;
    this.telemetryDir = telemetryDir;
    this.config = config;
  }

  async handlePreEvent(event: PreEvent): Promise<void> {
    if (!this.config.enabled) return;

    const registryPath = join(this.telemetryDir, 'registry.json');
    const registry = await getRegistry(registryPath);
    if (!registry) return;

    const signals = this.collectSignals(event, registry);
    if (signals.length === 0) return;

    const detection = scoreDetection(signals);
    if (!detection) return;
    if (detection.compositeConfidence < this.config.confidenceThreshold) return;

    const skillId = detection.primarySignal.skillId;

    await pruneExpiredSessions(this.telemetryDir, this.config.sessionWindowMs);
    const existingSession = await findActiveSession(this.telemetryDir, skillId);

    if (existingSession) {
      const merged = mergeSignals(existingSession.signals, detection.signals);
      const rescored = scoreDetection(merged);
      if (rescored) {
        existingSession.signals = merged;
        existingSession.compositeConfidence = rescored.compositeConfidence;
        existingSession.primaryMethod = rescored.primarySignal.method;
      }
      existingSession.lastActivityAt = new Date().toISOString();
      await writeSession(this.telemetryDir, existingSession);
      return;
    }

    const skill = registry.skills.find(s => s.id === skillId);
    if (!skill) return;

    const session: DetectionSession = {
      sessionId: event.session_id ?? randomUUID(),
      skillId,
      skillVersion: skill.version,
      openedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      runId: randomUUID(),
      startedAt: new Date().toISOString(),
      primaryMethod: detection.primarySignal.method,
      compositeConfidence: detection.compositeConfidence,
      taskContext: this.extractTaskContext(event),
      signals: detection.signals,
    };
    await writeSession(this.telemetryDir, session);
  }

  async handlePostEvent(event: PostEvent): Promise<void> {
    if (!this.config.enabled) return;

    const session = await findMostRecentSession(this.telemetryDir);
    if (!session) return;

    const shouldClose = this.shouldCloseSession(session, event);
    if (!shouldClose) return;

    const outcome: RunOutcome = event.tool_error ? 'failure' : 'success';
    await commitSession(this.telemetryDir, session, outcome, event.tool_error);
    await deleteSession(this.telemetryDir, session.sessionId);
  }

  private collectSignals(event: PreEvent, registry: SkillRegistry): DetectionSignal[] {
    const enabled = this.config.enabledMethods;
    const signals: DetectionSignal[] = [];

    if (enabled.includes('explicit')) {
      signals.push(...detectExplicit(event.tool_name, event.tool_input, registry));
    }
    if (enabled.includes('read_skill_file')) {
      signals.push(...detectSkillFileRead(event.tool_name, event.tool_input, this.projectRoot));
    }
    if (enabled.includes('tool_fingerprint')) {
      signals.push(...detectToolFingerprint(event.tool_name, event.tool_input, this.config.confidenceWeights));
    }

    return signals;
  }

  private shouldCloseSession(session: DetectionSession, event: PostEvent): boolean {
    if (event.tool_error) return true;
    if (session.primaryMethod === 'explicit') return true;

    if (session.primaryMethod === 'read_skill_file') {
      const skill = cachedRegistry?.skills.find(s => s.id === session.skillId);
      if (!skill) return true;
      if (skill.referencedTools.includes(event.tool_name)) return false;
      return true;
    }

    // tool_fingerprint sessions close on TTL only
    return false;
  }

  private extractTaskContext(event: PreEvent): string {
    if (event.tool_name === 'Skill') {
      return typeof event.tool_input === 'object'
        ? JSON.stringify(event.tool_input).slice(0, 200)
        : '';
    }
    // For non-Skill tools, only capture safe fields
    if (event.tool_name === 'Read') {
      return `Read ${event.tool_input?.file_path ?? ''}`.slice(0, 200);
    }
    if (event.tool_name === 'Bash') {
      const cmd = String(event.tool_input?.command ?? '');
      return `Bash: ${scrubCredentials(cmd)}`.slice(0, 200);
    }
    return `${event.tool_name} call`.slice(0, 200);
  }
}
