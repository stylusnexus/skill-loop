import { RegistryManager, loadConfig } from '@stylusnexus/skill-loop';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
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

  // Offer to configure MCP server in .mcp.json
  await offerMcpSetup(projectRoot);

  // Offer to configure Claude Code hooks for auto-detection
  await offerHookSetup(projectRoot);

  // Install /sl slash command skill
  await installSlSkill();

  console.log('\nskill-loop initialized. Run `npx skill-loop status` or `/sl status` to check health.');
}

async function offerMcpSetup(projectRoot: string): Promise<void> {
  const mcpPath = join(projectRoot, '.mcp.json');

  // Read package version for pinning
  let version = 'latest';
  try {
    const pkgRaw = await readFile(join(__dirname, '..', '..', 'package.json'), 'utf-8');
    version = JSON.parse(pkgRaw).version || 'latest';
  } catch { /* fallback to latest */ }

  const pkgSpec = version === 'latest'
    ? '@stylusnexus/skill-loop-cli'
    : `@stylusnexus/skill-loop-cli@${version}`;

  let mcpConfig: Record<string, any> = {};
  try {
    const raw = await readFile(mcpPath, 'utf-8');
    mcpConfig = JSON.parse(raw);
  } catch { /* no .mcp.json yet */ }

  const servers = mcpConfig.mcpServers ?? {};
  const existing = servers['skill-loop'];

  if (existing) {
    // Check if version-pinned and up to date
    const args: string[] = existing.args ?? [];
    const currentPkg = args.find((a: string) => a.includes('@stylusnexus/skill-loop-cli'));
    if (currentPkg === pkgSpec) {
      console.log(`\nMCP server already configured (${pkgSpec}).`);
      return;
    }

    // Update to pinned version
    const answer = await ask(`\nUpdate MCP server config to ${pkgSpec}? [Y/n] `);
    if (answer.toLowerCase() === 'n') return;

    servers['skill-loop'] = {
      command: 'npx',
      args: ['-y', '-p', pkgSpec, 'skill-loop-mcp'],
    };
    mcpConfig.mcpServers = servers;
    await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    console.log(`Updated .mcp.json to ${pkgSpec}. Restart Claude Code or run /mcp to reconnect.`);
    return;
  }

  // No MCP server configured — offer to add
  console.log('\nMCP server is not configured for this project.');
  const answer = await ask(`Add skill-loop MCP server to .mcp.json? [Y/n] `);
  if (answer.toLowerCase() === 'n') {
    console.log('Skipped. You can still use the CLI directly.');
    return;
  }

  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
  mcpConfig.mcpServers['skill-loop'] = {
    command: 'npx',
    args: ['-y', '-p', pkgSpec, 'skill-loop-mcp'],
  };
  await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`Added skill-loop MCP server to .mcp.json (${pkgSpec}).`);
  console.log('Restart Claude Code or run /mcp to connect.');
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

async function installSlSkill(): Promise<void> {
  const destDir = join(homedir(), '.claude', 'skills', 'sl');
  const destFile = join(destDir, 'SKILL.md');

  // Check if already installed
  try {
    await stat(destFile);
    console.log('\n/sl slash command already installed.');
    return;
  } catch { /* not installed yet */ }

  // Find the bundled SKILL.md relative to this compiled file
  const srcFile = join(__dirname, '..', '..', 'skills', 'sl', 'SKILL.md');

  try {
    await stat(srcFile);
  } catch {
    // Bundled skill not found (running from source or different layout)
    return;
  }

  const answer = await ask('\nInstall /sl slash command for Claude Code? [Y/n] ');
  if (answer.toLowerCase() === 'n') {
    console.log('Skipped. You can use the skill_loop MCP tool directly.');
    return;
  }

  await mkdir(destDir, { recursive: true });
  await copyFile(srcFile, destFile);
  console.log('Installed /sl slash command to ~/.claude/skills/sl/');
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
