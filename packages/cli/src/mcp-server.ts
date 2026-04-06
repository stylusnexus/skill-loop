#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  RegistryManager,
  TelemetryWriter,
  Inspector,
  Amender,
  Evaluator,
  loadConfig,
  readJson,
  readJsonl,
  listSessions,
  computeDetectionStats,
  dryRunDetect,
} from '@stylusnexus/skill-loop';
import type {
  SkillRegistry,
  SkillRun,
  RunOutcome,
  RunsIndex,
  Amendment,
  DetectionMethod,
} from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

type HookStatus = 'configured' | 'outdated' | 'missing';

async function checkHookStatus(projectRoot: string): Promise<HookStatus> {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    const preHooks: any[] = settings?.hooks?.PreToolUse ?? [];
    const postHooks: any[] = settings?.hooks?.PostToolUse ?? [];
    const findEntry = (entries: any[]) => entries.find((h: any) =>
      h.command?.includes('skill-loop-claude') ||
      h.hooks?.some?.((sub: any) => sub.command?.includes('skill-loop-claude'))
    );
    const hasPre = !!findEntry(preHooks);
    const hasPost = !!findEntry(postHooks);
    if (!hasPre || !hasPost) return 'missing';
    const preEntry = findEntry(preHooks);
    if (preEntry?.matcher === 'Skill') return 'outdated';
    return 'configured';
  } catch {
    return 'missing';
  }
}

const server = new McpServer({
  name: 'skill-loop',
  version: '0.1.0',
});

function getProjectRoot(): string {
  return process.env.SKILL_LOOP_PROJECT_ROOT || process.cwd();
}

// ─── Tool: skill_loop (unified natural language router) ───────────

