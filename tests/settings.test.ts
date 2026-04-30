import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';

describe('mergeSettings', () => {
  it('fills in omitted settings with defaults', () => {
    expect(
      mergeSettings({
        idleDelayMs: 900,
        session: { teamId: 'T01', workspace: 'acme' },
      })
    ).toEqual({
      ...DEFAULT_SETTINGS,
      idleDelayMs: 900,
      session: {
        ...DEFAULT_SETTINGS.session,
        teamId: 'T01',
        workspace: 'acme',
      },
    });
  });
});
