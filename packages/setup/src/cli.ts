#!/usr/bin/env node

function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? '';

  switch (command) {
    case 'init':
      console.log('init');
      break;
    case 'status':
      console.log('status');
      break;
    case 'update':
      console.log('update');
      break;
    case '--help':
    case '-h':
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

main();