server.registerTool(
  'skill_loop',
  {
    title: 'Skill Loop',
    description:
      'Universal entry point for skill-loop. Accepts natural language actions like "scan", "status", "review", "fix", "update", or "history". Routes to the appropriate operation internally. Use this when the user asks about skill health in conversational terms.',
    inputSchema: z.object({
      action: z
        .string()
        .describe(
          'What to do. Examples: "scan" (initialize/re-scan skills), "status" (health dashboard), "review" or "inspect" (analyze patterns and flag issues), "fix" or "amend" (propose fixes for broken skills), "update" (re-scan skill registry), "history" or "amendments" (list past amendments), "runs" (show recent runs), "list" (show all skills), "detection" (detection stats and active sessions), "gc" (prune old data)'
        ),
      skillName: z
        .string()
        .optional()
        .describe('Optional skill name to target a specific skill'),
      dryRun: z
        .boolean()
        .optional()
        .describe('For fix/amend: preview changes without applying them'),
    }),
  },
  async ({ action, skillName, dryRun }) => {
    const normalized = action.toLowerCase().trim();
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    // Route to the right operation
    if (['scan', 'init', 'initialize', 'setup'].some((k) => normalized.includes(k))) {
      // Re-scan / initialize
      const { mkdir, readFile, writeFile } = await import('node:fs/promises');
      await mkdir(telemetryDir, { recursive: true });

      const gitignorePath = join(projectRoot, '.gitignore');
      try {
        const content = await readFile(gitignorePath, 'utf-8');
        if (!content.includes(config.telemetryDir)) {
          await writeFile(gitignorePath, content.trimEnd() + `\n${config.telemetryDir}/\n`);
        }
      } catch {
        await writeFile(gitignorePath, `${config.telemetryDir}/\n`);
      }

      const registry = new RegistryManager(projectRoot, telemetryDir);
      const result = await registry.scan(config.skillPaths, config.globalSkillPaths);

      const lines = [`Scanned and registered ${result.skills.length} skills:`];
      for (const skill of result.skills) {
        lines.push(`  ${skill.type}: ${skill.name} (${skill.referencedFiles.length} file refs, ${skill.referencedTools.length} tool refs)`);
      }

      // Check if auto-detection hooks are configured
      const hookStatus = await checkHookStatus(projectRoot);
      if (hookStatus === 'missing') {
        lines.push('', 'Auto-detection hooks are not configured. To enable automatic skill run tracking,');
        lines.push('add to .claude/settings.json:');
        lines.push('  { "hooks": { "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "npx skill-loop-claude pre-hook" }] }],');
        lines.push('    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "npx skill-loop-claude post-hook" }] }] } }');
        lines.push('Or run `npx skill-loop init` interactively to set this up.');
      } else if (hookStatus === 'outdated') {
        lines.push('', 'Auto-detection hooks use the old "Skill" matcher. Update matcher to ".*" in .claude/settings.json for full auto-detection.');
        lines.push('Or run `npx skill-loop init` to upgrade automatically.');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (['update', 'refresh', 'rescan', 're-scan'].some((k) => normalized.includes(k))) {
      // Same as scan but framed as an update
      const registry = new RegistryManager(projectRoot, telemetryDir);
      const result = await registry.scan(config.skillPaths, config.globalSkillPaths);
      return {
        content: [{ type: 'text' as const, text: `Registry updated: ${result.skills.length} skills registered.` }],
      };
    }

    if (['status', 'health', 'check', 'dashboard', 'overview'].some((k) => normalized.includes(k))) {
      // Delegate to status logic
      const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
      const skillCount = registry?.skills.length ?? 0;
      const writer = new TelemetryWriter(telemetryDir);
      const runCount = await writer.getRunCount();
      const index = await writer.getIndex();

      let successes = 0, failures = 0;
      if (index?.entries) {
        for (const entry of index.entries) {
          if (entry.outcome === 'success') successes++;
          if (entry.outcome === 'failure') failures++;
        }
      }

      const lines = [
        `Skills: ${skillCount} registered`,
        `Runs: ${runCount} total (${successes} success, ${failures} failure)`,
      ];
      if (failures > 0 && runCount > 0) {
        lines.push(`Failure rate: ${((failures / runCount) * 100).toFixed(1)}%`);
      }
      if (runCount === 0) {
        lines.push('No runs logged yet. Skills will be tracked as they execute.');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (['review', 'inspect', 'analyze', 'diagnose', 'audit'].some((k) => normalized.includes(k))) {
      try { await stat(telemetryDir); } catch {
        return { content: [{ type: 'text' as const, text: 'Not initialized. Run with action: "scan" first.' }] };
      }

      const inspector = new Inspector(projectRoot, telemetryDir, config);
      const result = await inspector.inspect(skillName);

      const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
      const skillMap = new Map(registry?.skills.map((s) => [s.id, s.name]) ?? []);

      const lines = [`Analyzed ${result.skillCount} skills, ${result.totalRuns} runs in window\n`];
      for (const p of result.patterns) {
        const name = skillMap.get(p.skillId) ?? p.skillId.slice(0, 8);
        const driftInfo = p.driftScore > 0 ? `, ${p.driftScore} drift commits` : '';
        lines.push(`  ${name}: ${p.totalRuns} runs, ${(p.failureRate * 100).toFixed(0)}% fail, ${(p.stalenessScore * 100).toFixed(0)}% stale${driftInfo}, ${p.trend}`);
      }

      if (result.flagged.length > 0) {
        lines.push('', `Flagged (${result.flagged.length}):`);
        for (const f of result.flagged) {
          const icon = f.severity === 'high' ? '[HIGH]' : f.severity === 'medium' ? '[MED]' : '[LOW]';
          lines.push(`  ${icon} ${f.skillName}: ${f.reasons.join('; ')}`);
        }
      } else {
        lines.push('\nAll skills healthy.');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (['fix', 'amend', 'repair', 'patch', 'improve'].some((k) => normalized.includes(k))) {
      try { await stat(telemetryDir); } catch {
        return { content: [{ type: 'text' as const, text: 'Not initialized. Run with action: "scan" first.' }] };
      }

      const inspector = new Inspector(projectRoot, telemetryDir, config);
      const inspection = await inspector.inspect(skillName);

      if (inspection.flagged.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No skills flagged. All healthy.' }] };
      }

      const amender = new Amender(projectRoot, telemetryDir, config);
      const result = await amender.amend(inspection.flagged, dryRun ?? false);

      const lines: string[] = [];
      if (dryRun) lines.push('DRY RUN — no changes made\n');
      if (result.proposals.length > 0) {
        lines.push(`Proposals (${result.proposals.length}):`);
        for (const p of result.proposals) lines.push(`  ${p.skillName} (${p.changeType}): ${p.reason}`);
      }
      if (result.applied.length > 0) {
        lines.push(`\nApplied (${result.applied.length}):`);
        for (const a of result.applied) lines.push(`  ${a.id.slice(0, 8)} on branch ${a.branchName}`);
      }
      if (result.skipped.length > 0) {
        lines.push(`\nSkipped: ${result.skipped.join(', ')}`);
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (['history', 'amendments', 'changes', 'log'].some((k) => normalized.includes(k))) {
      const amendments = await readJsonl<Amendment>(join(telemetryDir, 'amendments.jsonl'));
      if (amendments.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No amendments yet.' }] };
      }
      const output = amendments.map((a) => `${a.id.slice(0, 8)} [${a.status}] ${a.changeType}: ${a.reason}`);
      return { content: [{ type: 'text' as const, text: output.join('\n') }] };
    }

    if (['runs', 'recent', 'activity'].some((k) => normalized.includes(k))) {
      const writer = new TelemetryWriter(telemetryDir);
      const runs = await writer.getAllRuns();
      const recent = runs.reverse().slice(0, 15);
      if (recent.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No runs logged yet.' }] };
      }

      const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
      const skillMap = new Map(registry?.skills.map((s) => [s.id, s.name]) ?? []);

      const lines = recent.map((r) => {
        const name = skillMap.get(r.skillId) ?? r.skillId.slice(0, 8);
        const method = r.detectionMethod ?? 'explicit';
        const methodTag = method !== 'explicit' ? ` [${method}]` : '';
        return `${r.timestamp.slice(0, 16)} ${name}: ${r.outcome}${r.durationMs > 0 ? ` (${r.durationMs}ms)` : ''}${methodTag}`;
      });
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (['list', 'skills', 'show'].some((k) => normalized.includes(k))) {
      const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
      if (!registry || registry.skills.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No skills registered. Run with action: "scan" first.' }] };
      }
      const lines = registry.skills.map((s) => `  ${s.type}: ${s.name} v${s.version} — ${s.description || '(no description)'}`);
      return { content: [{ type: 'text' as const, text: `${registry.skills.length} skills:\n${lines.join('\n')}` }] };
    }

    if (['detection', 'detect', 'sessions', 'auto-detect', 'autodetect'].some((k) => normalized.includes(k))) {
      const writer = new TelemetryWriter(telemetryDir);
      const allRuns = await writer.getAllRuns();
      const stats = computeDetectionStats(allRuns);
      const sessions = await listSessions(telemetryDir);

      const lines = ['Detection stats:'];
      const total = stats.explicit + stats.read_skill_file + stats.tool_fingerprint + stats.file_overlap + stats.untracked;
      if (total === 0) {
        lines.push('  No runs logged yet.');
      } else {
        if (stats.explicit > 0) lines.push(`  Explicit (Skill tool): ${stats.explicit}`);
        if (stats.read_skill_file > 0) lines.push(`  SKILL.md read:        ${stats.read_skill_file}`);
        if (stats.tool_fingerprint > 0) lines.push(`  Tool fingerprint:     ${stats.tool_fingerprint}`);
        if (stats.file_overlap > 0) lines.push(`  File overlap:         ${stats.file_overlap}`);
        if (stats.untracked > 0) lines.push(`  Legacy (pre-detect):  ${stats.untracked}`);
        const autoDetected = stats.read_skill_file + stats.tool_fingerprint + stats.file_overlap;
        lines.push(`  Auto-detected: ${autoDetected}/${total} (${((autoDetected / total) * 100).toFixed(0)}%)`);
      }

      lines.push('', `Active sessions: ${sessions.length}`);
      if (sessions.length > 0) {
        const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
        const skillMap = new Map(registry?.skills.map((s) => [s.id, s.name]) ?? []);
        for (const s of sessions) {
          const name = skillMap.get(s.skillId) ?? s.skillId.slice(0, 8);
          lines.push(`  ${name}: ${s.primaryMethod} (${(s.compositeConfidence * 100).toFixed(0)}% confidence)`);
        }
      }

      lines.push('', `Config: threshold=${config.detection.confidenceThreshold}, window=${config.detection.sessionWindowMs / 1000}s, methods=${config.detection.enabledMethods.join(',')}`);

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (['gc', 'clean', 'prune', 'cleanup'].some((k) => normalized.includes(k))) {
      const { gc } = await import('@stylusnexus/skill-loop');
      const result = await gc(telemetryDir, config);
      return {
        content: [{ type: 'text' as const, text: `Pruned ${result.pruned} old runs (${result.runsBefore} → ${result.runsAfter}).` }],
      };
    }

    // Unknown action — help text
    return {
      content: [{
        type: 'text' as const,
        text: [
          `Unknown action: "${action}"`,
          '',
          'Available actions:',
          '  scan / init    — Scan and register skills',
          '  update         — Re-scan skill registry',
          '  status         — Health dashboard',
          '  review         — Analyze patterns and flag issues',
          '  fix            — Propose amendments for broken skills',
          '  list           — Show all registered skills',
          '  runs           — Show recent activity',
          '  history        — List past amendments',
          '  detection      — Detection stats and active sessions',
          '  gc             — Prune old run data',
        ].join('\n'),
      }],
    };
  }
);

// ─── Tool: skill_loop_status ──────────────────────────────────────

server.registerTool(
  'skill_loop_status',
  {
    title: 'Skill Loop Status',
    description:
      'Get the health status of all registered AI coding tool skills. Shows skill count, run totals, outcome breakdown (success/failure/partial), storage sizes, and overall failure rate. Use this to check if skills are healthy or degrading.',
    inputSchema: z.object({}),
  },
  async () => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    try {
      await stat(telemetryDir);
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'skill-loop is not initialized. Run `npx skill-loop init` first.',
          },
        ],
      };
    }

    const registry = await readJson<SkillRegistry>(
      join(telemetryDir, 'registry.json')
    );
    const skillCount = registry?.skills.length ?? 0;

    const writer = new TelemetryWriter(telemetryDir);
    const runCount = await writer.getRunCount();
    const index = await writer.getIndex();

    let successes = 0,
      failures = 0,
      partials = 0,
      unknowns = 0;
    if (index?.entries) {
      for (const entry of index.entries) {
        switch (entry.outcome) {
          case 'success':
            successes++;
            break;
          case 'failure':
            failures++;
            break;
          case 'partial':
            partials++;
            break;
          case 'unknown':
            unknowns++;
            break;
        }
      }
    }

    const lines = [
      `Skills registered: ${skillCount}`,
      `Total runs logged: ${runCount}`,
      `  Success: ${successes}  Failure: ${failures}  Partial: ${partials}  Unknown: ${unknowns}`,
    ];

    if (failures > 0 && runCount > 0) {
      const failRate = ((failures / runCount) * 100).toFixed(1);
      lines.push(`Overall failure rate: ${failRate}%`);
    }

    if (runCount > 0) {
      const allRuns = await writer.getAllRuns();
      const stats = computeDetectionStats(allRuns);
      const autoDetected = stats.read_skill_file + stats.tool_fingerprint + stats.file_overlap;
      lines.push(`Auto-detected runs: ${autoDetected}/${runCount} (${((autoDetected / runCount) * 100).toFixed(0)}%)`);
    }

    if (skillCount > 0) {
      lines.push('', 'Registered skills:');
      for (const skill of registry!.skills) {
        const skillRuns =
          index?.entries.filter((e) => e.skillId === skill.id) ?? [];
        const skillFailures = skillRuns.filter(
          (e) => e.outcome === 'failure'
        ).length;
        const status =
          skillRuns.length === 0
            ? 'no runs'
            : skillFailures > 0
              ? `${skillFailures}/${skillRuns.length} failures`
              : `${skillRuns.length} runs, all OK`;
        lines.push(`  ${skill.type}: ${skill.name} — ${status}`);
      }
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ─── Tool: skill_loop_list ────────────────────────────────────────

server.registerTool(
  'skill_loop_list',
  {
    title: 'List Skills',
    description:
      'List all registered skills with their metadata: name, type, version, referenced files, referenced tools, and broken references. Use this to understand what skills are available and their current state.',
    inputSchema: z.object({
      name: z
        .string()
        .optional()
        .describe('Filter by skill name (exact match)'),
    }),
  },
  async ({ name }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    const registry = await readJson<SkillRegistry>(
      join(telemetryDir, 'registry.json')
    );
    if (!registry || registry.skills.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No skills registered. Run `npx skill-loop init` first.',
          },
        ],
      };
    }

    const skills = name
      ? registry.skills.filter((s) => s.name === name)
      : registry.skills;

    if (skills.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No skill found with name "${name}".`,
          },
        ],
      };
    }

    const output = skills.map((s) => ({
      name: s.name,
      type: s.type,
      version: s.version,
      filePath: s.filePath,
      tags: s.tags,
      referencedFiles: s.referencedFiles,
      referencedTools: s.referencedTools,
      brokenReferences: s.brokenReferences,
      lastModified: s.lastModified,
    }));

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(output, null, 2) },
      ],
    };
  }
);

// ─── Tool: skill_loop_log ─────────────────────────────────────────

server.registerTool(
  'skill_loop_log',
  {
    title: 'Log Skill Run',
    description:
      'Log a skill run outcome. Use this after a skill executes to record whether it succeeded or failed. This data feeds the inspect and amend pipeline.',
    inputSchema: z.object({
      skillName: z.string().describe('Name of the skill that ran'),
      outcome: z
        .enum(['success', 'failure', 'partial', 'unknown'])
        .describe('Outcome of the skill run'),
      taskContext: z
        .string()
        .optional()
        .describe('What the user was trying to do (max 200 chars)'),
      errorDetail: z
        .string()
        .optional()
        .describe('Error message if the skill failed'),
    }),
  },
  async ({ skillName, outcome, taskContext, errorDetail }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    const registry = await readJson<SkillRegistry>(
      join(telemetryDir, 'registry.json')
    );
    const skill = registry?.skills.find((s) => s.name === skillName);

    if (!skill) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Skill "${skillName}" not found in registry. Run \`npx skill-loop init\` first.`,
          },
        ],
      };
    }

    const run: SkillRun = {
      id: randomUUID(),
      skillId: skill.id,
      skillVersion: skill.version,
      timestamp: new Date().toISOString(),
      platform: 'cli',
      taskContext: (taskContext ?? 'logged via MCP').slice(0, 200),
      taskTags: [],
      outcome: outcome as RunOutcome,
      errorType: errorDetail ? 'runtime_error' : undefined,
      errorDetail: errorDetail?.slice(0, 500),
      durationMs: -1,
    };

    const writer = new TelemetryWriter(telemetryDir);
    await writer.logRun(run);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Logged ${outcome} run for "${skillName}" (${run.id.slice(0, 8)})`,
        },
      ],
    };
  }
);

// ─── Tool: skill_loop_init ────────────────────────────────────────

server.registerTool(
  'skill_loop_init',
  {
    title: 'Initialize Skill Loop',
    description:
      'Initialize skill-loop for the current project. Scans for SKILL.md files, creates the .skill-telemetry directory, and builds the skill registry. Run this once when setting up a new project.',
    inputSchema: z.object({}),
  },
  async () => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    const { mkdir, readFile, writeFile } = await import('node:fs/promises');

    await mkdir(telemetryDir, { recursive: true });

    // Update .gitignore
    const gitignorePath = join(projectRoot, '.gitignore');
    try {
      const content = await readFile(gitignorePath, 'utf-8');
      if (!content.includes(config.telemetryDir)) {
        await writeFile(
          gitignorePath,
          content.trimEnd() + `\n${config.telemetryDir}/\n`
        );
      }
    } catch {
      await writeFile(gitignorePath, `${config.telemetryDir}/\n`);
    }

    const registry = new RegistryManager(projectRoot, telemetryDir);
    const result = await registry.scan(config.skillPaths, config.globalSkillPaths);

    const lines = [
      `Initialized skill-loop in ${config.telemetryDir}/`,
      `Registered ${result.skills.length} skills:`,
    ];
    for (const skill of result.skills) {
      lines.push(
        `  ${skill.type}: ${skill.name} (${skill.referencedFiles.length} file refs, ${skill.referencedTools.length} tool refs)`
      );
    }

    const hookStatus = await checkHookStatus(projectRoot);
    if (hookStatus === 'missing') {
      lines.push('', 'To enable auto-detection, add hooks to .claude/settings.json:');
      lines.push('  { "hooks": { "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "npx skill-loop-claude pre-hook" }] }],');
      lines.push('    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "npx skill-loop-claude post-hook" }] }] } }');
      lines.push('Or run `npx skill-loop init` interactively to set this up.');
    } else if (hookStatus === 'outdated') {
      lines.push('', 'Hooks detected but using old "Skill" matcher. Update to ".*" for full auto-detection.');
    } else {
      lines.push('', 'Auto-detection hooks are configured.');
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ─── Tool: skill_loop_runs ────────────────────────────────────────

server.registerTool(
  'skill_loop_runs',
  {
    title: 'Query Skill Runs',
    description:
      'Query logged skill runs. Filter by skill name, outcome, or get recent runs. Use this to investigate skill performance and find failure patterns.',
    inputSchema: z.object({
      skillName: z
        .string()
        .optional()
        .describe('Filter runs by skill name'),
      outcome: z
        .enum(['success', 'failure', 'partial', 'unknown'])
        .optional()
        .describe('Filter by outcome'),
      detectionMethod: z
        .enum(['explicit', 'read_skill_file', 'tool_fingerprint', 'file_overlap'])
        .optional()
        .describe('Filter by detection method (e.g., "explicit" for manual, "read_skill_file" for auto-detected)'),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe('Max number of runs to return (default 20)'),
    }),
  },
  async ({ skillName, outcome, detectionMethod, limit }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    const writer = new TelemetryWriter(telemetryDir);
    let runs = await writer.getAllRuns();

    // Resolve skill name to ID
    if (skillName) {
      const registry = await readJson<SkillRegistry>(
        join(telemetryDir, 'registry.json')
      );
      const skill = registry?.skills.find((s) => s.name === skillName);
      if (skill) {
        runs = runs.filter((r) => r.skillId === skill.id);
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill "${skillName}" not found in registry.`,
            },
          ],
        };
      }
    }

    if (outcome) {
      runs = runs.filter((r) => r.outcome === outcome);
    }

    if (detectionMethod) {
      runs = runs.filter((r) => (r.detectionMethod ?? 'explicit') === detectionMethod);
    }

    // Most recent first, limited
    const recent = runs.reverse().slice(0, limit ?? 20);

    if (recent.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No matching runs found.' }],
      };
    }

    const output = recent.map((r) => ({
      id: r.id.slice(0, 8),
      skill: r.skillId.slice(0, 8),
      outcome: r.outcome,
      platform: r.platform,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
      errorType: r.errorType,
      taskContext: r.taskContext,
      detectionMethod: r.detectionMethod ?? 'explicit',
      detectionConfidence: r.detectionConfidence ?? 1.0,
    }));

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(output, null, 2) },
      ],
    };
  }
);

