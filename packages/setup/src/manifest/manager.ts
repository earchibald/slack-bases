import { WebClient } from '@slack/web-api';
import template from './template.json' with { type: 'json' };

interface ApiFn {
  (method: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface CreateResult {
  app_id: string;
  client_id: string;
  team_id: string;
}

export interface ExportResult {
  manifest: Record<string, unknown>;
  app_id: string;
}

export function getTemplate(): Record<string, unknown> {
  return structuredClone(template);
}

function makeApi(token: string): ApiFn {
  const client = new WebClient(token);
  return (method, args) => client.apiCall(method, args) as Promise<Record<string, unknown>>;
}

export async function createApp(opts: { token: string; api?: ApiFn }): Promise<CreateResult> {
  const api = opts.api ?? makeApi(opts.token);
  const manifest = getTemplate();
  const response = await api('apps.manifest.create', { manifest });
  if (!response.ok) throw new Error(String(response.error ?? 'create failed'));
  const creds = response.credentials as Record<string, string> | undefined;
  return {
    app_id: String(response.app_id ?? ''),
    client_id: creds?.client_id ?? '',
    team_id: String(response.team_id ?? ''),
  };
}

export async function exportApp(opts: { token: string; app_id: string; api?: ApiFn }): Promise<ExportResult> {
  const api = opts.api ?? makeApi(opts.token);
  const response = await api('apps.manifest.export', { app_id: opts.app_id });
  if (!response.ok) throw new Error(String(response.error ?? 'export failed'));
  const manifest = (response.manifest as Record<string, unknown>) ?? {};
  return { manifest, app_id: String(response.app_id ?? opts.app_id) };
}

export async function updateApp(opts: { token: string; app_id: string; manifest: Record<string, unknown>; api?: ApiFn }): Promise<void> {
  const api = opts.api ?? makeApi(opts.token);
  const response = await api('apps.manifest.update', { app_id: opts.app_id, manifest: opts.manifest });
  if (!response.ok) throw new Error(String(response.error ?? 'update failed'));
}
