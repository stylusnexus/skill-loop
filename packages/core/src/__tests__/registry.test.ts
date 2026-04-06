import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RegistryManager } from '../registry.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('RegistryManager', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-registry-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  async function createSkill(name: string, description: string = ''): Promise<void> {
    const skillDir = join(dir, '.claude', 'skills', name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      `description: "${description}"`,
      '---',
      '',
      `# ${name}`,
      '',
      'Some instructions.',
    ].join('\n'));
  }

  it('scans skill directories and builds registry', async () => {
    await createSkill('alpha', 'First skill');
    await createSkill('beta', 'Second skill');

    const manager = new RegistryManager(dir, join(dir, '.skill-telemetry'));
    const registry = await manager.scan(['.claude/skills']);
    expect(registry.skills).toHaveLength(2);
    expect(registry.skills.map(s => s.name).sort()).toEqual(['alpha', 'beta']);
    expect(registry.schemaVersion).toBe(2);
  });

  it('assigns stable UUIDs that persist across rescans', async () => {
    await createSkill('stable');
    const manager = new RegistryManager(dir, join(dir, '.skill-telemetry'));

    const first = await manager.scan(['.claude/skills']);
    const firstId = first.skills[0].id;

    const second = await manager.scan(['.claude/skills']);
    expect(second.skills[0].id).toBe(firstId);
  });

  it('handles empty skill directories', async () => {
    await mkdir(join(dir, '.claude', 'skills'), { recursive: true });
    const manager = new RegistryManager(dir, join(dir, '.skill-telemetry'));
    const registry = await manager.scan(['.claude/skills']);
    expect(registry.skills).toHaveLength(0);
  });

  it('handles missing skill directories without error', async () => {
    const manager = new RegistryManager(dir, join(dir, '.skill-telemetry'));
    const registry = await manager.scan(['.claude/skills', '.nonexistent']);
    expect(registry.skills).toHaveLength(0);
  });

  it('looks up a skill by name', async () => {
    await createSkill('lookup-test', 'Find me');
    const manager = new RegistryManager(dir, join(dir, '.skill-telemetry'));
    await manager.scan(['.claude/skills']);

    const skill = manager.findByName('lookup-test');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('lookup-test');
  });

  it('returns undefined for unknown skill name', async () => {
    const manager = new RegistryManager(dir, join(dir, '.skill-telemetry'));
    await manager.scan(['.claude/skills']);
    expect(manager.findByName('nope')).toBeUndefined();
  });
});