// ─── Tool: skill_loop_inspect ─────────────────────────────────────

server.registerTool(
  'skill_loop_inspect',
  {
    title: 'Inspect Skills',
    description:
      'Run a full inspection of all skills. Analyzes run history to detect failure patterns, staleness (broken file references), routing errors, usage trends, and degrading performance. Returns patterns for each skill and flags issues that exceed configured thresholds. Use this to diagnose why a skill might be underperforming.',
    inputSchema: z.object({
      skillName: z
        .string()
        .optional()
        .describe('Inspect a single skill by name (omit for all skills)'),
    }),
  },
  async ({ skillName }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    try {
      await stat(telemetryDir);
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'skill-loop is not initialized. Run skill_loop_init first.',
          },
        ],
      };
    }

    const inspector = new Inspector(projectRoot, telemetryDir, config);
    const result = await inspector.inspect(skillName);

    const lines = [
      `Inspection complete: ${result.skillCount} skills analyzed, ${result.totalRuns} runs in window`,
      '',
    ];

    // Patterns
    const registry = await readJson<SkillRegistry>(
      join(telemetryDir, 'registry.json')
    );
    const skillMap = new Map(
      registry?.skills.map((s) => [s.id, s.name]) ?? []
    );

    for (const pattern of result.patterns) {
      const name = skillMap.get(pattern.skillId) ?? pattern.skillId.slice(0, 8);
      const failPct = (pattern.failureRate * 100).toFixed(0);
      const stalePct = (pattern.stalenessScore * 100).toFixed(0);
      const driftInfo = pattern.driftScore > 0 ? `, ${pattern.driftScore} drift commits` : '';
      lines.push(
        `  ${name}: ${pattern.totalRuns} runs, ${failPct}% failures, ${stalePct}% stale${driftInfo}, trend: ${pattern.trend}`
      );
    }

    // Flagged
    if (result.flagged.length > 0) {
      lines.push('', `Flagged (${result.flagged.length}):`);
      for (const flag of result.flagged) {
        const icon =
          flag.severity === 'high'
            ? '[HIGH]'
            : flag.severity === 'medium'
              ? '[MED]'
              : '[LOW]';
        lines.push(`  ${icon} ${flag.skillName}:`);
        for (const reason of flag.reasons) {
          lines.push(`    - ${reason}`);
        }
      }
    } else {
      lines.push('', 'No issues found. All skills are healthy.');
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ─── Tool: skill_loop_amend ───────────────────────────────────────

server.registerTool(
  'skill_loop_amend',
  {
    title: 'Amend Skills',
    description:
      'Generate and apply amendments for flagged skills. Runs inspection first, then proposes fixes for broken references, high failure rates, routing issues, and degrading trends. Creates a git branch per amendment. IMPORTANT: This modifies SKILL.md files on a new branch — the user should review changes before merging. Use --dry-run to preview without changes.',
    inputSchema: z.object({
      skillName: z
        .string()
        .optional()
        .describe('Amend a single skill by name (omit for all flagged skills)'),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe('Preview proposals without creating branches or modifying files'),
    }),
  },
  async ({ skillName, dryRun }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    try {
      await stat(telemetryDir);
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'skill-loop is not initialized. Run skill_loop_init first.',
          },
        ],
      };
    }

    const inspector = new Inspector(projectRoot, telemetryDir, config);
    const inspection = await inspector.inspect(skillName);

    if (inspection.flagged.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No skills flagged for amendment. All skills are healthy.',
          },
        ],
      };
    }

    const amender = new Amender(projectRoot, telemetryDir, config);
    const result = await amender.amend(inspection.flagged, dryRun ?? false);

    const lines: string[] = [];

    if (dryRun) {
      lines.push('DRY RUN — no changes made\n');
    }

    if (result.proposals.length > 0) {
      lines.push(`Proposals (${result.proposals.length}):`);
      for (const p of result.proposals) {
        lines.push(`  ${p.skillName} (${p.changeType}): ${p.reason}`);
      }
    }

    if (result.applied.length > 0) {
      lines.push('', `Applied (${result.applied.length}):`);
      for (const a of result.applied) {
        lines.push(`  ${a.id.slice(0, 8)} on branch ${a.branchName}`);
        lines.push(`  Evaluate with: skill_loop_evaluate(amendmentId: "${a.id}")`);
      }
    }

    if (result.skipped.length > 0) {
      lines.push('', `Skipped: ${result.skipped.join(', ')}`);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ─── Tool: skill_loop_evaluate ────────────────────────────────────

server.registerTool(
  'skill_loop_evaluate',
  {
    title: 'Evaluate Amendment',
    description:
      'Evaluate a proposed skill amendment. Scores the amendment against the baseline success rate and accepts or rejects it. Accepted amendments should be reviewed by the user before merging the branch.',
    inputSchema: z.object({
      amendmentId: z
        .string()
        .describe('The amendment ID to evaluate (from skill_loop_amend output)'),
    }),
  },
  async ({ amendmentId }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    const evaluator = new Evaluator(projectRoot, telemetryDir, config);
    const result = await evaluator.evaluate(amendmentId);

    const lines = [
      `Amendment: ${amendmentId.slice(0, 8)}`,
      `Baseline:  ${(result.baselineScore * 100).toFixed(1)}%`,
      `Score:     ${(result.evaluationScore * 100).toFixed(1)}%`,
      `Evidence:  ${result.evaluationRunCount} runs`,
      `Result:    ${result.passed ? 'ACCEPTED' : 'REJECTED'}`,
      `Reason:    ${result.reason}`,
    ];

    if (result.passed) {
      lines.push('', 'Review the amendment branch and merge when ready.');
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

// ─── Tool: skill_loop_amendments ──────────────────────────────────

server.registerTool(
  'skill_loop_amendments',
  {
    title: 'List Amendments',
    description:
      'List all proposed, accepted, rejected, and rolled-back amendments. Shows the amendment history for tracking skill improvements over time.',
    inputSchema: z.object({
      status: z
        .enum(['proposed', 'evaluating', 'accepted', 'rejected', 'rolled_back'])
        .optional()
        .describe('Filter by amendment status'),
    }),
  },
  async ({ status }) => {
    const projectRoot = getProjectRoot();
    const config = await loadConfig(projectRoot);
    const telemetryDir = join(projectRoot, config.telemetryDir);

    let amendments = await readJsonl<Amendment>(
      join(telemetryDir, 'amendments.jsonl')
    );

    if (status) {
      amendments = amendments.filter((a) => a.status === status);
    }

    if (amendments.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: 'No amendments found.' },
        ],
      };
    }

    const output = amendments.map((a) => ({
      id: a.id.slice(0, 8),
      skill: a.skillId.slice(0, 8),
      changeType: a.changeType,
      status: a.status,
      reason: a.reason,
      branch: a.branchName,
      proposedAt: a.proposedAt,
      evaluationScore: a.evaluationScore,
      baselineScore: a.baselineScore,
    }));

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(output, null, 2) },
      ],
    };
  }
);

// ─── Start Server ─────────────────────────────────────────────────

/**
 * Start the MCP server over stdio.
 * Exported so the CLI `serve` command can call it directly.
 */
export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-start when run as binary (not imported by serve command)
const arg1 = process.argv[1] ?? '';
const isDirectRun = arg1.endsWith('mcp-server.js') || arg1.endsWith('skill-loop-mcp');

if (isDirectRun) {
  startMcpServer().catch((err) => {
    console.error('skill-loop MCP server error:', err);
    process.exit(1);
  });
}
