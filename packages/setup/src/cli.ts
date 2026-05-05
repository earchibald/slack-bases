#!/usr/bin/env node
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { updateCommand } from './commands/update.js';

function parseArgs(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) {
      flags.token = args[++i];
    } else if (args[i] === '--save-token') {
      flags.saveToken = true;
    } else if (args[i] === '--json') {
      flags.json = true;
    } else if (args[i] === '--manifest') {
      flags.manifest = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      flags.command = 'help';
    } else if (!args[i].startsWith('--')) {
      flags.command = args[i];
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const command = flags.command as string || '';

  switch (command) {
    case 'init': {
      await initCommand({
        token: (flags.token as string) ?? null,
        saveToken: !!flags.saveToken,
        prompts: {
          promptToken: async () => {
            const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
            return new Promise((resolve) => {
              rl.question('Paste your Slack config token: ', (answer) => {
                rl.close();
                resolve(answer.trim());
              });
            });
          },
          confirmScopes: async (scopes) => {
            const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
            return new Promise((resolve) => {
              console.log(`\nThe app will request these OAuth scopes:\n  ${scopes.join(', ')}`);
              rl.question('Do you want to proceed? (y/N): ', (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === 'y');
              });
            });
          },
        },
      });
      break;
    }
    case 'status':
    case 'update':
      console.log(`Command '${command}' not yet wired — coming in next tasks.`);
      break;
    case 'help':
    case '':
      console.log(`
Usage: slack-bases-setup <command> [options]

Commands:
  init              Create a new Slack app
  status            Show current app configuration
  update            Update the app manifest

Options:
  --token <value>   Slack config token (overrides env var)
  --save-token      Persist token to ~/.config/slack-bases/token
  --json            Machine-readable output (status only)
  --manifest        Show remote manifest JSON (status only)
  --help            Show this message
`);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
