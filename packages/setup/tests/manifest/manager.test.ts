import { describe, expect, it, vi } from 'vitest';
import { createApp, exportApp, updateApp } from '../../src/manifest/manager.js';

describe('createApp', () => {
  it('returns app_id, client_id, and team_id on success', async () => {
    const api = vi.fn().mockResolvedValue({
      ok: true,
      app_id: 'A01',
      credentials: { client_id: '1.2' },
      team_id: 'T01',
    });
    const result = await createApp({ api });
    expect(result).toEqual({ app_id: 'A01', client_id: '1.2', team_id: 'T01' });
  });
});

describe('exportApp', () => {
  it('returns the manifest and app_id on success', async () => {
    const api = vi.fn().mockResolvedValue({
      ok: true,
      app_id: 'A01',
      manifest: { display_information: { name: 'Test' } },
    });
    const result = await exportApp({ api, app_id: 'A01' });
    expect(result.app_id).toBe('A01');
    expect(result.manifest).toEqual({ display_information: { name: 'Test' } });
  });
});

describe('updateApp', () => {
  it('sends the manifest to the API', async () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    const manifest = { display_information: { name: 'Updated' } };
    await updateApp({ api, app_id: 'A01', manifest });
    expect(api).toHaveBeenCalledWith('apps.manifest.update', {
      app_id: 'A01',
      manifest,
    });
  });
});
