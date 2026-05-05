import { resolveToken } from '../token/provider.js';
import { readConfig } from '../config/store.js';
import { exportApp } from '../manifest/manager.js';

export interface StatusOptions {
  token: string | null;
  json?: boolean;
  manifest?: boolean;
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => string;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const config = readConfig({ readFile: opts.readFile });
  if (!config) {
    console.error('No configuration found. Run `init` first.');
    process.exit(1);
  }

  const token = resolveToken({ token: opts.token, env: opts.env ?? process.env, readFile: opts.readFile });
  if (!token) {
    console.error('No token available. Use --token flag or SLACK_CONFIG_TOKEN env var.');
    process.exit(1);
  }

  try {
    const exported = await exportApp({ token, app_id: config.app_id });

    if (opts.manifest) {
      console.log(JSON.stringify(exported.manifest, null, 2));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    const displayInfo = (exported.manifest.display_information as Record<string, string>) ?? {};
    const scopes = ((exported.manifest.oauth_config as Record<string, unknown>)?.scopes as Record<string, string[]>)?.user ?? [];

    console.log(`
  App:    ${displayInfo.name ?? config.app_id}
  ID:     ${config.app_id}
  Client: ${config.client_id}
  Team:   ${config.team_id}
  Status: ${exported.app_id === config.app_id ? 'App exists and is configured' : 'App may have changed externally'}

  Scopes: ${scopes.join(', ')}
    `);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not_found')) {
      console.error('App no longer exists. Run `init` to create a new one.');
    } else {
      throw err;
    }
  }
}
