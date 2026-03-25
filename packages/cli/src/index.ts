#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

function printUsage() {
  console.log('Usage: npx skill-loop <command>\n');
  console.log('Commands:');
  console.log('  init       Scan skills and create .skill-telemetry/');
  console.log('  status     Health dashboard');
  console.log('  inspect    Analyze patterns and detect staleness');
  console.log('  amend      Propose fixes for flagged skills');
  console.log('  evaluate   Score a proposed amendment');
  console.log('  rollback   Revert an accepted amendment');
  console.log('  log        Manually log a skill run');
  console.log('  gc         Prune old runs');
  console.log('  doctor     Audit data integrity');
  console.log('  sync       Flush events to sync plugins');
  console.log('  serve      Start MCP server (stdio)');
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

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
    case 'amend': {
      const { amendCommand } = await import('./commands/amend.js');
      await amendCommand(projectRoot, args);
      break;
    }
    case 'evaluate': {
      const { evaluateCommand } = await import('./commands/evaluate.js');
      await evaluateCommand(projectRoot, args);
      break;
    }
    case 'rollback': {
      const { rollbackCommand } = await import('./commands/rollback.js');
      await rollbackCommand(projectRoot, args);
      break;
    }
    case 'gc': {
      const { gcCommand } = await import('./commands/gc.js');
      await gcCommand(projectRoot);
      break;
    }
    case 'doctor': {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand(projectRoot);
      break;
    }
    case 'sync': {
      const { syncCommand } = await import('./commands/sync.js');
      await syncCommand(projectRoot);
      break;
    }
    case 'serve': {
      const { serveCommand } = await import('./commands/serve.js');
      await serveCommand();
      break;
    }
    default:
      console.error(`skill-loop: unknown command "${command}"`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('skill-loop error:', err);
  process.exit(1);
});
