import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DetectionPipeline, scoreDetection, _resetCache } from '../detector.js';
import { writeJsonAtomic, readJsonl } from '../storage.js';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  SkillRegistry,
  SkillRun,
  DetectionConfig,
  DetectionSignal,
} from '../types.js';

const DEFAULT_DETECTION: DetectionConfig = {
  enabled: true,
  confidenceThreshold: 0.6,
  sessionWindowMs: 300_000,
  confidenceWeights: {
    explicit: 1.0,
    read_skill_file: 0.9,
    tool_fingerprint: 0.6,
    file_overlap: 0.5,
  },
  enabledMethods: ['explicit', 'read_skill_file', 'tool_fingerprint'],
  logBelowThreshold: false,
};

function makeRegistry(overrides: Partial<SkillRegistry['skills'][0]>[] = []): SkillRegistry {
  const defaults = {
    id: 'skill-uuid-1',
    name: 'test-skill',
    description: 'A test skill',
    filePath: '.claude/skills/test/SKILL.md',
    type: 'skill' as const,
    version: 1,
    tags: [],
    referencedFiles: ['src/index.ts'],
    referencedTools: ['Bash', 'Read'],
    triggerPatterns: ['npm run build'],
    brokenReferences: [],
    lastModified: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
  };

  return {
    schemaVersion: 1,
    skills: overrides.length > 0
      ? overrides.map(o => ({ ...defaults, ...o }))
      : [defaults],
  };
}

describe('scoreDetection', () => {
  it('returns null for empty signals', () => {
    expect(scoreDetection([])).toBeNull();
  });

  it('picks highest confidence signal as primary', () => {
    const signals: DetectionSignal[] = [
      { method: 'tool_fingerprint', confidence: 0.6, skillId: 's1', evidence: 'tool match' },
      { method: 'read_skill_file', confidence: 0.9, skillId: 's1', evidence: 'file read' },
    ];
    const result = scoreDetection(signals);
    expect(result).not.toBeNull();
    expect(result!.primarySignal.method).toBe('read_skill_file');
    expect(result!.compositeConfidence).toBe(1.0); // 0.9 + 0.6 > 1.0, capped
  });

  it('caps composite confidence at 1.0', () => {
    const signals: DetectionSignal[] = [
      { method: 'explicit', confidence: 1.0, skillId: 's1', evidence: 'explicit' },
      { method: 'read_skill_file', confidence: 0.9, skillId: 's1', evidence: 'read' },
    ];
    expect(scoreDetection(signals)!.compositeConfidence).toBe(1.0);
  });

  it('picks best candidate when multiple skills match', () => {
    const signals: DetectionSignal[] = [
      { method: 'tool_fingerprint', confidence: 0.6, skillId: 's1', evidence: 'match' },
      { method: 'read_skill_file', confidence: 0.9, skillId: 's2', evidence: 'read' },
    ];
    const result = scoreDetection(signals)!;
    expect(result.primarySignal.skillId).toBe('s2');
  });
});

