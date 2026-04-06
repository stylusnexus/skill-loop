#!/usr/bin/env node
import { preHook } from './pre-hook.js';
import { postHook } from './post-hook.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'pre-hook':
      await preHook();
      break;
    case 'post-hook':
      await postHook();
      break;
    default:
      console.error(`skill-loop-claude: unknown command "${command}"`);
      console.error('Usage: skill-loop-claude <pre-hook|post-hook>');
      process.exit(1);
  }
}

main().catch(() => {
  // Hooks must never crash Claude Code -- swallow all errors
  process.exit(0);
});
