import { resolveToken } from '../token/provider.js';
import { readConfig, writeConfig } from '../config/store.js';
import { exportApp, updateApp } from '../manifest/manager.js';
import { createHash } from 'node:crypto';

interface UpdateOptions {
  token: string | null;
  force?: boolean;
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  prompts?: {
    confirmApply?: (diff: string) => Promise<boolean>;
  };
}

function sha256(obj: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function diffManifests(local: Record<string, unknown>, remote: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const localScopes = ((local.oauth_config as Record<string, unknown>)?.scopes as Record<string, string[]>)?.user ?? [];
  const remoteScopes = ((remote.oauth_config as Record<string, unknown>)?.scopes as Record<string, string[]>)?.user ?? [];

  const added = remoteScopes.filter((s) => !localScopes.includes(s));
  const removed = localScopes.filter((s) => !remoteScopes.includes(s));
  if (added.length) added.forEach((s) => lines.push(`  + ${s}`));
  if (removed.length) removed.forEach((s) => lines.push(`  - ${s}`));

  const localRedirects = ((local.oauth_config as Record<string, unknown>)?.redirect_urls as string[]) ?? [];
  const remoteRedirects = ((remote.oauth_config as Record<string, unknown>)?.redirect_urls as string[]) ?? [];
  const addedUrls = remoteRedirects.filter((u) => !localRedirects.includes(u));
  const removedUrls = localRedirects.filter((u) => !remoteRedirects.includes(u));
  if (addedUrls.length) addedUrls.forEach((u) => lines.push(`  + redirect: ${u}`));
  if (removedUrls.length) removedUrls.forEach((u) => lines.push(`  - redirect: ${u}`));

  return lines;
}

export async function updateCommand(opts: UpdateOptions): Promise<void> {
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

  const exported = await exportApp({ token, app_id: config.app_id });
  const remote = exported.manifest as Record<string, unknown>;
  const remoteHash = sha256(remote);

  if (remoteHash === config.manifest_sha256) {
    console.log('No changes detected.');
    return;
  }

  if (remoteHash !== config.manifest_sha256) {
    console.log('Warning: App was modified externally since last update.\n');
  }

  const diff = diffManifests(config.manifest_snapshot as Record<string, unknown>, remote);
  if (diff.length === 0) {
    writeConfig({ ...config, manifest_snapshot: remote, manifest_sha256: remoteHash }, { writeFile: opts.writeFile });
    console.log('Snapshot refreshed. No changes to apply.');
    return;
  }

  console.log('Changes:');
  diff.forEach((l) => console.log(l));
  console.log();

  const addedScopes = diff.filter((l) => l.startsWith('  + ') && !l.includes('redirect:'));
  const removedScopes = diff.filter((l) => l.startsWith('  - ') && !l.includes('redirect:'));
  const addedRedirects = diff.filter((l) => l.includes('redirect:') && l.startsWith('  +'));
  const removedRedirects = diff.filter((l) => l.includes('redirect:') && l.startsWith('  -'));

  if (removedScopes.length) console.log('⚠ Scopes removed — existing tokens may lose access. Users may need to re-authorize.');
  if (addedScopes.length) console.log('⚠ Scopes added — users will be prompted for new permissions on next authorization.');
  if (addedRedirects.length || removedRedirects.length) console.log('⚠ Redirect URLs changed. Verify they are correct.');

  if (opts.prompts?.confirmApply) {
    const ok = await opts.prompts.confirmApply(diff.join('\n'));
    if (!ok) {
      console.log('Update cancelled.');
      return;
    }
  }

  const reExported = await exportApp({ token, app_id: config.app_id });
  const reRemote = reExported.manifest as Record<string, unknown>;
  const reHash = sha256(reRemote);
  if (reHash !== remoteHash) {
    console.error('Remote manifest changed since preview. Please review and run update again.');
    process.exit(1);
  }

  const updatedManifest = { ...remote };
  await updateApp({ token, app_id: config.app_id, manifest: updatedManifest });

  writeConfig({
    ...config,
    manifest_snapshot: updatedManifest,
    manifest_sha256: sha256(updatedManifest),
  }, { writeFile: opts.writeFile });

  console.log('Update applied.');
}