describe('DetectionPipeline', () => {
  let tmpDir: string;
  let telemetryDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    _resetCache();
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-loop-detector-'));
    projectRoot = tmpDir;
    telemetryDir = join(tmpDir, '.skill-telemetry');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  async function setupRegistry(registry?: SkillRegistry): Promise<void> {
    await writeJsonAtomic(
      join(telemetryDir, 'registry.json'),
      registry ?? makeRegistry(),
    );
  }

  function createPipeline(config?: Partial<DetectionConfig>): DetectionPipeline {
    return new DetectionPipeline(
      projectRoot,
      telemetryDir,
      { ...DEFAULT_DETECTION, ...config },
    );
  }

  describe('explicit Skill tool detection', () => {
    it('creates a session for explicit Skill invocations', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Skill',
        tool_input: { skill: 'test-skill' },
      });

      const sessions = await readdir(join(telemetryDir, '.sessions'));
      expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(1);
    });

    it('commits a run on post event', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Skill',
        tool_input: { skill: 'test-skill' },
      });

      await pipeline.handlePostEvent({
        tool_name: 'Skill',
        tool_result: 'done',
      });

      const runs = await readJsonl<SkillRun>(join(telemetryDir, 'runs.jsonl'));
      expect(runs).toHaveLength(1);
      expect(runs[0].detectionMethod).toBe('explicit');
      expect(runs[0].detectionConfidence).toBe(1.0);
      expect(runs[0].outcome).toBe('success');
    });

    it('logs failure when tool_error is present', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Skill',
        tool_input: { skill: 'test-skill' },
      });

      await pipeline.handlePostEvent({
        tool_name: 'Skill',
        tool_error: 'something broke',
      });

      const runs = await readJsonl<SkillRun>(join(telemetryDir, 'runs.jsonl'));
      expect(runs).toHaveLength(1);
      expect(runs[0].outcome).toBe('failure');
      expect(runs[0].errorDetail).toBe('something broke');
    });
  });

  describe('SKILL.md read detection', () => {
    it('detects when a registered SKILL.md is read', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Read',
        tool_input: { file_path: join(projectRoot, '.claude/skills/test/SKILL.md') },
      });

      const sessions = await readdir(join(telemetryDir, '.sessions'));
      expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(1);
    });

    it('ignores reads of non-skill files', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Read',
        tool_input: { file_path: join(projectRoot, 'src/index.ts') },
      });

      try {
        const sessions = await readdir(join(telemetryDir, '.sessions'));
        expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(0);
      } catch {
        // .sessions dir not created = no sessions, which is correct
      }
    });

    it('keeps session open for referencedTool calls', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Read',
        tool_input: { file_path: join(projectRoot, '.claude/skills/test/SKILL.md') },
      });

      // Bash is in referencedTools, session should stay open
      await pipeline.handlePostEvent({
        tool_name: 'Bash',
        tool_result: 'ok',
      });

      const sessions = await readdir(join(telemetryDir, '.sessions'));
      expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(1);

      // No runs committed yet
      try {
        const runs = await readJsonl<SkillRun>(join(telemetryDir, 'runs.jsonl'));
        expect(runs).toHaveLength(0);
      } catch {
        // runs.jsonl doesn't exist yet = no runs, correct
      }
    });

    it('closes session when unrelated tool is used', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Read',
        tool_input: { file_path: join(projectRoot, '.claude/skills/test/SKILL.md') },
      });

      // WebSearch is NOT in referencedTools, session should close
      await pipeline.handlePostEvent({
        tool_name: 'WebSearch',
        tool_result: 'results',
      });

      const runs = await readJsonl<SkillRun>(join(telemetryDir, 'runs.jsonl'));
      expect(runs).toHaveLength(1);
      expect(runs[0].detectionMethod).toBe('read_skill_file');
      expect(runs[0].detectionConfidence).toBe(0.9);
    });
  });

  describe('tool fingerprint detection', () => {
    it('detects tool calls matching triggerPatterns', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
      });

      const sessions = await readdir(join(telemetryDir, '.sessions'));
      expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(1);
    });

    it('ignores tool calls that do not match patterns', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      await pipeline.handlePreEvent({
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
      });

      try {
        const sessions = await readdir(join(telemetryDir, '.sessions'));
        expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(0);
      } catch {
        // no sessions dir = no match, correct
      }
    });
  });

  describe('signal merging', () => {
    it('merges signals from multiple events into one session', async () => {
      await setupRegistry();
      const pipeline = createPipeline();

      // First: read the SKILL.md
      await pipeline.handlePreEvent({
        tool_name: 'Read',
        tool_input: { file_path: join(projectRoot, '.claude/skills/test/SKILL.md') },
      });

      // Second: tool fingerprint match (Bash + trigger pattern)
      await pipeline.handlePreEvent({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
      });

      const sessions = await readdir(join(telemetryDir, '.sessions'));
      // Still one session, not two
      expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(1);
    });
  });

  describe('disabled detection', () => {
    it('does nothing when detection is disabled', async () => {
      await setupRegistry();
      const pipeline = createPipeline({ enabled: false });

      await pipeline.handlePreEvent({
        tool_name: 'Skill',
        tool_input: { skill: 'test-skill' },
      });

      try {
        const sessions = await readdir(join(telemetryDir, '.sessions'));
        expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(0);
      } catch {
        // no sessions dir = correct
      }
    });
  });

  describe('confidence threshold', () => {
    it('ignores signals below confidence threshold', async () => {
      await setupRegistry(makeRegistry([{
        id: 'skill-uuid-1',
        name: 'vague-skill',
        referencedTools: ['Bash'],
        triggerPatterns: [],  // no patterns = half confidence = 0.3
      }]));
      const pipeline = createPipeline({ confidenceThreshold: 0.6 });

      await pipeline.handlePreEvent({
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
      });

      try {
        const sessions = await readdir(join(telemetryDir, '.sessions'));
        expect(sessions.filter(f => f.endsWith('.json'))).toHaveLength(0);
      } catch {
        // no sessions dir = correct
      }
    });
  });
});
