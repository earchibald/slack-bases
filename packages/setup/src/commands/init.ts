import { resolveToken } from '../token/provider.js';
import { readConfig, writeConfig, CONFIG_DIR, TOKEN_PATH } from '../config/store.js';
import { createApp, getTemplate } from '../manifest/manager.js';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface InitOptions {
  token: string | null;
  saveToken?: boolean;
  prompts?: {
    promptToken?: () => Promise<string>;
    confirmScopes?: (scopes: string[]) => Promise<boolean>;
  };
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

function sha256(obj: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function createWithNameRetry(
  createFn: (manifest: Record<string, unknown>) => Promise<{ app_id: string; client_id: string; team_id: string }>,
  opts: { promptName?: () => Promise<string | null> }
): Promise<{ app_id: string; client_id: string; team_id: string }> {
  const template = getTemplate();
  let lastError: string | null = null;

  // Counter suffixes 2-20
  for (let i = 2; i <= 20; i++) {
    const displayInfo = template.display_information as Record<string, unknown> ?? {};
    const candidate = { ...template, display_information: { ...displayInfo, name: `Slack Bases (${i})` } };
    try {
      return await createFn(candidate);
    } catch (err) {
      lastError = String(err);
      if (!lastError.includes('name_taken')) throw err;
    }
  }

  // User-provided name (up to 5 retries)
  if (opts.promptName) {
    for (let i = 0; i < 5; i++) {
      const customName = await opts.promptName();
      if (!customName) break;
      if (!/^[a-zA-Z0-9 -]{1,80}$/.test(customName)) {
        console.error('Invalid name. Use letters, numbers, hyphens, and spaces only (1-80 characters).');
        continue;
      }
      const displayInfo = template.display_information as Record<string, unknown> ?? {};
      const candidate = { ...template, display_information: { ...displayInfo, name: customName } };
      try {
        return await createFn(candidate);
      } catch (err) {
        lastError = String(err);
        if (!lastError.includes('name_taken')) throw err;
        console.error(`"${customName}" is also taken. Try another.`);
      }
    }
  }

  // Random suffix fallback
  const suffix = Math.random().toString(16).slice(2, 6);
  const displayInfo = template.display_information as Record<string, unknown> ?? {};
  const fallback = { ...template, display_information: { ...displayInfo, name: `Slack Bases - ${suffix}` } };
  try {
    return await createFn(fallback);
  } catch (err) {
    throw new Error('Could not create app: all names exhausted. Choose a name manually at api.slack.com/apps.');
  }
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const readFile = opts.readFile;
  const writeFile = opts.writeFile;
  const prompt = opts.prompts ?? {};

  let resolvedToken = resolveToken({ token: opts.token, env: opts.env ?? process.env, readFile }) ?? '';
  if (!resolvedToken && prompt.promptToken) {
    resolvedToken = await prompt.promptToken();
  }
  if (!resolvedToken) {
    console.error('No token provided. Use --token flag or SLACK_CONFIG_TOKEN env var.');
    process.exit(1);
  }

  const existing = readConfig({ readFile });
  if (existing) {
    console.log(`App "${existing.app_id}" already configured. Run \`status\` to check it or \`update\` to modify it.`);
    return;
  }

  const template = getTemplate();
  const scopes = ((template.oauth_config as Record<string, unknown>)?.scopes as Record<string, string[]>)?.user ?? [];
  if (prompt.confirmScopes) {
    const ok = await prompt.confirmScopes(scopes);
    if (!ok) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  let result;
  try {
    result = await createWithNameRetry(
      async (m) => createApp({ token: resolvedToken, manifest: m }),
      {
        promptName: async () => {
          const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
          return new Promise((resolve) => {
            rl.question('Enter a different app name (or press Enter to use a random suffix): ', (answer) => {
              rl.close();
              resolve(answer.trim() || null);
            });
          });
        },
      }
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes('invalid_auth') || msg.includes('not_authed') || msg.includes('not_allowed_token_type')) {
      console.error('Token rejected. Generate a new config token at api.slack.com/apps.');
      if (prompt.promptToken) {
        const newToken = await prompt.promptToken();
        result = await createApp({ token: newToken });
      } else {
        process.exit(1);
      }
    } else {
      throw err;
    }
  }

  const config = {
    app_id: result.app_id,
    client_id: result.client_id,
    team_id: result.team_id,
    created: new Date().toISOString(),
    manifest_snapshot: template as Record<string, unknown>,
    manifest_sha256: sha256(template as Record<string, unknown>),
  };

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeConfig(config, { writeFile });

  if (opts.saveToken && writeFile) {
    writeFile(TOKEN_PATH, resolvedToken);
    console.log('Token saved to ~/.config/slack-bases/token');
  }

  console.log(`
  ── Summary ──────────────────────────────────────
  App Name:    Slack Bases
  App ID:      ${config.app_id}
  Client ID:   ${config.client_id}
  Team ID:     ${config.team_id}
  Redirect:    obsidian://slack-bases-auth
  ─────────────────────────────────────────────────`);
}
