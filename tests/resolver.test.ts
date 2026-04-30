import { describe, expect, it } from 'vitest';

import { TtlCache } from '../src/slack/cache';
import { createResolver } from '../src/slack/resolver';

describe('createResolver', () => {
  it('uses hydrated Slack metadata when available', async () => {
    const resolver = createResolver({
      channelCache: new TtlCache(60_000),
      failedLookupCache: new TtlCache(60_000),
      service: {
        getMessage: async () => ({
          authorId: 'U01',
          authorName: 'Avery',
          channelName: 'ops',
          text: 'deploy failed',
        }),
        getUserByDmSentinel: async () => null,
        getChannelByName: async () => null,
      },
      session: { teamId: 'T01', workspace: 'acme' },
      userCache: new TtlCache(60_000),
    });

    const result = await resolver.resolvePermalink(
      'https://acme.slack.com/archives/C01/p1714490435123456'
    );

    expect(result).toMatchObject({
      author: 'Avery',
      author_id: 'U01',
      channel: 'ops',
      channel_id: 'C01',
      text: 'deploy failed',
      workspace: 'acme',
    });
  });

  it('falls back to url-derived fields when hydration fails', async () => {
    const resolver = createResolver({
      channelCache: new TtlCache(60_000),
      failedLookupCache: new TtlCache(60_000),
      service: {
        getMessage: async () => {
          throw new Error('rate_limited');
        },
        getUserByDmSentinel: async () => null,
        getChannelByName: async () => null,
      },
      session: { teamId: 'T01', workspace: 'acme' },
      userCache: new TtlCache(60_000),
    });

    const result = await resolver.resolvePermalink(
      'https://acme.slack.com/archives/C01/p1714490435123456'
    );

    expect(result).toMatchObject({
      channel_id: 'C01',
      ts: '1714490435.123456',
      url: 'https://acme.slack.com/archives/C01/p1714490435123456',
      workspace: 'acme',
    });
  });
});
