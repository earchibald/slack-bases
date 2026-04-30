import { describe, expect, it, vi } from 'vitest';

import { createSlackService } from '../src/slack/service';

describe('createSlackService', () => {
  it('hydrates message author and channel names for a permalink lookup', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url =
        typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      const method = url.pathname.split('/').pop();

      if (method === 'conversations.history') {
        return new Response(
          JSON.stringify({
            messages: [{ text: 'deploy failed', user: 'U01' }],
            ok: true,
          }),
          { status: 200 }
        );
      }

      if (method === 'users.info') {
        return new Response(
          JSON.stringify({
            ok: true,
            user: {
              id: 'U01',
              profile: {
                display_name: 'Avery',
                real_name: 'Avery Quinn',
              },
            },
          }),
          { status: 200 }
        );
      }

      if (method === 'conversations.info') {
        return new Response(
          JSON.stringify({
            channel: {
              id: 'C01',
              name: 'ops',
            },
            ok: true,
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected Slack API call: ${url.pathname}`);
    }) as typeof fetch;

    const service = createSlackService(
      {
        accessToken: 'xoxp-token',
        teamId: 'T01',
        workspace: 'acme',
      },
      fetchImpl
    );

    await expect(
      service.getMessage('https://acme.slack.com/archives/C01/p1714490435123456')
    ).resolves.toEqual({
      authorId: 'U01',
      authorName: 'Avery',
      channelName: 'ops',
      text: 'deploy failed',
    });
  });
});
