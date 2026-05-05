import { describe, expect, it } from 'vitest';
import { readConfig, writeConfig, CONFIG_PATH, TOKEN_PATH } from '../../src/config/store.js';

describe('readConfig', () => {
  it('returns null when the config file does not exist', () => {
    const result = readConfig({ readFile: () => { throw new Error('ENOENT'); } });
    expect(result).toBeNull();
  });

  it('returns null when the config file contains invalid JSON', () => {
    const result = readConfig({ readFile: () => 'not json' });
    expect(result).toBeNull();
  });

  it('returns null when the config is missing required fields', () => {
    const result = readConfig({ readFile: () => JSON.stringify({}) });
    expect(result).toBeNull();
  });

  it('returns parsed config when valid', () => {
    const valid = {
      app_id: 'A01', client_id: '1.2', team_id: 'T01',
      created: '2026-01-01T00:00:00Z',
      manifest_snapshot: { oauth_config: {} },
      manifest_sha256: 'abc',
    };
    const result = readConfig({ readFile: () => JSON.stringify(valid) });
    expect(result).toEqual(valid);
  });
});

describe('writeConfig', () => {
  it('writes config atomically (temp then rename)', () => {
    let writtenContent = '';
    let renameCalled = false;
    const writeFile = (_path: string, content: string) => { writtenContent = content; };
    const rename = () => { renameCalled = true; };

    writeConfig({ app_id: 'A01', client_id: '1.2', team_id: 'T01', created: 'd', manifest_snapshot: {}, manifest_sha256: 'a' }, { writeFile, rename });

    expect(writtenContent).toContain('"app_id": "A01"');
    expect(renameCalled).toBe(true);
  });
});
