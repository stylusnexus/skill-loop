import { RegistryManager, loadConfig } from '@stylusnexus/skill-loop';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export async function initCommand(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  await mkdir(telemetryDir, { recursive: true });
  console.log(`Created ${config.telemetryDir}/`);

  const gitignorePath = join(projectRoot, '.gitignore');
  try {
    const content = await readFile(gitignorePath, 'utf-8');
    if (!content.includes(config.telemetryDir)) {
      await writeFile(gitignorePath, content.trimEnd() + `\n${config.telemetryDir}/\n`);
      console.log(`Added ${config.telemetryDir}/ to .gitignore`);
    }
  } catch {
    await writeFile(gitignorePath, `${config.telemetryDir}/\n`);
    console.log(`Created .gitignore with ${config.telemetryDir}/`);
  }

  const registry = new RegistryManager(projectRoot, telemetryDir);
  const result = await registry.scan(config.skillPaths, config.globalSkillPaths);
  const localCount = result.skills.filter(s => s.source === 'local').length;
  const installedCount = result.skills.filter(s => s.source === 'installed').length;
  const globalCount = result.skills.filter(s => s.scope === 'global').length;
  const projectCount = result.skills.filter(s => s.scope === 'project').length;
  console.log(`Registered ${result.skills.length} skills (${localCount} local, ${installedCount} installed | ${projectCount} project, ${globalCount} global)`);

  for (const skill of result.skills) {
    console.log(`  ${skill.type === 'agent' ? 'agent' : 'skill'}: ${skill.name} (${skill.referencedFiles.length} file refs, ${skill.referencedTools.length} tool refs)`);
  }

  // Offer to configure Claude Code hooks for auto-detection
  await offerHookSetup(projectRoot);

  console.log('\nskill-loop initialized. Run `npx skill-loop status` to check health.');
}

async function offerHookSetup(projectRoot: string): Promise<void> {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const hookCommand = 'npx skill-loop-claude';

  let settings: Record<string, any> = {};
  let hasExistingSettings = false;

  try {
    const raw = await readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
    hasExistingSettings = true;
  } catch {
    // No settings file yet
  }

  // Check if hooks are already configured
  const hooks = settings.hooks ?? {};
  const preHooks: any[] = hooks.PreToolUse ?? [];
  const postHooks: any[] = hooks.PostToolUse ?? [];

  const hasPreHook = preHooks.some((h: any) => h.command?.includes('skill-loop-claude'));
  const hasPostHook = postHooks.some((h: any) => h.command?.includes('skill-loop-claude'));

  if (hasPreHook && hasPostHook) {
    // Check if using old "Skill" matcher vs new ".*" matcher
    const preEntry = preHooks.find((h: any) => h.command?.includes('skill-loop-claude'));
    const postEntry = postHooks.find((h: any) => h.command?.includes('skill-loop-claude'));
    const isOldMatcher = preEntry?.matcher === 'Skill' || postEntry?.matcher === 'Skill';

    if (isOldMatcher) {
      console.log('\nClaude Code hooks are configured but using the old "Skill" matcher.');
      console.log('Auto-detection requires the ".*" matcher to observe all tool calls.');
      const answer = await ask('Upgrade hook matchers to ".*" for auto-detection? [Y/n] ');
      if (answer.toLowerCase() !== 'n') {
        preEntry.matcher = '.*';
        postEntry.matcher = '.*';
        await mkdir(join(projectRoot, '.claude'), { recursive: true });
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('Updated hooks to use ".*" matcher for auto-detection.');
      }
    } else {
      console.log('\nClaude Code hooks already configured for auto-detection.');
    }
    return;
  }

  // No hooks — offer to add them
  console.log('\nClaude Code auto-detection hooks are not configured.');
  console.log('These hooks observe tool calls and automatically log skill usage.');
  const answer = await ask('Add auto-detection hooks to .claude/settings.json? [Y/n] ');
  if (answer.toLowerCase() === 'n') {
    console.log('Skipped. You can manually add hooks later (see README).');
    return;
  }

  // Build the new hooks, preserving existing ones
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  settings.hooks.PreToolUse.push({
    matcher: '.*',
    command: `${hookCommand} pre-hook`,
  });
  settings.hooks.PostToolUse.push({
    matcher: '.*',
    command: `${hookCommand} post-hook`,
  });

  await mkdir(join(projectRoot, '.claude'), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('Added auto-detection hooks to .claude/settings.json');
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
