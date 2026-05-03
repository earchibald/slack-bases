import { describe, expect, it } from 'vitest';

import { planSlackLinkReplacements } from '../src/slack/engine';

describe('planSlackLinkReplacements', () => {
  it('converts a pasted permalink into a smart markdown link', async () => {
    const replacements = await planSlackLinkReplacements(
      'Paste https://acme.slack.com/archives/C01/p1714490435123456 here',
      {
        cursorOffset: -1,
        settings: {
          enableChannels: true,
          enableDmSentinels: true,
          enablePermalinks: true,
          messageTemplate: '[{channel} • {author}: {text}]({url})',
          target: 'app',
        },
        resolver: {
          resolveChannelRef: async () => null,
          resolveDmSentinel: async () => null,
          resolvePermalink: async () => ({
            author: 'Avery',
            channel: 'ops',
            text: 'deploy failed',
            url: 'https://acme.slack.com/archives/C01/p1714490435123456',
          }),
        },
      }
    );

    expect(replacements).toEqual([
      {
        end: 59,
        start: 6,
        text: '[ops • Avery: deploy failed](https://acme.slack.com/archives/C01/p1714490435123456)',
      },
    ]);
  });

  it('converts channel refs and dm sentinels into deep links', async () => {
    const replacements = await planSlackLinkReplacements('Talk in #ops and ping dm:@avery', {
      cursorOffset: -1,
      settings: {
        enableChannels: true,
        enableDmSentinels: true,
        enablePermalinks: true,
        messageTemplate: '[{channel}]({url})',
        target: 'app',
      },
      resolver: {
        resolveChannelRef: async () => ({ channelId: 'C01', name: 'ops', teamId: 'T01' }),
        resolveDmSentinel: async () => ({ displayName: 'Avery', teamId: 'T01', userId: 'U01' }),
        resolvePermalink: async () => ({ url: '' }),
      },
    });

    expect(replacements).toEqual([
      {
        end: 12,
        start: 8,
        text: '[#ops](slack://channel?team=T01&id=C01)',
      },
      {
        end: 31,
        start: 22,
        text: '[DM Avery](slack://user?team=T01&id=U01)',
      },
    ]);
  });
});
