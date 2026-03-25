import { RegistryManager, loadConfig } from '@stylusnexus/skill-loop';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
  const result = await registry.scan(config.skillPaths);
  console.log(`Registered ${result.skills.length} skills from ${config.skillPaths.join(', ')}`);

  for (const skill of result.skills) {
    console.log(`  ${skill.type === 'agent' ? 'agent' : 'skill'}: ${skill.name} (${skill.referencedFiles.length} file refs, ${skill.referencedTools.length} tool refs)`);
  }

  console.log('\nskill-loop initialized. Run `npx skill-loop status` to check health.');
}
