import { loadConfig, readJson, dryRunDetect } from '@stylusnexus/skill-loop';
import type { SkillRegistry } from '@stylusnexus/skill-loop';
import { join } from 'node:path';

export async function detectCommand(projectRoot: string, args: string[]): Promise<void> {
  // Usage: npx skill-loop detect <tool_name> [key=value ...]
  // Example: npx skill-loop detect Read file_path=.claude/skills/build/SKILL.md
  // Example: npx skill-loop detect Bash command="npm run build"
  // Example: npx skill-loop detect Skill skill=my-skill

  const toolName = args[0];
  if (!toolName) {
    console.log('Usage: npx skill-loop detect <tool_name> [key=value ...]');
    console.log('');
    console.log('Dry-run the detection pipeline against a hypothetical tool call.');
    console.log('');
    console.log('Examples:');
    console.log('  npx skill-loop detect Read file_path=.claude/skills/build/SKILL.md');
    console.log('  npx skill-loop detect Bash command="npm run build"');
    console.log('  npx skill-loop detect Skill skill=my-skill');
    return;
  }

  const toolInput: Record<string, unknown> = {};
  for (const arg of args.slice(1)) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx);
      let value: string = arg.slice(eqIdx + 1);
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Resolve relative file_path to absolute
      if (key === 'file_path' && !value.startsWith('/')) {
        toolInput[key] = join(projectRoot, value);
      } else {
        toolInput[key] = value;
      }
    }
  }

  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  if (!registry || registry.skills.length === 0) {
    console.log('No skills registered. Run `npx skill-loop init` first.');
    return;
  }

  const result = await dryRunDetect(projectRoot, telemetryDir, config.detection, {
    tool_name: toolName,
    tool_input: toolInput,
  });

  if (!result) {
    console.log(`No skill detected for: ${toolName} ${JSON.stringify(toolInput)}`);
    console.log('');
    console.log('Possible reasons:');
    console.log('  - No registered skill matches this tool call');
    console.log('  - The detection method for this pattern is disabled');
    console.log(`  - Confidence below threshold (${config.detection.confidenceThreshold})`);
    return;
  }

  const skillMap = new Map(registry.skills.map(s => [s.id, s.name]));
  const skillName = skillMap.get(result.primarySignal.skillId) ?? result.primarySignal.skillId.slice(0, 8);

  console.log(`Detected: ${skillName}`);
  console.log(`  Composite confidence: ${(result.compositeConfidence * 100).toFixed(0)}%`);
  console.log(`  Primary method:       ${result.primarySignal.method}`);
  console.log(`  Would log:            ${result.compositeConfidence >= config.detection.confidenceThreshold ? 'YES' : 'NO (below threshold)'}`);
  console.log('');
  console.log('Signals:');
  for (const sig of result.signals) {
    const name = skillMap.get(sig.skillId) ?? sig.skillId.slice(0, 8);
    console.log(`  [${(sig.confidence * 100).toFixed(0)}%] ${sig.method}: ${sig.evidence} → ${name}`);
  }
}
