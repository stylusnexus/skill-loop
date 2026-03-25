#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

async function main() {
  const projectRoot = process.cwd();

  switch (command) {
    case 'init': {
      const { initCommand } = await import('./commands/init.js');
      await initCommand(projectRoot);
      break;
    }
    case 'log': {
      const { logCommand } = await import('./commands/log.js');
      await logCommand(projectRoot, args);
      break;
    }
    case 'status': {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand(projectRoot);
      break;
    }
    case 'inspect': {
      const { inspectCommand } = await import('./commands/inspect.js');
      await inspectCommand(projectRoot, args);
      break;
    }
    case 'amend':
      console.log('skill-loop: amend not yet implemented (Phase 3)');
      break;
    case 'evaluate':
      console.log('skill-loop: evaluate not yet implemented (Phase 3)');
      break;
    case 'rollback':
      console.log('skill-loop: rollback not yet implemented (Phase 3)');
      break;
    case 'gc':
      console.log('skill-loop: gc not yet implemented (Phase 4)');
      break;
    case 'doctor': {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand(projectRoot);
      break;
    }
    case 'sync':
      console.log('skill-loop: sync not yet implemented (Phase 4)');
      break;
    default:
      console.log(`skill-loop: unknown command "${command}"`);
      console.log('Usage: npx skill-loop <init|status|inspect|amend|evaluate|rollback|log|gc|doctor|sync>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('skill-loop error:', err);
  process.exit(1);
});
